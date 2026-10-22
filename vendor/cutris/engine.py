"""Local BiRefNet inference and conservative, white-background edge refinement."""
from __future__ import annotations

import io
import os
from pathlib import Path
import warnings

from app_paths import RESOURCE_DIR
from model_manager import require_model

import cv2
import numpy as np
from PIL import Image, ImageCms, ImageOps
from scipy import ndimage

ROOT = RESOURCE_DIR
MAX_PIXELS = 24_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
MODELS = {"detail": "birefnet-general.onnx", "fast": "birefnet-lite.onnx"}


def load_image(data: bytes) -> Image.Image:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP", "BMP", "TIFF"}:
                raise ValueError("Use a PNG, JPG, WebP, BMP, or TIFF image.")
            if getattr(source, "n_frames", 1) != 1:
                raise ValueError("Animated or multi-page images are not supported. Export one still image first.")
            if source.width * source.height > MAX_PIXELS or max(source.size) > 12000:
                raise ValueError("Image is too large. Maximum: 24 megapixels and 12,000px per side.")
            source.load()
            image = ImageOps.exif_transpose(source)
            alpha = image.convert("RGBA").getchannel("A")
            profile = image.info.get("icc_profile")
            if profile:
                try:
                    color_source = image if image.mode in {"RGB", "CMYK", "LAB", "L"} else image.convert("RGB")
                    image = ImageCms.profileToProfile(color_source, ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile("sRGB"), outputMode="RGB")
                except (ImageCms.PyCMSError, OSError):
                    image = image.convert("RGB")
            image = image.convert("RGBA")
            image.putalpha(alpha)
            return image


