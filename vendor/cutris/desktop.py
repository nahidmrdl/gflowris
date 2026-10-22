"""Windows desktop entry point; image processing always stays on loopback."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request

from app_paths import APP_ID, APP_NAME, DATA_DIR, RESOURCE_DIR, VERSION, ensure_directories


class InstanceLock:
    """A process lock survives neither a crash nor a reinstall."""

    def __init__(self, path: Path):
        self.path = path
        self.file = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.file = self.path.open("a+b")
        if self.file.tell() == 0:
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self.file.close()
            self.file = None
            return False

    def release(self) -> None:
        if self.file is not None:
            self.file.close()
            self.file = None


class LocalServer:
    def __init__(self, port: int = 0, *, desktop_mode: bool = False):
        import server
        import uvicorn
        self.module = server
        from cutris.runtime import IntegrationRuntime
        self.integration = IntegrationRuntime(remover=server.REMOVER, lock=server.PROCESSING_LOCK)
        server.INTEGRATION_CONTROLLER = self.integration
        server.DESKTOP_MODE = desktop_mode
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        # Reserve the port before starting the thread to avoid a startup race.
        self.socket.bind(("127.0.0.1", port))
        self.url = "http://127.0.0.1:" + str(self.socket.getsockname()[1])
        config = uvicorn.Config(server.app, host="127.0.0.1", log_config=None,
                                access_log=False, log_level="critical", ws="none")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, kwargs={"sockets": [self.socket]},
                                       daemon=True, name="cutout-local-server")

    def start(self, timeout: float = 20) -> None:
        self.thread.start()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and self.thread.is_alive():
            try:
                with urllib.request.urlopen(self.url + "/api/config", timeout=.4) as response:
                    config = json.load(response)
                if config.get("appId") == APP_ID and config.get("token") == self.module.TOKEN:
                    if self.module.SETTINGS.get()["integration_enabled"]:
                        self.integration.start()
                    return
            except (OSError, ValueError):
                pass
            time.sleep(.05)
        self.stop()
        raise RuntimeError("The local image workspace could not start. Close other instances and try again.")

    def pause_processing(self) -> None:
        with self.module.LOCK:
            for job in self.module.JOBS.values():
                if job["status"] in {"running", "queued", "pausing"}:
                    job["status"] = "pausing" if job["status"] != "queued" else "paused"
                    self.module.persist(job)

    def stop(self) -> None:
        self.integration.stop()
        self.server.should_exit = True
        if self.thread.is_alive() and threading.current_thread() is not self.thread:
            self.thread.join(timeout=5)
        self.socket.close()


class DesktopApi:
    """Only purpose-specific native actions are exposed to the local editor."""

    def __init__(self):
        self._window = None
        self._model_lock = threading.Lock()
        self._workspace_return = None
        import server
        if server.INTEGRATION_CONTROLLER:
            server.INTEGRATION_CONTROLLER.open_editor = self._open_editor

    def _open_editor(self, project_id):
        import server
        result = server.request_editor(project_id)
        if self._window:
            self._window.restore()
            self._window.show()
        return result

    def choose_output_folder(self):
        if not self._window:
            return {"folder": None}
        import webview
        selected = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        return {"folder": selected[0] if selected else None}

    def integration_context(self):
        return {"workspace": "gflowris" if self._workspace_return else None}

    def return_to_workspace(self, project_id=None):
        if self._workspace_return:
            return self._workspace_return(project_id)
        return {"ok": False, "error": "This is the standalone Cutris app."}

    def open_output_folder(self):
        from cutris.settings import SettingsStore
        folder = SettingsStore().get()["output_folder"]
        if folder and sys.platform == "win32":
            Path(folder).mkdir(parents=True, exist_ok=True)
            os.startfile(folder)
            return True
        return False

    def document_state(self, dirty: bool, processing: bool) -> None:
        if self._window:
            self._window.confirm_close = bool(dirty or processing)

    def setup_models(self) -> dict:
        if not self._model_lock.acquire(blocking=False):
            return {"ok": False, "message": "AI model setup is already open."}
        try:
            import subprocess
            from app_paths import FROZEN
            from model_manager import model_status
            command = [sys.executable]
            if not FROZEN:
                command.append(str(Path(__file__).resolve()))
            command.append("--setup-models")
            result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL,
                                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
            return {"ok": result.returncode == 0, "models": model_status()}
        except Exception:
            return {"ok": False, "message": "AI model setup could not open. Close the app and run setup again."}
        finally:
            self._model_lock.release()

    def open_saved_work(self) -> bool:
        if sys.platform == "win32":
            os.startfile(str(DATA_DIR))
            return True
        return False


def show_message(message: str, *, error: bool = False) -> None:
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x10 if error else 0x40)
    elif sys.stderr is not None:
        print(message, file=sys.stderr)


def self_test(report_path: Path | None, check_inference: bool = False) -> int:
    """Exercise the shipped runtime with a generated fixture, never private images."""
    report = {"app": APP_ID, "version": VERSION, "ok": False, "checks": {}}
    service = None
    try:
        import io
        import zipfile
        from PIL import Image, ImageDraw
        import onnxruntime as ort
        from engine import Remover, apply_strokes, load_image
        from model_manager import model_status
        from image_geometry import apply_transform
        service = LocalServer()
        service.start()
        with urllib.request.urlopen(service.url + "/", timeout=10) as response:
            report["checks"]["workspace"] = b'id="canvas"' in response.read()
        with urllib.request.urlopen(service.url + "/batch.js", timeout=10) as response:
            report["checks"]["batch_tools_assets"] = b'function applyBatchTools' in response.read()
        report["checks"]["models"] = model_status()
        report["checks"]["onnx_runtime"] = "CPUExecutionProvider" in ort.get_available_providers()
        with Image.open(RESOURCE_DIR / "packaging" / "assets" / "app.ico") as icon:
            report["checks"]["app_icon"] = {(16, 16), (24, 24), (32, 32), (48, 48), (256, 256)} <= icon.ico.sizes()
        with urllib.request.urlopen(service.url + "/assets/app.png", timeout=10) as response:
            with Image.open(io.BytesIO(response.read())) as icon:
                report["checks"]["interface_icon"] = icon.size == (256, 256) and icon.mode == "RGBA"
        fixture = Image.new("RGB", (256, 256), "white")
        draw = ImageDraw.Draw(fixture)
        draw.ellipse((60, 24, 196, 160), fill="#5355b8")
        draw.rounded_rectangle((76, 118, 180, 235), radius=22, fill="#279c88")
        draw.ellipse((92, 66, 108, 84), fill="white")
        draw.ellipse((148, 66, 164, 84), fill="white")
        encoded = io.BytesIO()
        fixture.save(encoded, "PNG")
        decoded = load_image(encoded.getvalue())
        report["checks"]["image_decode"] = decoded.size == fixture.size
        cutout = decoded
        if check_inference:
            # At least one verified model is required for a meaningful inference check.
            installed = model_status()
            quality = "fast" if installed.get("fast") else "detail"
            cutout, _ = Remover().process(decoded, quality, "ai")
            alpha = cutout.getchannel("A")
            report["checks"]["inference"] = alpha.getextrema()[0] < 64 and alpha.getextrema()[1] > 192
        edited = apply_strokes(decoded, cutout, [{"mode": "erase", "size": 20, "points": [[128, 128]]}])
        report["checks"]["editor"] = edited.getpixel((128, 128))[3] == 0
        transformed = apply_transform(edited, {"crop": {"x": 48, "y": 16, "width": 160, "height": 224},
                                               "resize": {"width": 80, "height": 112}})
        report["checks"]["crop_resize"] = transformed.size == (80, 112) and transformed.mode == "RGBA"
        png = io.BytesIO()
        edited.save(png, "PNG")
        bundle = io.BytesIO()
        with zipfile.ZipFile(bundle, "w") as archive:
            archive.writestr("cutout.png", png.getvalue())
        report["checks"]["png_zip_export"] = len(bundle.getvalue()) > len(png.getvalue())
        checks = [value for value in report["checks"].values() if isinstance(value, bool)]
        report["ok"] = all(checks)
    except Exception as error:
        report["error"] = type(error).__name__
    finally:
        if service:
            service.stop()
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    elif sys.stdout is not None:
        print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


def main(argv: list[str] | None = None) -> int:
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("CutoutStudio.Desktop")
    parser = argparse.ArgumentParser(description="Local background removal and cutout editing.")
    parser.add_argument("--version", action="version", version=VERSION)
    parser.add_argument("--setup-models", action="store_true", help="Open model setup for installation or repair.")
    parser.add_argument("--browser", action="store_true", help="Use the system browser instead of a desktop window.")
    parser.add_argument("--port", type=int, default=0, help="Local port; 0 selects a free port.")
    parser.add_argument("--project", help="Open a saved API project for manual editing.")
    parser.add_argument("--self-test", action="store_true", help="Verify the packaged runtime without opening a window.")
    parser.add_argument("--check-inference", action="store_true", help="Include real inference in --self-test.")
    parser.add_argument("--report", type=Path, help="Write the self-test result as JSON.")
    args = parser.parse_args(argv)
    if args.project:
        import re
        if not re.fullmatch(r"[a-f0-9]{32}", args.project) or not (DATA_DIR / "jobs" / args.project / "manifest.json").is_file():
            parser.error("The requested editable project was not found.")
    ensure_directories()
    if args.self_test:
        return self_test(args.report, args.check_inference)
    if args.setup_models:
        from model_setup_ui import run_model_setup
        return 0 if run_model_setup(required=True) else 1
    instance = InstanceLock(DATA_DIR / "desktop.lock")
    if not instance.acquire():
        show_message(f"{APP_NAME} is already running. Return to its open window to continue.")
        return 0
    service = None
    try:
        from model_manager import model_status
        if not args.project and not any(model_status().values()):
            from model_setup_ui import run_model_setup
            if not run_model_setup(required=True):
                return 1
        service = LocalServer(args.port, desktop_mode=not args.browser)
        service.start()
        editor_url = service.url + ("?job=" + args.project if args.project else "")
        if args.browser:
            import webbrowser
            webbrowser.open(editor_url)
            if sys.stdout is not None:
                print(f"{APP_NAME} is running locally. Keep this process open; Ctrl+C exits.")
            while service.thread.is_alive():
                time.sleep(.25)
            return 0
        import webview
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.settings["ALLOW_FILE_URLS"] = False
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        api = DesktopApi()
        screens = webview.screens
        screen = next((screen for screen in screens if screen.x == 0 and screen.y == 0),
                      screens[0] if screens else None)
        # Leave room for the taskbar and window frame on scaled laptop displays.
        width = min(1360, max(640, screen.width - 48)) if screen else 1360
        height = min(820, max(480, screen.height - 64)) if screen else 820
        window = webview.create_window(APP_NAME, editor_url, js_api=api,
                                       width=width, height=height, min_size=(min(900, width), min(620, height)),
                                       background_color="#f6f5ef", text_select=True,
                                       localization={"global.quitConfirmation": f"Close {APP_NAME}? Unsaved touch-ups will be discarded. Processing stops after the current image. Saved work stays on this computer."})
        api._window = window
        icon = RESOURCE_DIR / "packaging" / "assets" / "app.ico"
        webview.start(gui="edgechromium" if sys.platform == "win32" else None,
                      private_mode=True, storage_path=str(DATA_DIR / "webview"),
                      icon=str(icon) if icon.is_file() else None)
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception:
        show_message(f"{APP_NAME} could not start. Install or repair Microsoft Edge WebView2 Runtime, then try again. Your saved images are unchanged.", error=True)
        return 1
    finally:
        if service:
            service.pause_processing()
            service.stop()
            # Finish the current atomic image write before releasing the instance lock.
            service.module.POOL.shutdown(wait=True, cancel_futures=True)
        instance.release()


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    raise SystemExit(main())
