"""Separate immutable application files from each user's private local storage."""
from __future__ import annotations

import os
import re
import json
from pathlib import Path
import sys

APP_ID = "cutout-studio"
FROZEN = bool(getattr(sys, "frozen", False))
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
SOURCE_CHECKOUT = (RESOURCE_DIR / "branding.json").is_file() and not FROZEN
if not (RESOURCE_DIR / "branding.json").is_file():
    RESOURCE_DIR = RESOURCE_DIR / "cutris" / "resources"
BRANDING = json.loads((RESOURCE_DIR / "branding.json").read_text(encoding="utf-8"))
APP_NAME = BRANDING["display_name"]
VERSION = BRANDING["version"]
PUBLISHER = BRANDING["publisher"]


def storage_root() -> Path:
    if os.environ.get("CUTOUT_HOME"):
        return Path(os.environ["CUTOUT_HOME"]).expanduser().resolve()
    if not FROZEN and SOURCE_CHECKOUT:
        # Preserve saved work in an existing source checkout.
        return RESOURCE_DIR
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return base / "CutoutStudio"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / APP_ID


STORAGE_DIR = storage_root()
DATA_DIR = Path(os.environ.get("CUTOUT_DATA", str(STORAGE_DIR / "data")))
MODEL_DIR = Path(os.environ.get("CUTOUT_MODELS", str(STORAGE_DIR / "models")))


def ensure_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)


def public_error(error: Exception, fallback: str = "The operation could not finish. Please try again.") -> str:
    """Keep machine paths and library diagnostics out of UI and export manifests."""
    if isinstance(error, (ValueError, RuntimeError)):
        message = str(error)
        has_path = re.search(r"[A-Za-z]:[\\/]|\\\\[^\\]|/(?:Users|home|tmp|var|mnt)/", message)
        if message and not has_path and not any(marker in message for marker in ("Traceback", "site-packages", "0x")):
            return message[:400]
    return fallback
