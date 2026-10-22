"""A loopback-only, persistent, sequential image processing queue."""
from __future__ import annotations

import io
import json
import os
import re
import secrets
import threading
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from engine import ROOT, MODELS, Remover, apply_strokes, load_image, save_png
from image_geometry import apply_transform, normalize_transform, output_size
from app_paths import APP_ID, APP_NAME, VERSION, DATA_DIR, public_error
from model_manager import model_status
from cutris.settings import SettingsStore, validate_settings

DATA = DATA_DIR / "jobs"
DATA.mkdir(parents=True, exist_ok=True)
TOKEN = secrets.token_urlsafe(32)
LOCK = threading.RLock()
POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cutout")
REMOVER = Remover()
PROCESSING_LOCK = threading.Lock()
SETTINGS = SettingsStore()
INTEGRATION_CONTROLLER = None
EDITOR_REQUESTS = []
JOBS: dict[str, dict] = {}
DESKTOP_MODE = False
app = FastAPI(docs_url=None, redoc_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])


def persist(job):
    path = DATA / job["id"] / "manifest.json"
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    # Windows scanners can briefly hold the destination after an atomic save.
    for attempt in range(5):
        try:
            os.replace(temp, path)
            break
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(.025 * (attempt + 1))


for path in DATA.glob("*/manifest.json"):
    try:
        job = json.loads(path.read_text(encoding="utf-8"))
        if not re.fullmatch(r"[a-f0-9]{32}", job["id"]):
            continue
        if job["status"] == "stopping":
            job["status"] = "stopped"
            job["current"] = None
            job["stage"] = "Queue stopped. Finished images are saved."
            for item in job["items"]:
                if item["status"] in {"running", "waiting"}:
                    item["status"] = "cancelled"
            persist(job)
        elif job["status"] in {"running", "queued", "pausing"}:
            job["status"] = "paused"
            job["stage"] = "Interrupted by a restart. Resume to continue."
            for item in job["items"]:
                if item["status"] == "running":
                    item["status"] = "waiting"
            persist(job)
        JOBS[job["id"]] = job
    except (ValueError, KeyError, OSError):
        pass


