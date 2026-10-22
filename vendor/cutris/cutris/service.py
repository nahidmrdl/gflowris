"""Authenticated, loopback HTTP API independent of the desktop application."""
from __future__ import annotations

from contextlib import asynccontextmanager
import io
import json
import os
from pathlib import Path
import secrets
import socket
import threading

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, ConfigDict, Field

from app_paths import VERSION, DATA_DIR, public_error
from model_manager import ModelDownloadError, model_status
from .processing import MAX_BYTES, Processor, finish_output


class EditorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str = Field(pattern=r"^[a-f0-9]{32}$")


def user_state() -> Path:
    if os.environ.get("CUTRIS_API_STATE"):
        return Path(os.environ["CUTRIS_API_STATE"]).expanduser().resolve()
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share"))
    return base / "Cutris" / "api"


def create_app(token: str, *, processor=None, download_models=False, editor_callback=None, editor_available=None):
    if len(token) < 32:
        raise ValueError("Use an API key of at least 32 characters.")
    worker = processor or Processor()
    admission = threading.Lock()
    app = FastAPI(title="cutris API", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if not secrets.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
            return JSONResponse({"detail": "A valid Cutris API key is required."}, status_code=401)
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "Origin rejected."}, status_code=403)
        length = request.headers.get("content-length")
        if length and (not length.isdecimal() or int(length) > MAX_BYTES + 65536):
            return JSONResponse({"detail": "Image exceeds 30 MB."}, status_code=413)
        received = 0
        original_receive = request._receive

        async def receive():
            nonlocal received
            message = await original_receive()
            received += len(message.get("body", b""))
            if received > MAX_BYTES + 65536:
                raise HTTPException(413, "Image exceeds 30 MB.")
            return message

        request._receive = receive
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/v1/health")
    def health():
        return {"name": "cutris", "version": VERSION, "api_version": 1,
                "desktop_required": False, "download_models": download_models,
                "editor_available": bool(editor_available() if editor_available else editor_callback)}

    @app.post("/v1/editor/open")
    def open_editor(data: EditorRequest):
        if not editor_callback or (editor_available and not editor_available()):
            raise HTTPException(409, "Open the Cutris desktop editor to review this project.")
        try:
            return editor_callback(data.project_id)
        except ValueError as exc:
            raise HTTPException(404, public_error(exc, "Editable project not found.")) from exc

    @app.get("/v1/models")
    def models():
        return {"models": model_status(verify=False)}

    @app.get("/v1/projects/{project_id}/result")
    def project_result(project_id: str):
        import re
        from . import projects
        from fastapi.responses import FileResponse
        if not re.fullmatch(r"[a-f0-9]{32}", project_id):
            raise HTTPException(404, "Editable project not found.")
        directory = projects.DATA_DIR / "jobs" / project_id
        try:
            job = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
            item = job["items"][0]
            if job["id"] != project_id or not re.fullmatch(r"[a-f0-9]{32}", item["id"]) or item["status"] != "done":
                raise ValueError("Project not ready.")
            result = directory / item["id"] / "result.png"
            if not result.is_file():
                raise ValueError("Result unavailable.")
            return FileResponse(result, media_type="image/png", filename="cutout.png", headers={
                "X-Cutris-Project": project_id, "X-Cutris-Revision": str(item["revision"]),
                "X-Cutris-Width": str(item["output_width"]), "X-Cutris-Height": str(item["output_height"])})
        except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
            raise HTTPException(404, "Editable project not found.") from exc

    @app.get("/v1/projects/{project_id}")
    def project_state(project_id: str):
        import re
        from . import projects
        if not re.fullmatch(r"[a-f0-9]{32}", project_id):
            raise HTTPException(404, "Editable project not found.")
        try:
            job = json.loads((projects.DATA_DIR / 'jobs' / project_id / 'manifest.json').read_text(encoding='utf-8'))
            item = job['items'][0]
            if job['id'] != project_id or item['status'] != 'done':
                raise ValueError('Project unavailable.')
            return {'project_id':project_id, 'revision':item['revision'],
                    'width':item['output_width'], 'height':item['output_height']}
        except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
            raise HTTPException(404, 'Editable project not found.') from exc

    @app.post("/v1/remove")
    def remove(file: UploadFile = File(...), quality: str = Form("detail"), mode: str = Form("ai"),
               auto_crop: bool = Form(True), width: int | None = Form(None), height: int | None = Form(None),
               editable: bool = Form(False)):
        if not admission.acquire(blocking=False):
            file.file.close()
            raise HTTPException(409, "Cutris is processing another image. Wait before retrying.")
        try:
            if (width is None) != (height is None):
                raise ValueError("Provide both width and height to resize.")
            content = file.file.read(MAX_BYTES + 1)
            automatic, metadata = worker.remove(content, quality=quality, mode=mode, auto_crop=False,
                                                download_models=download_models)
            image, transform = finish_output(automatic, auto_crop=auto_crop,
                                             resize={"width": width, "height": height} if width is not None else None)
            headers = {"Content-Disposition": 'attachment; filename="cutout.png"',
                       "X-Cutris-Width": str(image.width), "X-Cutris-Height": str(image.height),
                       "X-Cutris-Crop": json.dumps(transform["crop"], separators=(",", ":"))}
            if editable:
                from .projects import save_project
                headers["X-Cutris-Project"] = save_project(content, automatic, image, transform,
                                                         name=file.filename, quality=quality, mode=mode,
                                                         notes=metadata["notes"])
            output = io.BytesIO()
            image.save(output, format="PNG", compress_level=6)
            return Response(output.getvalue(), media_type="image/png", headers=headers)
        except ModelDownloadError as exc:
            raise HTTPException(503, "The requested model is unavailable. Run cutris models download, or start serve with --download-models.") from exc
        except ValueError as exc:
            raise HTTPException(400, public_error(exc)) from exc
        except Exception as exc:
            raise HTTPException(500, "Background removal failed. Check model installation and available memory.") from exc
        finally:
            file.file.close()
            admission.release()

    return app


def serve(*, port=4320, key_file=None, descriptor=None, download_models=False):
    import uvicorn
    folder = user_state()
    folder.mkdir(parents=True, exist_ok=True)
    key_path = Path(key_file) if key_file else folder / "api-key"
    key_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with key_path.open("x", encoding="utf-8") as stream:
            stream.write(secrets.token_urlsafe(48))
        key_path.chmod(0o600)
    except FileExistsError:
        pass
    token = key_path.read_text(encoding="utf-8").strip()
    app = create_app(token, download_models=download_models)
    listener = socket.socket()
    listener.bind(("127.0.0.1", port))
    descriptor_path = Path(descriptor) if descriptor else folder / "service.json"
    descriptor_path.parent.mkdir(parents=True, exist_ok=True)
    identity = secrets.token_hex(16)

    @asynccontextmanager
    async def lifespan(_):
        temporary = descriptor_path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"name": "cutris", "api_version": 1, "instance": identity,
                                        "origin": f"http://127.0.0.1:{listener.getsockname()[1]}",
                                        "key_file": str(key_path.resolve()), "pid": os.getpid(),
                                        "source": "background", "data_dir": str(DATA_DIR.resolve())}), encoding="utf-8")
        temporary.chmod(0o600)
        os.replace(temporary, descriptor_path)
        try:
            yield
        finally:
            try:
                if json.loads(descriptor_path.read_text())["instance"] == identity:
                    descriptor_path.unlink()
            except (OSError, ValueError, KeyError):
                pass

    app.router.lifespan_context = lifespan
    try:
        uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False)).run(sockets=[listener])
    finally:
        listener.close()
