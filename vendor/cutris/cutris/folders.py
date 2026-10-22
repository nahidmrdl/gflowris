"""Native folder actions shared by Cutris and embedded desktop workspaces."""
from __future__ import annotations

import os
from pathlib import Path
import sys


def folder_path(value):
    if not isinstance(value, (str, os.PathLike)) or not str(value).strip():
        raise ValueError("Choose a folder first.")
    text = str(value)
    if len(text) > 4096 or any(ord(char) < 32 for char in text):
        raise ValueError("Choose a valid folder.")
    folder = Path(text).expanduser()
    if not folder.is_absolute():
        raise ValueError("Choose an absolute folder path.")
    if folder.exists() and not folder.is_dir():
        raise ValueError("Choose a folder rather than a file.")
    return folder.resolve()


def open_folder(value):
    folder = folder_path(value)
    if sys.platform != "win32":
        raise RuntimeError("Opening folders requires the Windows desktop app.")
    try:
        folder.mkdir(parents=True, exist_ok=True)
        # Use the Windows shell's folder verb and explicitly request a visible
        # window. No console, command-line quoting, or hidden Explorer process.
        os.startfile(str(folder), "explore", show_cmd=1)
    except OSError as error:
        raise RuntimeError("Windows could not open this folder. Check access or choose another folder.") from error
    return {"ok": True, "folder": str(folder)}


def choose_folder(window, initial_folder=None):
    if window is None:
        raise RuntimeError("The desktop connection is not ready. Reopen the app and try again.")
    import webview

    initial = ""
    if initial_folder:
        try:
            candidate = folder_path(initial_folder)
            while not candidate.exists() and candidate != candidate.parent:
                candidate = candidate.parent
            if candidate.is_dir():
                initial = str(candidate)
        except (OSError, ValueError):
            pass
    try:
        selected = window.create_file_dialog(webview.FileDialog.FOLDER, directory=initial, allow_multiple=False)
    except Exception as error:
        raise RuntimeError("The folder picker could not open. Reopen the desktop app and try again.") from error
    if not selected:
        return {"ok": True, "folder": None, "cancelled": True}
    value = selected[0] if isinstance(selected, (tuple, list)) else selected
    return {"ok": True, "folder": str(folder_path(value)), "cancelled": False}