@app.middleware("http")
async def local_safety(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        if request.headers.get("X-Cutout-Token") != TOKEN:
            return JSONResponse({"detail": "Session expired. Refresh this page and try again."}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "Only this local app may make changes."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    # pywebview constructs its local native API with Function(). Browser mode
    # keeps eval disabled; the desktop renderer only loads bundled local code.
    script_policy = "'self' 'unsafe-eval'" if DESKTOP_MODE else "'self'"
    response.headers["Content-Security-Policy"] = f"default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src {script_policy}; connect-src 'self'; frame-ancestors 'none'"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
        if request.method == "GET" and "/items/" in request.url.path and request.query_params.get("download") != "true":
            response.headers["Cache-Control"] = "private, max-age=3600"
    return response


def get_job(job_id):
    if job_id not in JOBS:
        raise HTTPException(404, "Batch not found.")
    return JOBS[job_id]


def get_item(job_id, item_id):
    job = get_job(job_id)
    item = next((i for i in job["items"] if i["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Image not found.")
    return job, item, DATA / job_id / item_id


def thumbnail(image, path):
    preview = image.copy()
    preview.thumbnail((128, 128), Image.Resampling.LANCZOS)
    save_png(preview, path)


def output_metadata(item):
    """Supply geometry defaults for batches saved before cropping was added."""
    settings = normalize_transform((item["width"], item["height"]), item.get("transform"))
    width, height = output_size((item["width"], item["height"]), settings)
    return {"transform": settings, "output_width": width, "output_height": height}


def render_output(directory, strokes, transform):
    with Image.open(directory / "original.png") as original, Image.open(directory / "automatic.png") as automatic:
        edited = apply_strokes(original.convert("RGBA"), automatic.convert("RGBA"), strokes)
    return apply_transform(edited, transform)


def alpha_crop(image):
    bounds = image.getchannel("A").getbbox()
    if not bounds or bounds == (0, 0, *image.size):
        return None
    left, top, right, bottom = bounds
    return {"x": left, "y": top, "width": right-left, "height": bottom-top}


def prepare_download(item, path):
    """Share export geometry between single PNGs and ZIPs without changing saved work."""
    settings = item.get("transform") or {}
    automatic = SETTINGS.get()["auto_crop"] and not item.get("geometry_applied") and not any(settings.get(key) for key in ("crop", "resize", "canvas"))
    with Image.open(path) as image:
        crop = alpha_crop(image) if automatic else None
        size = image.size
        if crop:
            output = io.BytesIO()
            image.crop((crop["x"], crop["y"], crop["x"]+crop["width"], crop["y"]+crop["height"])).save(output, format="PNG", compress_level=6)
            return output.getvalue(), (crop["width"], crop["height"]), crop
    return None, size, None


def save_output(job, item, directory, result, *, strokes=None, transform=None):
    save_png(result, directory / "result.png")
    thumbnail(result, directory / "thumbnail.png")
    if strokes is not None:
        item["strokes"] = strokes
    if transform is not None:
        item["transform"] = transform
        item["geometry_applied"] = True
    item["output_width"], item["output_height"] = result.size
    item["revision"] += 1
    persist(job)
    return {"revision": item["revision"], **output_metadata(item)}


def run_job(job_id):
    with LOCK:
        job = JOBS[job_id]
        if job["status"] != "queued":
            return
        job["status"] = "running"
        persist(job)
    for item in job["items"]:
        with LOCK:
            if job["status"] in {"stopping", "stopped"}:
                job.update(status="stopped", current=None, stage="Queue stopped. Finished images are saved.")
                persist(job)
                return
            if job["status"] == "pausing":
                job["status"] = "paused"
                job["stage"] = "Paused. Your completed images are saved."
                persist(job)
                return
            if item["status"] != "waiting":
                continue
            item["status"] = "running"
            job["current"] = item["id"]
            persist(job)
        directory = DATA / job_id / item["id"]
        try:
            def progress(stage):
                with LOCK:
                    if job["status"] != "stopping":
                        job["stage"] = stage
            with Image.open(directory / "original.png") as image:
                with PROCESSING_LOCK:
                    with LOCK:
                        if job["status"] == "stopping":
                            item["status"] = "cancelled"
                            job.update(status="stopped", current=None, stage="Queue stopped. Finished images are saved.")
                            persist(job)
                            return
                    result, notes = REMOVER.process(image.convert("RGBA"), job["quality"], job["mode"], progress)
            save_png(result, directory / "automatic.png")
            save_png(result, directory / "result.png")
            thumbnail(result, directory / "thumbnail.png")
            with LOCK:
                item.update(status="done", notes=notes, error=None,
                            transform={"crop": None, "resize": None},
                            geometry_applied=False,
                            output_width=result.width, output_height=result.height)
        except Exception as exc:
            with LOCK:
                item.update(status="error", error=public_error(exc, "The image could not be processed. Check the model installation, available memory, and source image, then retry."))
        with LOCK:
            if job["status"] == "stopping":
                job.update(status="stopped", current=None, stage="Queue stopped. Finished images are saved.")
                persist(job)
                return
            persist(job)
    with LOCK:
        job["status"] = "stopped" if job["status"] in {"stopping", "stopped"} else "complete"
        job["current"] = None
        job["stage"] = "Queue stopped. Finished images are saved." if job["status"] == "stopped" else "Batch finished. Review the edges before exporting."
        persist(job)


@app.get("/api/config")
def config():
    return {"appId": APP_ID, "name": APP_NAME, "version": VERSION, "token": TOKEN, "models": model_status(), "maxFiles": 50,
            "preferences": SETTINGS.get()}


@app.get("/api/settings")
def settings_status():
    return {"preferences": SETTINGS.get(), "models": model_status(verify=False),
            "integration": INTEGRATION_CONTROLLER.status() if INTEGRATION_CONTROLLER else {"enabled": False, "origin": None}}


@app.put("/api/settings")
def update_settings(values: dict):
    try:
        validated = validate_settings(values, SETTINGS.get())
        if INTEGRATION_CONTROLLER and INTEGRATION_CONTROLLER.managed_by:
            INTEGRATION_CONTROLLER.start()
        elif validated["integration_enabled"]:
            if not INTEGRATION_CONTROLLER:
                raise ValueError("Open the desktop app to enable local integrations.")
            INTEGRATION_CONTROLLER.start()
        elif INTEGRATION_CONTROLLER:
            INTEGRATION_CONTROLLER.stop()
        SETTINGS.update(validated)
        return settings_status()
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(400, public_error(exc, "Settings could not be saved. Check the output folder and try again.")) from exc


@app.get("/api/integration/key")
def integration_key(request: Request):
    if not secrets.compare_digest(request.headers.get("X-Cutout-Token", ""), TOKEN):
        raise HTTPException(403, "Open Settings in this app to copy the API key.")
    if not INTEGRATION_CONTROLLER or not INTEGRATION_CONTROLLER.status()["enabled"]:
        raise HTTPException(409, "Enable local integrations first.")
    return {"key": INTEGRATION_CONTROLLER.token}


def request_editor(project_id):
    if not re.fullmatch(r"[a-f0-9]{32}", project_id):
        raise ValueError("Editable project not found.")
    with LOCK:
        if project_id not in JOBS:
            try:
                job = json.loads((DATA / project_id / "manifest.json").read_text(encoding="utf-8"))
                if job["id"] != project_id or job["status"] != "complete":
                    raise ValueError("Project is not ready.")
                JOBS[project_id] = job
            except (OSError, ValueError, KeyError) as exc:
                raise ValueError("Editable project not found.") from exc
        if project_id not in EDITOR_REQUESTS:
            EDITOR_REQUESTS.append(project_id)
    return {"ok": True, "status": "requested"}


@app.post("/api/integration/next")
def next_editor_request():
    with LOCK:
        return {"project_id": EDITOR_REQUESTS.pop(0) if EDITOR_REQUESTS else None}


@app.get("/api/about")
def about():
    notices = ROOT / "THIRD_PARTY_NOTICES.md"
    return {"name": APP_NAME, "version": VERSION,
            "notices": notices.read_text(encoding="utf-8") if notices.is_file() else "See the licenses folder included with this application."}


@app.get("/api/jobs")
def list_jobs():
    with LOCK:
        return [{"id": j["id"], "created": j["created"], "count": len(j["items"]), "status": j["status"]} for j in sorted(JOBS.values(), key=lambda j: j["created"], reverse=True)]


@app.post("/api/jobs")
def create_job(files: list[UploadFile] = File(...), quality: str = Form("detail"), mode: str = Form("ai")):
    if not 1 <= len(files) <= 50:
        raise HTTPException(400, "Choose between 1 and 50 images per batch.")
    if quality not in MODELS or mode not in {"white", "ai"}:
        raise HTTPException(400, "Unknown processing setting.")
    # One active batch avoids surprising concurrent memory and disk consumption.
    with LOCK:
        if any(j["status"] in {"running", "queued", "pausing", "stopping"} for j in JOBS.values()):
            raise HTTPException(409, "A batch is already processing. Pause it or wait until it finishes.")
        job_id = uuid.uuid4().hex
        directory = DATA / job_id
        directory.mkdir()
        job = {"id": job_id, "created": time.time(), "quality": quality, "mode": mode, "status": "queued", "stage": "Waiting for the AI", "current": None, "items": []}
        for index, file in enumerate(files):
            item_id = uuid.uuid4().hex
            name = (file.filename or "image").replace("\\", "/").split("/")[-1][:180]
            stem = re.sub(r"[^\w .-]", "_", Path(name).stem).strip(" .")[:100] or "image"
            item = {"id": item_id, "name": name, "output": f"{index + 1:03d}_{stem}.png", "status": "waiting", "notes": [], "revision": 0, "strokes": []}
            target = directory / item_id
            target.mkdir()
            try:
                content = file.file.read(30 * 1024 * 1024 + 1)
                if len(content) > 30 * 1024 * 1024:
                    raise ValueError("Image exceeds 30 MB. Export a smaller source file.")
                image = load_image(content)
                item["width"], item["height"] = image.size
                save_png(image, target / "original.png")
            except Exception as exc:
                item.update(status="error", error=public_error(exc, "This file could not be opened. Choose a supported, undamaged image."))
            finally:
                file.file.close()
            job["items"].append(item)
        JOBS[job_id] = job
        persist(job)
        POOL.submit(run_job, job_id)
    return job


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    with LOCK:
        # Snapshot before the worker changes nested data during serialization.
        job = json.loads(json.dumps(get_job(job_id)))
        for item in job["items"]:
            if "width" in item and "height" in item:
                item.update(output_metadata(item))
        return job


@app.post("/api/jobs/{job_id}/{action}")
def control(job_id: str, action: str):
    with LOCK:
        job = get_job(job_id)
        if action == "pause" and job["status"] in {"queued", "running"}:
            job["status"] = "paused" if job["status"] == "queued" else "pausing"
        elif action == "stop" and job["status"] in {"queued", "running", "pausing", "paused"}:
            active = any(item["status"] == "running" for item in job["items"])
            for item in job["items"]:
                if item["status"] == "waiting":
                    item["status"] = "cancelled"
            job["status"] = "stopping" if active else "stopped"
            job["stage"] = "Stopping. The current image may finish; remaining images are cancelled." if active else "Queue stopped. Finished images are saved."
            if not active:
                job["current"] = None
        elif action in {"resume", "retry"} and job["status"] in {"paused", "complete", "stopped"} and not (action == "resume" and job["status"] == "stopped"):
            if any(j["status"] in {"queued", "running", "pausing", "stopping"} for j in JOBS.values()):
                raise HTTPException(409, "Another batch is processing.")
            if action == "retry":
                for item in job["items"]:
                    if item["status"] == "error" and (DATA / job_id / item["id"] / "original.png").is_file():
                        item["status"] = "waiting"
            job["status"] = "queued"
            POOL.submit(run_job, job_id)
        else:
            raise HTTPException(409, "This action is not available for the current batch state.")
        persist(job)
    return {"ok": True}


class Stroke(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    mode: str = Field(pattern="^(erase|restore|wand)$")
    size: float = Field(default=1, ge=1, le=500)
    points: list[tuple[float, float]] = Field(default_factory=list, max_length=20000)
    spans: list[tuple[int, int, int]] = Field(default_factory=list, max_length=100000)


class Edits(BaseModel):
    revision: int = Field(ge=0)
    strokes: list[Stroke] = Field(max_length=500)


class Crop(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(ge=1, le=12000)
    height: int = Field(ge=1, le=12000)


class Resize(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    width: int = Field(ge=1, le=12000)
    height: int = Field(ge=1, le=12000)


class SquareCanvas(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    size: int = Field(ge=1, le=12000)
    padding: int = Field(ge=0, le=5999)


class Transform(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    revision: int = Field(ge=0)
    crop: Crop | None = None
    resize: Resize | None = None
    canvas: SquareCanvas | None = None


class BatchTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    revision: int = Field(ge=0)


class BatchGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    items: list[BatchTarget] = Field(min_length=1, max_length=50)
    operation: str = Field(pattern="^(auto|resize|square)$")
    width: int = Field(default=512, ge=1, le=12000)
    height: int = Field(default=512, ge=1, le=12000)
    keep_proportions: bool = True
    size: int = Field(default=512, ge=1, le=12000)
    padding: int = Field(default=0, ge=0, le=5999)


def validate_batch_options(request):
    try:
        if request.operation == "square":
            normalize_transform((1, 1), {"canvas": {"size": request.size, "padding": request.padding}})
        elif request.operation == "resize":
            normalize_transform((1, 1), {"resize": {"width": request.width, "height": request.height}})
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def batch_result(item, directory, request):
    settings = normalize_transform((item["width"], item["height"]), item.get("transform"))
    if request.operation in {"auto", "square"}:
        full = render_output(directory, item.get("strokes", []), None)
        settings = {"crop": alpha_crop(full), "resize": None}
        if request.operation == "square":
            settings["canvas"] = {"size": request.size, "padding": request.padding}
        return apply_transform(full, settings), settings
    base_width, base_height = output_size((item["width"], item["height"]), {"crop": settings["crop"]})
    width, height = request.width, request.height
    if request.keep_proportions:
        scale = min(width/base_width, height/base_height)
        width, height = max(1, round(base_width*scale)), max(1, round(base_height*scale))
    settings = normalize_transform((item["width"], item["height"]), {
        "crop": settings["crop"], "resize": {"width": width, "height": height},
    })
    return render_output(directory, item.get("strokes", []), settings), settings


@app.post("/api/jobs/{job_id}/geometry/preview")
def batch_preview(job_id: str, request: BatchGeometry):
    with LOCK:
        validate_batch_options(request)
        if len(request.items) != 1:
            raise HTTPException(400, "Choose one image for the preview.")
        target = request.items[0]
        _, item, directory = get_item(job_id, target.id)
        if item["status"] != "done" or item["revision"] != target.revision:
            raise HTTPException(409, "This image changed. Refresh the batch and try again.")
        try:
            result, _ = batch_result(item, directory, request)
        except Exception as exc:
            raise HTTPException(400, public_error(exc, "This preview could not be prepared. Try another image.")) from exc
        output = io.BytesIO()
        width, height = result.size
        result.thumbnail((280, 180), Image.Resampling.LANCZOS)
        result.save(output, format="PNG")
        return Response(output.getvalue(), media_type="image/png", headers={"X-Output-Width": str(width), "X-Output-Height": str(height)})


@app.put("/api/jobs/{job_id}/geometry")
def batch_geometry(job_id: str, request: BatchGeometry):
    with LOCK:
        job = get_job(job_id)
        if job["status"] not in {"complete", "paused", "stopped"}:
            raise HTTPException(409, "Pause the batch or wait for it to finish before changing images.")
        if len({target.id for target in request.items}) != len(request.items):
            raise HTTPException(400, "Select each image only once.")
        targets = []
        for target in request.items:
            _, item, directory = get_item(job_id, target.id)
            if item["status"] != "done" or item["revision"] != target.revision:
                raise HTTPException(409, "An image changed or is not ready. Refresh the batch and try again.")
            targets.append((item, directory))
        validate_batch_options(request)
        updated, errors = [], []
        for item, directory in targets:
            try:
                result, settings = batch_result(item, directory, request)
                updated.append({"id": item["id"], **save_output(job, item, directory, result, transform=settings)})
            except Exception as exc:
                errors.append({"id": item["id"], "error": public_error(exc, "This image could not be updated. Try it again.")})
        return {"items": updated, "errors": errors}


@app.put("/api/jobs/{job_id}/items/{item_id}/edits")
def edit(job_id: str, item_id: str, edits: Edits):
    if sum(len(s.points) for s in edits.strokes) > 100000:
        raise HTTPException(400, "Too many brush points in this edit.")
    if sum(len(s.spans) for s in edits.strokes) > 200000:
        raise HTTPException(400, "Too many selection segments. Simplify this touch-up before saving.")
    with LOCK:
        job, item, directory = get_item(job_id, item_id)
        if item["status"] != "done":
            raise HTTPException(409, "Wait for this image to finish.")
        if edits.revision != item["revision"]:
            raise HTTPException(409, "This image changed in another tab. Reload it before editing.")
        for stroke in edits.strokes:
            if stroke.mode == "wand":
                if not stroke.spans or stroke.points:
                    raise HTTPException(400, "A magic-wand edit needs selected pixel spans, not brush points.")
                for y, x0, x1 in stroke.spans:
                    if not (0 <= y < item["height"] and 0 <= x0 < x1 <= item["width"]):
                        raise HTTPException(400, "Selection must stay inside the image.")
            elif not stroke.points or stroke.spans:
                raise HTTPException(400, "A brush edit needs at least one point and no selection spans.")
            if any(not (-500 <= x <= item["width"] + 500 and -500 <= y <= item["height"] + 500) for x, y in stroke.points):
                raise HTTPException(400, "Brush coordinates must be on the image.")
        strokes = [s.model_dump() for s in edits.strokes]
        result = render_output(directory, strokes, item.get("transform"))
        return save_output(job, item, directory, result, strokes=strokes)


@app.put("/api/jobs/{job_id}/items/{item_id}/transform")
def transform_image(job_id: str, item_id: str, transform: Transform):
    with LOCK:
        job, item, directory = get_item(job_id, item_id)
        if item["status"] != "done":
            raise HTTPException(409, "Wait for this image to finish.")
        if transform.revision != item["revision"]:
            raise HTTPException(409, "This image changed in another tab. Reload it before editing.")
        try:
            settings = normalize_transform((item["width"], item["height"]), transform.model_dump(exclude={"revision"}))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        result = render_output(directory, item.get("strokes", []), settings)
        return save_output(job, item, directory, result, transform=settings)


@app.get("/api/jobs/{job_id}/items/{item_id}/{kind}")
def image_file(job_id: str, item_id: str, kind: str, download: bool = False):
    with LOCK:
        _, item, directory = get_item(job_id, item_id)
        if kind not in {"original", "automatic", "result", "thumbnail", "original-thumbnail"}:
            raise HTTPException(404, "Unknown image type.")
        path = directory / f"{kind}.png"
        if kind in {"thumbnail", "original-thumbnail"} and not path.is_file():
            source = directory / ("result.png" if kind == "thumbnail" else "original.png")
            if source.is_file():
                with Image.open(source) as original:
                    thumbnail(original.convert("RGBA"), path)
        if not path.is_file():
            raise HTTPException(404, "Image is not ready.")
        if download and kind == "result":
            data, _, _ = prepare_download(item, path)
            if data is not None:
                return Response(data, media_type="image/png", headers={
                    "Content-Disposition": "attachment; filename*=utf-8''" + quote(item["output"], safe=""),
                })
        return FileResponse(path, media_type="image/png", filename=item["output"] if download else None)


def make_zip(job_id: str):
    with LOCK:
        job = get_job(job_id)
        ready = [i for i in job["items"] if i["status"] == "done"]
        if not ready:
            raise HTTPException(409, "No completed images yet.")
        # A spool avoids keeping a 50-image archive in RAM.
        import tempfile
        archive = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
        manifest = json.loads(json.dumps(job))
        metadata = {item["id"]: item for item in manifest["items"]}
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
            for item in ready:
                path = DATA / job_id / item["id"] / "result.png"
                data, size, crop = prepare_download(item, path)
                if data is None:
                    bundle.write(path, item["output"])
                else:
                    bundle.writestr(item["output"], data)
                exported = metadata[item["id"]]
                exported["output_width"], exported["output_height"] = size
                if crop:
                    exported["transform"] = {"crop": crop, "resize": None}
                    exported["auto_cropped_on_export"] = True
            bundle.writestr("batch-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.seek(0)
    return archive


@app.get("/api/jobs/{job_id}/download.zip")
def download_zip(job_id: str):
    archive = make_zip(job_id)
    def stream():
        try:
            while chunk := archive.read(1024 * 1024):
                yield chunk
        finally:
            archive.close()
    return StreamingResponse(stream(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="cutouts-' + job_id[:8] + '.zip"'})


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")


@app.post("/api/exports/{job_id}")
def export_saved(job_id: str, data: ExportRequest):
    folder = SETTINGS.get()["output_folder"]
    if not folder:
        raise HTTPException(409, "Choose an export folder in Settings first.")
    directory = Path(folder)
    source = None
    try:
        directory.mkdir(parents=True, exist_ok=True)
        with LOCK:
            if data.item_id:
                _, item, item_dir = get_item(job_id, data.item_id)
                if item["status"] != "done":
                    raise HTTPException(409, "Wait for the cutout to finish.")
                content, _, _ = prepare_download(item, item_dir / "result.png")
                source = io.BytesIO(content) if content is not None else (item_dir / "result.png").open("rb")
                name = item["output"]
            else:
                source = make_zip(job_id)
                name = "cutouts-" + job_id[:8] + ".zip"
            # Filenames come from saved projects, never from an arbitrary caller path.
            name = Path(name.replace("\\", "/")).name
            for counter in range(10000):
                target = directory / (name if counter == 0 else f"{Path(name).stem} ({counter+1}){Path(name).suffix}")
                try:
                    output = target.open("xb")
                    break
                except FileExistsError:
                    continue
            else:
                raise HTTPException(409, "Choose another output folder.")
            try:
                with output:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
            except BaseException:
                target.unlink(missing_ok=True)
                raise
        return {"ok": True, "name": target.name, "path": str(target), "folder": str(directory)}
    except OSError as exc:
        raise HTTPException(400, "The export could not be saved. Check folder permissions or choose another folder.") from exc
    finally:
        if source:
            source.close()


app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
