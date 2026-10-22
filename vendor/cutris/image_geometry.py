"""Non-destructive output geometry, applied after source-coordinate touch-ups."""
from __future__ import annotations

from PIL import Image

from engine import MAX_PIXELS

MAX_SIDE = 12_000


def normalize_transform(source_size: tuple[int, int], transform: dict | None = None) -> dict:
    """Validate geometry without allowing implicit casts or oversized output."""
    if transform is None:
        transform = {}
    if not isinstance(transform, dict) or set(transform) - {"crop", "resize", "canvas"}:
        raise ValueError("Unknown crop or resize setting.")
    width, height = source_size
    crop = transform.get("crop")
    resize = transform.get("resize")
    canvas = transform.get("canvas")
    if crop is not None:
        if not isinstance(crop, dict) or set(crop) != {"x", "y", "width", "height"}:
            raise ValueError("Choose a complete crop rectangle.")
        if any(type(value) is not int for value in crop.values()):
            raise ValueError("Crop coordinates must be whole pixels.")
        if crop["x"] < 0 or crop["y"] < 0 or crop["width"] < 1 or crop["height"] < 1:
            raise ValueError("Crop must have a positive size and stay inside the image.")
        if crop["x"] + crop["width"] > width or crop["y"] + crop["height"] > height:
            raise ValueError("Crop must stay inside the original image.")
        width, height = crop["width"], crop["height"]
        crop = dict(crop)
    if resize is not None:
        if not isinstance(resize, dict) or set(resize) != {"width", "height"}:
            raise ValueError("Choose both output dimensions.")
        if any(type(value) is not int for value in resize.values()):
            raise ValueError("Output dimensions must be whole pixels.")
        width, height = resize["width"], resize["height"]
        resize = dict(resize)
    if min(width, height) < 1 or max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
        raise ValueError("Output is too large. Maximum: 24 megapixels and 12,000px per side; dimensions must be positive.")
    settings = {"crop": crop, "resize": resize}
    if canvas is not None:
        if not isinstance(canvas, dict) or set(canvas) != {"size", "padding"}:
            raise ValueError("Choose a square canvas size and padding.")
        if any(type(value) is not int for value in canvas.values()):
            raise ValueError("Canvas size and padding must be whole pixels.")
        size, padding = canvas["size"], canvas["padding"]
        if size < 1 or size > MAX_SIDE or size * size > MAX_PIXELS:
            raise ValueError("Square canvases must fit within 24 megapixels and 12,000px per side.")
        if padding < 0 or padding * 2 >= size:
            raise ValueError("Padding must leave at least one pixel for the image.")
        settings["canvas"] = dict(canvas)
    return settings


def output_size(source_size: tuple[int, int], transform: dict | None = None) -> tuple[int, int]:
    settings = normalize_transform(source_size, transform)
    if canvas := settings.get("canvas"):
        return canvas["size"], canvas["size"]
    geometry = settings["resize"] or settings["crop"]
    return (geometry["width"], geometry["height"]) if geometry else source_size


def apply_transform(image: Image.Image, transform: dict | None = None) -> Image.Image:
    """Crop, then resize with premultiplied alpha so hidden colors cannot fringe."""
    settings = normalize_transform(image.size, transform)
    result = image.convert("RGBA")
    if crop := settings["crop"]:
        result = result.crop((crop["x"], crop["y"], crop["x"] + crop["width"], crop["y"] + crop["height"]))
    if resize := settings["resize"]:
        size = (resize["width"], resize["height"])
        if size != result.size:
            result = result.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")
    if canvas := settings.get("canvas"):
        inner = canvas["size"] - 2 * canvas["padding"]
        scale = min(inner / result.width, inner / result.height)
        size = (max(1, round(result.width * scale)), max(1, round(result.height * scale)))
        if size != result.size:
            result = result.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")
        square = Image.new("RGBA", (canvas["size"], canvas["size"]), (0, 0, 0, 0))
        square.paste(result, ((square.width-result.width)//2, (square.height-result.height)//2))
        result = square
    return result
