"""Verify the relocated release without login, AI downloads, or a desktop window."""
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path[:] = [p for p in sys.path if Path(p or '.').resolve() not in {ROOT, ROOT / 'scripts'}]

with tempfile.TemporaryDirectory(prefix='gflowris-package-check-') as folder:
    os.environ['CUTOUT_HOME'] = folder
    import tkinter
    assert tkinter.Tcl().eval('info patchlevel')
    import webview
    import numpy
    import scipy
    import onnxruntime
    import cv2
    from PIL import Image
    from desktop import LocalServer, DesktopApi
    from cutris.processing import finish_output
    import app_paths
    assert app_paths.RESOURCE_DIR.joinpath('web', 'index.html').is_file()
    service = LocalServer(desktop_mode=True)
    try:
        service.start()
        with urllib.request.urlopen(service.url, timeout=10) as response:
            assert b'<html' in response.read().lower()
    finally:
        service.stop()
        service.module.POOL.shutdown(wait=True, cancel_futures=True)
    image = Image.new('RGBA', (32, 32))
    image.paste((128, 96, 220, 255), (8, 8, 24, 24))
    result, _ = finish_output(image)
    assert result.size == (16, 16)
    for file in ('public/index.html', 'public/app.js', 'extension/manifest.json', 'assets/app.ico'):
        assert (ROOT / file).is_file(), file
    identity = json.loads((ROOT / 'packaging/extension-identity.json').read_text())
    manifest = json.loads((ROOT / 'extension/manifest.json').read_text())
    assert manifest['key'] == identity['key']
    assert not list(ROOT.rglob('*.onnx'))
    print('Packaged runtime, image codecs, inference imports, Tcl, Cutris resources, and extension verified.')
