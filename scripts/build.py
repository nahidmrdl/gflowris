"""Build a Windows installer, portable app, extension, and source archive."""
from __future__ import annotations
import argparse
import base64
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from release_utils import ROOT, audit, digest, source_files, version, zip_sources


def run(args, **kwargs):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True, **kwargs)


def copy_clean(source, target):
    shutil.copytree(source, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns(
        '__pycache__', '*.pyc', '*.pyo', 'site-packages', 'test', 'tests', 'idlelib', 'turtledemo', 'ensurepip', 'venv', '*.egg-info'))


def compile_launchers(bundle, value):
    compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    info = ROOT / 'build' / 'VersionInfo.cs'
    info.write_text('using System.Reflection;\n[assembly: AssemblyVersion("' + value + '.0")]\n'
                    '[assembly: AssemblyFileVersion("' + value + '.0")]\n', encoding='utf-8')
    run([compiler, '/nologo', '/target:winexe', '/optimize+', '/reference:System.Windows.Forms.dll',
         '/win32icon:' + str(ROOT / 'assets/app.ico'), '/out:' + str(bundle / 'gflowris.exe'), ROOT / 'native/AppLauncher.cs', info])
    run([compiler, '/nologo', '/target:exe', '/optimize+', '/reference:System.Web.Extensions.dll',
         '/out:' + str(bundle / 'native/gflowris-host.exe'), ROOT / 'native/Launcher.cs'])


def collect_licenses(site, destination):
    destination.mkdir(parents=True, exist_ok=True)
    packages = []
    for dist in sorted(metadata.distributions(path=[str(site)]), key=lambda d: d.metadata['Name'].lower()):
        notices = []
        for file in dist.files or ():
            name = Path(str(file))
            if '..' in name.parts or name.suffix.lower() in {'.py', '.pyc', '.pyd', '.dll'}:
                continue
            if not any(word in name.name.lower() for word in ('license', 'licence', 'notice', 'copying', 'copyright')):
                continue
            source = Path(dist.locate_file(file))
            if source.is_file():
                target = destination / dist.metadata['Name'] / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                notices.append(target.relative_to(destination).as_posix())
        if not notices:
            fallback = ROOT / 'packaging/licenses' / (dist.metadata['Name'] + '-LICENSE.txt')
            if not fallback.is_file():
                raise RuntimeError('Resolve the missing license text for ' + dist.metadata['Name'] + ' before release.')
            target = destination / fallback.name
            shutil.copyfile(fallback, target)
            notices.append(target.name)
        packages.append({'name': dist.metadata['Name'], 'version': dist.version, 'notices': notices})
    for source in (ROOT / 'packaging/licenses').glob('*.txt'):
        shutil.copyfile(source, destination / source.name)
    (destination / 'runtime-packages.json').write_text(json.dumps(packages, indent=2) + '\n', encoding='utf-8')


