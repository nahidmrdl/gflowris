"""Configure a relocatable Windows release, then open the desktop workspace."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import runpy
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def configure(root=ROOT, *, register=True):
    private = root / '.local'
    state = private / 'state'
    identity = json.loads((root / 'packaging' / 'extension-identity.json').read_text(encoding='utf-8'))
    runtime = {'nodeExe': str(root / 'runtime' / 'node' / 'node.exe'),
               'pythonExe': str(root / 'runtime' / 'python' / 'python.exe'),
               'projectRoot': str(root), 'cutrisRoot': None, 'stateRoot': str(state)}
    for name in ('nodeExe', 'pythonExe'):
        if not Path(runtime[name]).is_file():
            raise RuntimeError('Extract the complete portable folder or reinstall gflowris.')
    for target in (private / 'runtime.json', state / 'runtime.json', private / 'native-host' / 'runtime.json'):
        write_json(target, runtime)
    origin = 'chrome-extension://' + identity['id'] + '/'
    write_json(state / 'native-registration.json', {'origin': origin})
    launcher = private / 'native-host' / 'gflowris-host.exe'
    # Preserve an identical in-use host when Chrome is connected during a relaunch.
    source = root / 'native' / 'gflowris-host.exe'
    if not launcher.is_file() or launcher.read_bytes() != source.read_bytes():
        shutil.copyfile(source, launcher)
    manifest = launcher.parent / 'com.automationflowgen.bridge.json'
    write_json(manifest, {'name': 'com.automationflowgen.bridge', 'description': 'gflowris desktop connection',
                         'path': str(launcher), 'type': 'stdio', 'allowed_origins': [origin]})
    if register:
        import winreg
        key = r'Software\Google\Chrome\NativeMessagingHosts\com.automationflowgen.bridge'
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, access=winreg.KEY_SET_VALUE) as handle:
            winreg.SetValueEx(handle, '', 0, winreg.REG_SZ, str(manifest))
    return runtime


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--register-only', action='store_true')
    parser.add_argument('--setup-models', action='store_true')
    args = parser.parse_args()
    configure()
    if args.setup_models:
        from model_setup_ui import run_model_setup
        run_model_setup(required=True)
    elif not args.register_only:
        runpy.run_path(str(ROOT / 'desktop.py'), run_name='__main__')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        private = ROOT / '.local'
        private.mkdir(parents=True, exist_ok=True)
        (private / 'launch-error.log').write_text(str(error), encoding='utf-8')
        if os.name == 'nt':
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, 'gflowris could not start. Reinstall the complete app and check .local/launch-error.log.', 'gflowris', 0x10)
        raise SystemExit(1)
