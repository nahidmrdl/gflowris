"""Save editable cutouts in the same project format used by the desktop editor."""
import json
from pathlib import Path
import re
import time
import uuid

from app_paths import DATA_DIR
from engine import load_image, save_png


def save_project(content, automatic, output, transform, *, name, quality, mode, notes):
    job_id, item_id = uuid.uuid4().hex, uuid.uuid4().hex
    folder = DATA_DIR / "jobs" / job_id / item_id
    folder.mkdir(parents=True)
    name = str(name or "image").replace("\\", "/").split("/")[-1][:180]
    stem = re.sub(r"[^\w .-]", "_", Path(name).stem).strip(" .")[:100] or "image"
    save_png(load_image(content), folder / "original.png")
    save_png(automatic, folder / "automatic.png")
    save_png(output, folder / "result.png")
    preview = output.copy()
    preview.thumbnail((128, 128))
    save_png(preview, folder / "thumbnail.png")
    item = {"id": item_id, "name": name, "output": stem + "-cutout.png", "status": "done",
            "notes": notes, "revision": 0, "strokes": [], "width": automatic.width,
            "height": automatic.height, "output_width": output.width, "output_height": output.height,
            "transform": transform, "geometry_applied": True, "error": None}
    job = {"id": job_id, "created": time.time(), "quality": quality, "mode": mode,
           "status": "complete", "stage": "Cutout ready for review.", "current": None, "items": [item]}
    temporary = folder.parent / "manifest.tmp"
    temporary.write_text(json.dumps(job, indent=2), encoding="utf-8")
    temporary.replace(folder.parent / "manifest.json")
    return job_id