def build_bundle(value, verify_runtime=False):
    if sys.platform != 'win32' or sys.maxsize <= 2**32 or sys.version_info[:2] != (3, 12):
        raise RuntimeError('Build with 64-bit Python 3.12 on Windows.')
    bundle = ROOT / 'dist/gflowris'
    if bundle.exists():
        raise RuntimeError('dist/gflowris already exists. Use a clean checkout for a release build.')
    bundle.mkdir(parents=True)
    for name in ('public', 'src', 'extension', 'assets', 'native'):
        shutil.copytree(ROOT / name, bundle / name)
    for name in ('LICENSE', 'THIRD_PARTY_NOTICES.md', 'desktop.py', 'package.json'):
        shutil.copyfile(ROOT / name, bundle / name)
    for name in ('launch.py', 'package_check.py', 'ensure-companion.mjs'):
        target = bundle / 'scripts' / name
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(ROOT / 'scripts' / name, target)
    (bundle / 'packaging').mkdir()
    identity = json.loads((ROOT / 'packaging/extension-identity.json').read_text())
    hashed = hashlib.sha256(base64.b64decode(identity['key'])).hexdigest()[:32]
    if ''.join(chr(97 + int(n, 16)) for n in hashed) != identity['id']:
        raise RuntimeError('The stable extension key and ID do not match.')
    shutil.copyfile(ROOT / 'packaging/extension-identity.json', bundle / 'packaging/extension-identity.json')
    manifest_file = bundle / 'extension/manifest.json'
    manifest = json.loads(manifest_file.read_text())
    manifest['key'] = identity['key']
    manifest_file.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    (bundle / 'Start.cmd').write_text('@echo off\r\nstart "" "%~dp0gflowris.exe"\r\n', encoding='ascii')
    (bundle / 'SETUP.txt').write_text(
        'Open gflowris.exe. In Extension setup, open the bundled extension folder.\n'
        'In chrome://extensions enable Developer mode and Load unpacked that folder.\n'
        'Sign into Google Flow in normal Chrome, open a project, and choose Connect this project.\n'
        'AI models are installed separately from Cutris editor > AI models.\n'
        'Guide: https://github.com/nahidmrdl/gflowris/blob/main/docs/setup.md\n', encoding='utf-8')

    # A complete relocated interpreter includes Tcl/Tk for the model manager.
    # A virtual environment or embeddable Python alone would omit required files.
    python = bundle / 'runtime/python'
    python.mkdir(parents=True)
    base = Path(sys.base_prefix)
    for folder in ('DLLs', 'Lib', 'tcl'):
        if not (base / folder).is_dir():
            raise RuntimeError('The build Python must include its standard library and Tcl/Tk.')
        copy_clean(base / folder, python / folder)
    for file in base.iterdir():
        if file.is_file() and (file.suffix.lower() == '.dll' or file.name in {'python.exe', 'pythonw.exe', 'LICENSE.txt'}):
            shutil.copyfile(file, python / file.name)
    site = python / 'Lib/site-packages'
    wheel_dir = ROOT / 'build/wheels'
    wheel_dir.mkdir(parents=True, exist_ok=True)
    run([sys.executable, '-m', 'pip', 'wheel', ROOT / 'vendor/cutris', '--no-deps', '--no-build-isolation', '--wheel-dir', wheel_dir])
    wheels = list(wheel_dir.glob('cutris-*.whl'))
    if len(wheels) != 1:
        raise RuntimeError('Expected exactly one Cutris wheel.')
    run([sys.executable, '-m', 'pip', 'install', '--no-compile', '--only-binary=:all:', '--no-binary=proxy_tools', '--target', site,
         '--constraint', ROOT / 'packaging/runtime-requirements.txt', str(wheels[0]) + '[desktop]'])
    for file in site.glob('*.dist-info/direct_url.json'):
        file.unlink()  # pip's local wheel URI contains the builder's private path.
    for name in ('bin', 'Scripts'):
        if (site / name).is_dir():
            shutil.rmtree(site / name)  # Generated entry points embed the build interpreter's path.
    collect_licenses(site, bundle / 'licenses')
    shutil.copyfile(ROOT / 'vendor/cutris/THIRD_PARTY_NOTICES.md', bundle / 'licenses/Cutris-THIRD_PARTY_NOTICES.md')
    # Still-image processing does not use the separately licensed video DLL.
    for file in site.rglob('opencv_videoio_ffmpeg*.dll'):
        file.unlink()
    for file in site.rglob('*.onnx'):
        file.unlink()  # ONNX Runtime's tiny example datasets are unused too.
    node = json.loads((ROOT / 'packaging/runtime-lock.json').read_text())['node']
    cache = ROOT / 'build/downloads'
    cache.mkdir(exist_ok=True)
    archive = cache / Path(node['url']).name
    if not archive.is_file():
        with urllib.request.urlopen(node['url'], timeout=120) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
    if digest(archive) != node['sha256']:
        raise RuntimeError('Official Node runtime checksum did not match.')
    node_folder = bundle / 'runtime/node'
    node_folder.mkdir()
    prefix = f"node-v{node['version']}-win-x64/"
    with zipfile.ZipFile(archive) as package:
        for name in ('node.exe', 'LICENSE'):
            (node_folder / name).write_bytes(package.read(prefix + name))
    compile_launchers(bundle, value)
    audit([bundle], dependencies=True)
    if verify_runtime:
        run([python / 'python.exe', '-I', '-B', bundle / 'scripts/package_check.py'],
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, timeout=120)
    # The self-test must leave no environment-specific files inside the payload.
    if (bundle / '.local').exists() or list(bundle.rglob('*.onnx')) or list(bundle.rglob('__pycache__')):
        raise RuntimeError('The payload contains private state, compiled Python paths, or AI models.')
    return bundle


def archive_folder(folder, output, prefix=''):
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(folder.rglob('*')):
            if file.is_file():
                archive.write(file, prefix + file.relative_to(folder).as_posix())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--installer', action='store_true')
    parser.add_argument('--source-only', action='store_true')
    parser.add_argument('--verify-runtime', action='store_true', help='Opt in to the local runtime smoke check.')
    parser.add_argument('--iscc')
    args = parser.parse_args()
    value = version(json.loads((ROOT / 'package.json').read_text())['version'])
    release = ROOT / 'release'
    release.mkdir(exist_ok=True)
    if any(release.iterdir()):
        raise RuntimeError('The release directory must be empty to avoid uploading older artifacts.')
    assets = []
    if not args.source_only:
        bundle = build_bundle(value, args.verify_runtime)
        portable = release / f'gflowris-{value}-windows-x64-portable.zip'
        archive_folder(bundle, portable, 'gflowris/')
        assets.append(portable)
        extension = release / f'gflowris-{value}-chrome-extension.zip'
        archive_folder(bundle / 'extension', extension)
        assets.append(extension)
        if args.installer:
            compiler = args.iscc or shutil.which('ISCC') or str(Path(os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)')) / 'Inno Setup 6/ISCC.exe')
            run([compiler, '/DAppVersion=' + value, ROOT / 'packaging/windows-installer.iss'])
            setup = release / f'gflowris-{value}-windows-x64-setup.exe'
            if not setup.is_file():
                raise RuntimeError('Windows Setup was not produced.')
            assets.append(setup)
    source = release / f'gflowris-{value}-source.zip'
    zip_sources(source)
    assets.append(source)
    sums = release / 'SHA256SUMS.txt'
    sums.write_text(''.join(digest(file) + '  ' + file.name + '\n' for file in sorted(assets)), encoding='ascii')
    assets.append(sums)
    control = ROOT / 'build/release-control'
    if (control / 'request.json').is_file():
        request = json.loads((control / 'request.json').read_text())
        request.update(assets={file.name: {'sha256': digest(file), 'bytes': file.stat().st_size} for file in assets},
                       version_files={name: (ROOT / name).read_text(encoding='utf-8') for name in ('package.json', 'package-lock.json', 'extension/manifest.json')})
        (control / 'release.json').write_text(json.dumps(request, indent=2) + '\n', encoding='utf-8')
    print('Built ' + ', '.join(file.name for file in assets))


if __name__ == '__main__':
    main()
