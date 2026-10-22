"""Optional local API hosted by the desktop; shares its inference session."""
from __future__ import annotations
import json
import os
from pathlib import Path
import secrets
import socket
import threading
import time
import urllib.request

from app_paths import DATA_DIR
from .processing import Processor
from .service import create_app, user_state


class IntegrationRuntime:
    def __init__(self, *, remover=None, lock=None, open_editor=None, state_dir=None):
        self.folder = Path(state_dir) if state_dir else DATA_DIR / "integration"
        self.processor = Processor(remover=remover, lock=lock)
        self.open_editor = open_editor
        self.managed_by = None
        self.thread = None
        self.server = None
        self.socket = None
        self.token = None
        self.origin = None
        self.instance = secrets.token_hex(16)
        self.lock = threading.RLock()

    def status(self):
        return {"enabled": bool(self.thread and self.thread.is_alive()), "origin": self.origin,
                "editor_available": self.open_editor is not None, "api_version": 1, "managed_by": self.managed_by}

    def request_editor(self, project_id):
        if not self.open_editor:
            raise ValueError("The desktop editor is unavailable.")
        return self.open_editor(project_id)

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return self.status()
            import uvicorn
            self.folder.mkdir(parents=True, exist_ok=True)
            key_file = self.folder / "api-key"
            try:
                with key_file.open("x", encoding="utf-8") as stream:
                    stream.write(secrets.token_urlsafe(48))
                key_file.chmod(0o600)
            except FileExistsError:
                pass
            self.token = key_file.read_text().strip()
            app = create_app(self.token, processor=self.processor, editor_callback=self.request_editor,
                             editor_available=lambda: self.open_editor is not None)
            self.socket = socket.socket()
            self.socket.bind(("127.0.0.1", 0))
            self.origin = "http://127.0.0.1:" + str(self.socket.getsockname()[1])
            self.server = uvicorn.Server(uvicorn.Config(app, access_log=False, log_level="critical", log_config=None))
            self.thread = threading.Thread(target=self.server.run, kwargs={"sockets": [self.socket]}, daemon=True)
            self.thread.start()
            for _ in range(100):
                try:
                    request = urllib.request.Request(self.origin + "/v1/health", headers={"Authorization": "Bearer " + self.token})
                    with urllib.request.urlopen(request, timeout=.2) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(.05)
            else:
                self.stop()
                raise RuntimeError("Local integrations could not start. Try again.")
            descriptor = {"name": "cutris", "api_version": 1, "instance": self.instance,
                          "origin": self.origin, "key_file": str(key_file.resolve()), "pid": os.getpid(),
                          "source": "desktop", "owner": self.managed_by or "cutris", "data_dir": str(DATA_DIR.resolve())}
            for path in (self.folder / "service.json", user_state() / "service.json"):
                try:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    temporary = path.with_suffix(".tmp")
                    temporary.write_text(json.dumps(descriptor), encoding="utf-8")
                    temporary.chmod(0o600)
                    os.replace(temporary, path)
                except OSError:
                    if path.parent == self.folder:
                        self.stop()
                        raise
            return self.status()

    def stop(self):
        with self.lock:
            if self.server:
                self.server.should_exit = True
            if self.thread and self.thread.is_alive():
                self.thread.join(timeout=5)
            if self.socket:
                self.socket.close()
            self.thread = None
            self.origin = None
            for path in (self.folder / "service.json", user_state() / "service.json"):
                try:
                    if json.loads(path.read_text())["instance"] == self.instance:
                        path.unlink()
                except (OSError, ValueError, KeyError):
                    pass