def save_png(image: Image.Image, path: Path) -> None:
    temporary = path.with_suffix(".tmp")
    image.save(temporary, format="PNG", compress_level=6,
               icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
    os.replace(temporary, path)


class Remover:
    def __init__(self):
        self.session = None
        self.quality = None

    def predict(self, image: Image.Image, quality: str = "detail") -> np.ndarray:
        import onnxruntime as ort
        if self.session is None or self.quality != quality:
            model = require_model(quality)
            self.session = None  # Keep only one large model in RAM at a time.
            options = ort.SessionOptions()
            options.intra_op_num_threads = min(6, max(1, (os.cpu_count() or 4) // 2))
            options.inter_op_num_threads = 1
            self.session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
            self.quality = quality
        resized = image.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
        array = np.asarray(resized, dtype=np.float32) / 255.0
        array = (array - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
        tensor = np.ascontiguousarray(array.transpose(2, 0, 1)[None])
        output = self.session.run(None, {self.session.get_inputs()[0].name: tensor})[0]
        prediction = 1 / (1 + np.exp(-np.clip(np.squeeze(output), -60, 60)))
        low, high = float(prediction.min()), float(prediction.max())
        if high - low > 1e-5:
            prediction = (prediction - low) / (high - low)
        return np.clip(cv2.resize(prediction, image.size, interpolation=cv2.INTER_LINEAR), 0, 1)

    def process(self, source: Image.Image, quality: str, mode: str, progress=lambda _: None):
        notes = []
        original = np.asarray(source)
        if np.any(original[:, :, 3] < 250):
            notes.append("Input already has transparency; its existing alpha was preserved. Touch up if needed.")
            return source.copy(), notes
        progress("AI is finding the subject")
        alpha = self.predict(source, quality)
        progress("Refining full-resolution edges")
        rgb = original[:, :, :3].astype(np.float32) / 255.0
        if mode == "white":
            rgb, alpha, refinement_notes = refine_white(rgb, alpha)
            notes.extend(refinement_notes)
        else:
            notes.append("AI-only mode preserves the model’s soft edges. Inspect pale details and shadows.")
        if (alpha > .5).mean() < .001:
            notes.append("Very little foreground was detected. Review or restore details before downloading.")
        if (alpha > .5).mean() > .97:
            notes.append("Almost the whole image was retained. Check the result or try another mode.")
        rgba = np.dstack((np.clip(rgb * 255, 0, 255).round().astype(np.uint8), np.clip(alpha * 255, 0, 255).round().astype(np.uint8)))
        rgba[rgba[:, :, 3] == 0, :3] = 0
        progress("Writing transparent PNG")
        return Image.fromarray(rgba), notes


def refine_white(rgb: np.ndarray, mask: np.ndarray):
    """Use AI to protect white foreground; only unmix colors near its silhouette.

    This is not a global 'delete white' operation. Enclosed eye highlights and
    white clothes remain opaque when the segmentation identifies them as subject.
    """
    notes = []
    border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]))
    pale = (border.min(axis=1) > .92) & (np.ptp(border, axis=1) < .06)
    if pale.mean() < .65:
        return rgb, mask, ["Border is not consistently white. Used AI-only removal to avoid damaging the subject."]
    background = np.median(border[pale], axis=0)
    alpha = mask.copy()
    difference = np.max(np.abs(rgb - background), axis=2)
    almost_white = difference < .055
    # Flood through likely background only; never flood through a confident subject.
    candidate = almost_white & (mask < .96)
    seeds = np.zeros(candidate.shape, bool)
    seeds[0] = candidate[0]; seeds[-1] = candidate[-1]
    seeds[:, 0] = candidate[:, 0]; seeds[:, -1] = candidate[:, -1]
    exterior = ndimage.binary_propagation(seeds, mask=candidate)
    alpha[exterior | ((mask < .04) & almost_white)] = 0
    radius = min(12, max(3, round(max(mask.shape) / 512)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    support = (alpha > .5).astype(np.uint8)
    # Sample foreground from beyond the entire edge band. A one-pixel core can
    # mistake an opaque JPEG fringe for the true subject color.
    core = cv2.erode((alpha > .97).astype(np.uint8), kernel).astype(bool)
    boundary = (cv2.dilate(support, kernel) != cv2.erode(support, kernel)) & ~core
    if core.any() and boundary.any():
        nearest = ndimage.distance_transform_edt(~core, return_distances=False, return_indices=True)
        rows, cols = np.where(boundary)
        foreground = rgb[nearest[0, rows, cols], nearest[1, rows, cols]]
        observed = rgb[rows, cols]
        direction = background - foreground
        contrast = np.sum(direction * direction, axis=1)
        estimated = np.sum((background - observed) * direction, axis=1) / np.maximum(contrast, 1e-6)
        # On white subjects the equation is ambiguous: retain the AI alpha.
        reliable = contrast > .018
        values = np.clip(estimated, 0, 1)
        alpha[rows[reliable], cols[reliable]] = values[reliable]
        edge = reliable & (values > .015) & (values < .995)
        if edge.any():
            a = values[edge, None]
            clean = (observed[edge] - (1 - a) * background) / np.maximum(a, .015)
            rgb = rgb.copy()
            rgb[rows[edge], cols[edge]] = np.clip(clean, 0, 1)
        del nearest
    alpha[(mask < .015) & ~boundary] = 0
    alpha[alpha < 1 / 255] = 0
    alpha[alpha > 254 / 255] = 1
    notes.append("White-paper edge cleanup applied. Review white details and transparent objects at 100%.")
    return rgb, alpha, notes


def apply_strokes(original: Image.Image, automatic: Image.Image, strokes: list[dict]) -> Image.Image:
    """Replay restore/erase strokes in original-image pixels; no browser resizing."""
    source = np.asarray(original)
    rgba = np.array(automatic)
    height, width = rgba.shape[:2]
    for stroke in strokes:
        if stroke["mode"] == "wand":
            # Store exact original-resolution pixel runs so reload/export never
            # re-selects a different region after another edit or model change.
            for y, x0, x1 in stroke["spans"]:
                rgba[y, x0:x1, 3] = 0
            continue
        points = stroke["points"]
        radius = stroke["size"] / 2
        xs, ys = [point[0] for point in points], [point[1] for point in points]
        x0, y0 = max(0, int(min(xs) - radius - 3)), max(0, int(min(ys) - radius - 3))
        x1, y1 = min(width, int(max(xs) + radius + 4)), min(height, int(max(ys) + radius + 4))
        if x0 >= x1 or y0 >= y1:
            continue
        paint = np.zeros((y1 - y0, x1 - x0), np.uint8)
        coordinates = np.array([[round(x - x0), round(y - y0)] for x, y in points], np.int32)
        thickness = max(1, round(stroke["size"]))
        if len(coordinates) > 1:
            cv2.polylines(paint, [coordinates], False, 255, thickness, cv2.LINE_AA)
        for point in (coordinates[0], coordinates[-1]):
            cv2.circle(paint, tuple(point), max(1, thickness // 2), 255, -1, cv2.LINE_AA)
        strength = paint.astype(np.float32) / 255
        region = rgba[y0:y1, x0:x1]
        if stroke["mode"] == "erase":
            region[:, :, 3] = np.round(region[:, :, 3] * (1 - strength)).astype(np.uint8)
        else:
            original_region = source[y0:y1, x0:x1]
            a = region[:, :, 3].astype(np.float32) / 255
            b = original_region[:, :, 3].astype(np.float32) / 255 * strength
            combined = b + a * (1 - b)
            color = (original_region[:, :, :3] * b[:, :, None] + region[:, :, :3] * (a * (1 - b))[:, :, None]) / np.maximum(combined[:, :, None], 1e-8)
            region[:, :, :3] = color.round().clip(0, 255).astype(np.uint8)
            region[:, :, 3] = np.round(combined * 255).astype(np.uint8)
    rgba[rgba[:, :, 3] == 0, :3] = 0
    return Image.fromarray(rgba)
