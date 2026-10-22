"""Headless processing built on the same inference and geometry as the editor."""
from __future__ import annotations

import threading
from pathlib import Path

from engine import Remover, load_image, save_png
from image_geometry import apply_transform
from model_manager import ensure_model, require_model

MAX_BYTES = 30 * 1024 * 1024


class Processor:
    def __init__(self, *, remover=None, lock=None):
        self.remover = remover if remover is not None else Remover()
        self.lock = lock if lock is not None else threading.Lock()

    def remove(self, content: bytes, *, quality="detail", mode="ai", auto_crop=True,
               resize=None, download_models=False, progress=lambda stage: None):
        if quality not in {"detail", "fast"} or mode not in {"ai", "white"}:
            raise ValueError("Choose quality detail/fast and mode ai/white.")
        if len(content) > MAX_BYTES:
            raise ValueError("Image exceeds 30 MB.")
        image = load_image(content)
        source_size = image.size
        with self.lock:
            if image.getchannel("A").getextrema()[0] >= 250:
                if download_models:
                    ensure_model(quality, progress=lambda event: progress(event.message))
                else:
                    require_model(quality)
            result, notes = self.remover.process(image, quality, mode, progress)
        output, transform = finish_output(result, auto_crop=auto_crop, resize=resize)
        return output, {"source_width": source_size[0], "source_height": source_size[1],
                        "width": output.width, "height": output.height,
                        "crop": transform["crop"], "notes": notes}


def finish_output(image, *, auto_crop=True, resize=None):
    bounds = image.getchannel("A").getbbox() if auto_crop else None
    crop = None
    if bounds and bounds != (0, 0, *image.size):
        left, top, right, bottom = bounds
        crop = {"x": left, "y": top, "width": right-left, "height": bottom-top}
    transform = {"crop": crop, "resize": resize}
    return apply_transform(image, transform), transform


def write_output(image, destination: Path, *, overwrite=False):
    destination.parent.mkdir(parents=True, exist_ok=True)
    reserved = False
    if not overwrite:
        with destination.open("xb"):
            reserved = True
    try:
        save_png(image, destination)
    except BaseException:
        if reserved:
            destination.unlink(missing_ok=True)
        raise
