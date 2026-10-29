"""Native desktop shell for the local Flow queue and Cutris cutout editor."""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
PRIVATE = ROOT / ".local" / "runtime.json"
STATE = Path(json.loads(PRIVATE.read_text(encoding="utf-8-sig"))["stateRoot"]) if PRIVATE.is_file() else Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share")) / "AutomationFlowGen"

# Keep the handle for the process lifetime so setup asks the user to save and
# close the editor rather than terminating a window with unsaved work.
_desktop_mutex = None
if os.name == 'nt':
    import ctypes
    from ctypes import wintypes
    _create_mutex = ctypes.WinDLL('kernel32', use_last_error=True).CreateMutexW
    _create_mutex.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
    _create_mutex.restype = wintypes.HANDLE
    _desktop_mutex = _create_mutex(None, False, r'Local\gflowris.Desktop')
    if not _desktop_mutex:
        raise ctypes.WinError(ctypes.get_last_error())


class DesktopBridge:
    """One desktop window for the queue and the complete Cutris workspace."""
    def __init__(self, runtime):
        self._runtime = runtime
        self._service = None
        self._api = None
        self._window = None
        self._lock = threading.RLock()
        self._dirty = False
        self._project_id = None
        self._view = 'queue'

    def focus(self):
        if self._window:
            self._window.restore()
            self._window.show()
        return True

    def _ensure_service(self):
        if not self._service:
            from desktop import LocalServer, DesktopApi
            self._service = LocalServer(desktop_mode=True)
            self._service.integration.managed_by = 'gflowris'
            self._service.start()
            self._api = DesktopApi()
            self._api._window = self._window
            self._api._workspace_return = self.return_to_workspace
            self._service.integration.open_editor = self._open_from_api
            self._service.integration.start()
            descriptor = self._service.integration.folder / 'service.json'
            (STATE / 'cutris-service.json').write_bytes(descriptor.read_bytes())
        return self._service

    def _control(self):
        control = json.loads((STATE / 'control.json').read_text(encoding='utf-8'))
        if control['origin'] != 'http://127.0.0.1:4317' or not re.fullmatch(r'[a-f0-9]{64}',control['token']):
            raise ValueError('The local workspace is unavailable.')
        return control

    def _show_cutris(self, project_id=None, settings=False):
        with self._lock:
            if self._dirty:
                return {'ok':False,'error':'Save your current Cutris edits before opening another image.'}
            service = self._ensure_service()
            if project_id:
                from app_paths import DATA_DIR
                manifest = DATA_DIR / 'jobs' / project_id / 'manifest.json'
                job = json.loads(manifest.read_text(encoding='utf-8'))
                if job.get('id') != project_id or job.get('status') != 'complete':
                    raise ValueError('The saved cutout is unavailable.')
                with service.module.LOCK:
                    service.module.JOBS[project_id] = job
            self._project_id = project_id
            self._view = 'cutris'
            query = '?embedded=1' + ('&job='+project_id if project_id else '') + ('&settings=1' if settings else '')
            self.focus()
            return {'ok':True,'embedded':True,'url':service.url+query}

    def _open_from_api(self, project_id):
        result = self.open_editor(project_id)
        if result.get('ok'):
            self._window.load_url(result['url'])
        return {'ok':result.get('ok',False),'error':result.get('error')}

    def open_cutris(self):
        return self._show_cutris(settings=True)

    def open_editor_home(self):
        return self._show_cutris()

    def open_editor(self, project_id):
        if not isinstance(project_id,str) or not re.fullmatch(r'[a-f0-9]{32}',project_id):
            return {'ok':False,'error':'Choose a saved Cutris cutout.'}
        try:
            return self._show_cutris(project_id)
        except (OSError,ValueError,KeyError):
            return {'ok':False,'error':'The saved Cutris project could not open.'}

    def integration_context(self):
        import base64
        icon = ROOT / 'public' / 'assets' / 'app-256.png'
        return {'workspace':'gflowris','embedded':True,'icon':('data:image/png;base64,'+base64.b64encode(icon.read_bytes()).decode()) if icon.is_file() else None}

    def document_state(self, dirty, processing):
        self._dirty = bool(dirty)
        if self._api:
            self._api.document_state(dirty,processing)

    def choose_output_folder(self, initial_folder=None):
        self._ensure_service()
        return self._api.choose_output_folder(initial_folder)

    def open_output_folder(self, folder=None):
        self._ensure_service()
        return self._api.open_output_folder(folder)

    def _workspace_output_folder(self):
        control = self._control()
        request = urllib.request.Request(control['origin']+'/api/state', headers={'Authorization':'Bearer '+control['token']})
        with urllib.request.urlopen(request, timeout=5) as response:
            state = json.load(response)
        folder = state['settings']['outputFolder']
        if not isinstance(folder, str) or not Path(folder).is_absolute():
            raise ValueError('Choose an output folder in workspace settings.')
        return folder

    def choose_workspace_output_folder(self):
        try:
            self._ensure_service()
            return self._api.choose_output_folder(self._workspace_output_folder())
        except Exception:
            return {'ok':False,'error':'The workspace folder picker could not open. Reopen gflowris and try again.'}

    def open_workspace_output_folder(self):
        try:
            self._ensure_service()
            return self._api.open_output_folder(self._workspace_output_folder())
        except Exception:
            return {'ok':False,'error':'The workspace folder could not open. Check your output folder or reopen gflowris.'}

    def open_saved_work(self):
        self._ensure_service()
        return self._api.open_saved_work()

    def setup_models(self):
        self._ensure_service()
        return self._api.setup_models()

    def return_to_workspace(self, project_id=None):
        if self._dirty:
            return {'ok':False,'error':'Save your current edits first.'}
        if project_id is not None and (not isinstance(project_id,str) or not re.fullmatch(r'[a-f0-9]{32}',project_id)):
            return {'ok':False,'error':'Choose a saved project.'}
        control = self._control()
        try:
            request = urllib.request.Request(control['origin']+'/api/cutris/sync',data=json.dumps({'projectId':project_id or self._project_id}).encode(),headers={'Authorization':'Bearer '+control['token'],'Content-Type':'application/json'})
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(request,timeout=20) as response:
                        result = json.load(response)
                    break
                except urllib.error.HTTPError:
                    if attempt == 2:
                        raise
                    time.sleep(.25)
            if not result.get('ok'):
                raise ValueError('The image has not synced yet.')
        except Exception:
            return {'ok':False,'error':'Your edits are saved. Wait for the current operation, then try returning again.'}
        self._view = 'queue'
        self._project_id = None
        self._window.confirm_close = False
        self.focus()
        return {'ok':True,'url':control['origin']+'/?desktop=1#key='+control['token']}

    def close(self):
        if self._service:
            self._service.pause_processing()
            self._service.stop()
            self._service.module.POOL.shutdown(wait=True,cancel_futures=True)


