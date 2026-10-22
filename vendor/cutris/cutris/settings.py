"""Validated preferences shared by the editor and local integrations."""
from __future__ import annotations
import json
import os
from pathlib import Path
import threading
import time

from app_paths import DATA_DIR

DEFAULTS = {"output_folder": "", "quality": "detail", "mode": "ai", "auto_crop": True,
            "preview_background": "checker", "wheel_zoom": True, "integration_enabled": False}


def validate_settings(values, current=None):
    if not isinstance(values, dict) or set(values) - set(DEFAULTS):
        raise ValueError("Unknown setting.")
    result = {**DEFAULTS, **(current or {}), **values}
    for key in ("auto_crop", "wheel_zoom", "integration_enabled"):
        if type(result[key]) is not bool:
            raise ValueError("Choose an enabled or disabled value.")
    for key, choices in {"quality": {"detail", "fast"}, "mode": {"ai", "white"},
                         "preview_background": {"checker", "#ffffff", "#252638", "#dbb3d5"}}.items():
        if not isinstance(result[key], str) or result[key] not in choices:
            raise ValueError("Choose an available " + key.replace("_", " ") + ".")
    folder = result["output_folder"]
    if not isinstance(folder, str) or len(folder) > 4096 or any(ord(c) < 32 for c in folder):
        raise ValueError("Choose a valid output folder.")
    if folder:
        path = Path(folder).expanduser()
        if not path.is_absolute():
            raise ValueError("Choose an absolute output folder.")
        if path.exists() and not path.is_dir():
            raise ValueError("Choose a folder rather than a file.")
        result["output_folder"] = str(path.resolve())
    return result


class SettingsStore:
    def __init__(self, path=None):
        self.path = Path(path) if path else DATA_DIR / "settings.json"
        self.lock = threading.RLock()

    def get(self):
        with self.lock:
            try:
                return validate_settings(json.loads(self.path.read_text(encoding="utf-8")))
            except (OSError, ValueError, TypeError):
                return dict(DEFAULTS)

    def update(self, values):
        with self.lock:
            result = validate_settings(values, self.get())
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(json.dumps(result, indent=2), encoding="utf-8")
            for attempt in range(5):
                try:
                    os.replace(temporary, self.path)
                    break
                except PermissionError:
                    if attempt == 4:
                        raise
                    time.sleep(.03 * (attempt + 1))
            return result
