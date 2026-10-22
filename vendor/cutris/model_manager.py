"""Verified, resumable model downloads shared by setup and the desktop app.

Only pinned public BiRefNet weights are downloaded. Image data is never sent to
the model host. Model files live outside the installation directory so an app
update does not download them again.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import http.client
import os
from pathlib import Path
import re
import threading
import time
from typing import Callable, Iterable
import urllib.error
import urllib.request

from app_paths import APP_NAME, VERSION, MODEL_DIR, RESOURCE_DIR


@dataclass(frozen=True)
class ModelSpec:
    quality: str
    filename: str
    label: str
    size: int
    sha256: str
    md5: str
    url: str


_BASE_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/"
MODELS = {
    "detail": ModelSpec(
        "detail", "birefnet-general.onnx", "Best detail", 972_666_916,
        "58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c",
        "7a35a0141cbbc80de11d9c9a28f52697",
        _BASE_URL + "BiRefNet-general-epoch_244.onnx",
    ),
    "fast": ModelSpec(
        "fast", "birefnet-lite.onnx", "Fast", 224_005_088,
        "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333",
        "4fab47adc4ff364be1713e97b7e66334",
        _BASE_URL + "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
    ),
}


@dataclass(frozen=True)
class ModelProgress:
    quality: str
    phase: str
    downloaded: int
    total: int
    message: str
    attempt: int = 1


class ModelDownloadError(RuntimeError):
    """A model setup error whose message is safe to display to the user."""


class ModelDownloadCancelled(ModelDownloadError):
    pass


ProgressCallback = Callable[[ModelProgress], None]
CancellationCheck = Callable[[], bool]
_verified: dict[Path, tuple[int, int, str]] = {}
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _spec(quality: str) -> ModelSpec:
    aliases = {"general": "detail", "lite": "fast"}
    try:
        return MODELS[aliases.get(quality, quality)]
    except (KeyError, TypeError):
        raise ValueError("Choose the Fast or Best detail AI model.") from None


def _cancelled(cancelled: CancellationCheck | None) -> None:
    if cancelled is not None and cancelled():
        raise ModelDownloadCancelled("Download cancelled. Setup can resume it later.")


def _emit(progress: ProgressCallback | None, spec: ModelSpec, phase: str,
          downloaded: int = 0, message: str = "", attempt: int = 1) -> None:
    if progress is not None:
        progress(ModelProgress(spec.quality, phase, downloaded, spec.size, message, attempt))


def _matches(path: Path, spec: ModelSpec, cancelled: CancellationCheck | None = None) -> bool:
    """Hash once per file version, including bundled/development weights."""
    try:
        stat = path.stat()
        if not path.is_file() or stat.st_size != spec.size:
            return False
        key = path.resolve()
        signature = (stat.st_size, stat.st_mtime_ns, spec.sha256)
        if _verified.get(key) == signature:
            return True
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                _cancelled(cancelled)
                digest.update(chunk)
        if digest.hexdigest() != spec.sha256:
            return False
        # Do not cache a verification if another process changed the file.
        current = path.stat()
        if (current.st_size, current.st_mtime_ns) != signature[:2]:
            return False
        _verified[key] = signature
        return True
    except OSError:
        return False


def _candidates(spec: ModelSpec) -> list[Path]:
    paths = [Path(MODEL_DIR) / spec.filename, Path(RESOURCE_DIR) / "models" / spec.filename]
    return list(dict.fromkeys(paths))


def _has_expected_size(path: Path, spec: ModelSpec) -> bool:
    try:
        return path.is_file() and path.stat().st_size == spec.size
    except OSError:
        return False


def model_path(quality: str, *, verify: bool = False) -> Path:
    """Return a local model path, or the intended cache path if it is missing.

    Use ``ensure_model`` before inference when integrity must be checked. This
    read-only lookup does not download anything.
    """
    spec = _spec(quality)
    for path in _candidates(spec):
        if (_matches(path, spec) if verify else _has_expected_size(path, spec)):
            return path
    return _candidates(spec)[0]


def require_model(quality: str) -> Path:
    """Resolve verified local weights for inference, without downloading."""
    spec = _spec(quality)
    for path in _candidates(spec):
        if _matches(path, spec):
            return path
    raise ModelDownloadError(f"The {spec.label} AI model is missing or needs repair. Open AI model setup to download it.")


def installed_models(*, verify: bool = False) -> dict[str, bool]:
    """Report the installed qualities without making a network request."""
    result = {}
    for quality, spec in MODELS.items():
        path = model_path(quality, verify=verify)
        result[quality] = _matches(path, spec) if verify else _has_expected_size(path, spec)
    return result


def model_status(*, verify: bool = True) -> dict[str, bool]:
    """App-facing status; by default only intact pinned model files count."""
    return installed_models(verify=verify)


@contextmanager
def _download_lock(spec: ModelSpec, cancelled: CancellationCheck | None):
    """Serialize setup/app downloads, including separate Windows processes."""
    with _locks_guard:
        lock = _locks.setdefault(spec.quality, threading.Lock())
    while not lock.acquire(timeout=0.1):
        _cancelled(cancelled)
    stream = None
    locked = False
    try:
        Path(MODEL_DIR).mkdir(parents=True, exist_ok=True)
        stream = (Path(MODEL_DIR) / (spec.filename + ".lock")).open("a+b")
        if stream.tell() == 0:
            stream.write(b"\0")
            stream.flush()
        while not locked:
            _cancelled(cancelled)
            try:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except (BlockingIOError, PermissionError):
                time.sleep(0.1)
        yield
    finally:
        if stream is not None:
            if locked:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
            stream.close()
        lock.release()


def _download(spec: ModelSpec, partial: Path, progress: ProgressCallback | None,
              cancelled: CancellationCheck | None, attempt: int) -> None:
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > spec.size:
        partial.unlink()
        offset = 0
    headers = {"User-Agent": f"{APP_NAME}/{VERSION}", "Accept-Encoding": "identity"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    request = urllib.request.Request(spec.url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        status = response.status
        if status == 206:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
            if not match or int(match[1]) != offset or int(match[3]) != spec.size:
                # The server did not honor the requested segment. A future
                # attempt starts over rather than appending unrelated data.
                partial.unlink(missing_ok=True)
                raise ModelDownloadError("The model host returned an invalid download segment. Please retry setup.")
        elif status == 200:
            offset = 0  # Some hosts ignore Range; restarting is safe.
        else:
            raise ModelDownloadError("The model host did not return a usable download. Please retry setup.")
        _emit(progress, spec, "downloading", offset, f"Downloading {spec.label} model…", attempt)
        with partial.open("ab" if offset else "wb") as output:
            while True:
                _cancelled(cancelled)
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                offset += len(chunk)
                if offset > spec.size:
                    output.close()
                    partial.unlink(missing_ok=True)
                    raise ModelDownloadError("The downloaded model has an unexpected size. Please retry setup.")
                output.write(chunk)
                _emit(progress, spec, "downloading", offset, f"Downloading {spec.label} model…", attempt)
            output.flush()
            os.fsync(output.fileno())
    if offset != spec.size:
        raise ModelDownloadError("The model download was interrupted. Setup can resume it when you retry.")


def ensure_model(quality: str, progress: ProgressCallback | None = None,
                 cancelled: CancellationCheck | None = None, *, attempts: int = 3) -> Path:
    """Return verified weights, downloading/resuming them only if necessary.

    ``progress`` receives a ``ModelProgress`` on the calling thread. Pass a
    ``threading.Event.is_set`` method as ``cancelled`` for cancellable workers.
    A cancelled or interrupted download retains its partial file. Activation
    occurs only after SHA-256 verification and an atomic replacement.
    """
    spec = _spec(quality)
    if attempts < 1:
        raise ValueError("The download needs at least one attempt.")
    _cancelled(cancelled)
    _emit(progress, spec, "checking", message=f"Checking {spec.label} model…")
    for path in _candidates(spec):
        if _matches(path, spec, cancelled):
            _emit(progress, spec, "ready", spec.size, f"{spec.label} model is ready.")
            return path
    try:
        with _download_lock(spec, cancelled):
            destination = Path(MODEL_DIR) / spec.filename
            if _matches(destination, spec, cancelled):
                _emit(progress, spec, "ready", spec.size, f"{spec.label} model is ready.")
                return destination
            partial = destination.with_suffix(destination.suffix + ".part")
            last_error = "The model download could not be completed. Check your connection and retry setup."
            for attempt in range(1, attempts + 1):
                _cancelled(cancelled)
                try:
                    if not _matches(partial, spec, cancelled):
                        if partial.exists() and partial.stat().st_size == spec.size:
                            partial.unlink()  # A complete but corrupt file cannot be resumed.
                        _download(spec, partial, progress, cancelled, attempt)
                    _emit(progress, spec, "checking", spec.size, f"Verifying {spec.label} model…", attempt)
                    if not _matches(partial, spec, cancelled):
                        partial.unlink(missing_ok=True)
                        raise ModelDownloadError("The model did not pass its integrity check. Please retry setup.")
                    _cancelled(cancelled)
                    os.replace(partial, destination)
                    _emit(progress, spec, "ready", spec.size, f"{spec.label} model is ready.", attempt)
                    return destination
                except ModelDownloadCancelled:
                    raise
                except urllib.error.HTTPError as error:
                    last_error = "The model host is unavailable. Check your connection and retry setup."
                    if 400 <= error.code < 500 and error.code not in {408, 416, 429}:
                        break
                    if error.code == 416:
                        partial.unlink(missing_ok=True)
                except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException):
                    last_error = "The model download was interrupted. Check your connection and retry setup to resume it."
                except ModelDownloadError as error:
                    last_error = str(error)
                if attempt < attempts:
                    _emit(progress, spec, "retrying", message="Connection interrupted. Retrying…", attempt=attempt)
                    for _ in range(attempt * 5):
                        _cancelled(cancelled)
                        time.sleep(0.1)
            raise ModelDownloadError(last_error) from None
    except ModelDownloadError:
        raise
    except OSError:
        raise ModelDownloadError("Could not save the AI model. Check free disk space and app data folder permissions, then retry setup.") from None


def ensure_models(qualities: Iterable[str] = ("detail", "fast"),
                  progress: ProgressCallback | None = None,
                  cancelled: CancellationCheck | None = None) -> dict[str, Path]:
    """Install the selected model set, returning paths keyed by app quality."""
    return {spec.quality: ensure_model(spec.quality, progress, cancelled)
            for spec in dict.fromkeys(_spec(quality) for quality in qualities)}