def main():
    runtime = json.loads((STATE / "runtime.json").read_text(encoding="utf-8-sig"))
    if runtime.get("cutrisRoot"):
        sys.path.insert(0, runtime["cutrisRoot"])
    elif str(ROOT) in sys.path:
        sys.path.remove(str(ROOT))
    import webview
    if os.name == 'nt':
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('gflowris.Desktop')
    result = subprocess.run([runtime["nodeExe"], str(ROOT / "scripts" / "ensure-companion.mjs")],
                            cwd=ROOT, capture_output=True, text=True, check=True,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    control = json.loads(result.stdout)
    if control["origin"] != "http://127.0.0.1:4317" or not re.fullmatch(r"[a-f0-9]{64}", control["token"]):
        raise ValueError("Invalid local companion descriptor.")
    from desktop import InstanceLock
    instance = InstanceLock(STATE / "desktop.lock")
    (STATE / "desktop-focus.json").write_text(json.dumps({"request": time.time_ns()}), encoding="utf-8")
    if not instance.acquire():
        return
    bridge = DesktopBridge(runtime)
    webview.settings["ALLOW_DOWNLOADS"] = True
    webview.settings["ALLOW_FILE_URLS"] = False
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    screens = webview.screens
    screen = screens[0] if screens else None
    width, height = (min(1440, screen.width-48), min(900, screen.height-64)) if screen else (1380, 850)
    window = webview.create_window("gflowris", control["origin"] + "/?desktop=1#key=" + control["token"],
                          js_api=bridge, width=width, height=height, min_size=(min(width, 960), min(height, 640)),
                          background_color="#f3f5f2", text_select=True)
    bridge._window = window
    bridge._ensure_service()
    stopped = threading.Event()
    def monitor():
        previous = None
        heartbeat = 0
        while not stopped.wait(.5):
            try:
                request = (STATE / "desktop-focus.json").read_text()
                if previous is not None and request != previous:
                    bridge.focus()
                previous = request
                if time.monotonic() - heartbeat > 3:
                    req = urllib.request.Request(control["origin"] + "/api/desktop/heartbeat", data=b'{}', headers={"Authorization":"Bearer " + control["token"], "Content-Type":"application/json"})
                    with urllib.request.urlopen(req, timeout=2):
                        pass
                    heartbeat = time.monotonic()
            except Exception:
                pass
    monitor_thread = threading.Thread(target=monitor, daemon=True)
    monitor_thread.start()
    try:
        webview.start(gui="edgechromium" if os.name == "nt" else None,
                      private_mode=True, storage_path=str(STATE / "webview"), icon=str(ROOT / 'assets' / 'app.ico'))
    finally:
        stopped.set()
        monitor_thread.join(timeout=2.5)
        try:
            req = urllib.request.Request(control["origin"] + "/api/desktop/heartbeat", data=b'{"closed":true}', headers={"Authorization":"Bearer " + control["token"],"Content-Type":"application/json"})
            urllib.request.urlopen(req, timeout=2).close()
        except Exception:
            pass
        try:
            bridge.close()
        finally:
            instance.release()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        STATE.mkdir(parents=True, exist_ok=True)
        (STATE / "desktop-error.log").write_text(str(error), encoding="utf-8")
        if os.name == "nt":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, f"gflowris could not start. Try opening the app again. If the problem continues, reinstall the latest release.\n\nError details: {STATE / 'desktop-error.log'}", "gflowris", 0x10)
        raise SystemExit(1)
