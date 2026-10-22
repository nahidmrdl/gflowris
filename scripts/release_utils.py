"""Shared release validation, source selection, and privacy checks."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOP_FILES = {'.gitattributes', '.gitignore', 'LICENSE', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
             'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'desktop.py',
             'requirements-desktop.txt', 'requirements-build.txt', 'Start.cmd', 'Setup-native.cmd'}
TOP_DIRS = {'.github', 'assets', 'docs', 'examples', 'extension', 'native', 'packaging', 'public', 'scripts', 'src', 'test', 'vendor'}
EXCLUDED = {'.git', '.local', '.venv', 'node_modules', '__pycache__', '.pytest_cache', 'build', 'dist', 'release', 'data', 'models'}


def version(text):
    if not re.fullmatch(r'(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})', text or '') or any(int(n) > 65535 for n in text.split('.')):
        raise ValueError('Use a version such as 1.0.0, without v; each number must be 0–65535.')
    return text


def release_body(notes):
    if not notes or len(notes) > 20000:
        raise ValueError('Enter release notes, up to 20,000 characters.')
    bullets = [' '.join(part.split()) for part in notes.split(';') if part.strip()]
    if not bullets:
        raise ValueError('Enter at least one release note.')
    return "## What's new\n\n" + '\n'.join('- ' + part for part in bullets) + '\n\n' + (
        '## Downloads\n\n'
        '- **Windows Setup** installs the app, desktop runtime, full Cutris editor, and bundled extension.\n'
        '- **Portable ZIP** runs from an extracted writable folder.\n'
        '- **Chrome extension ZIP** contains the same bridge, for manual installation.\n'
        '- **Source ZIP** contains the project source.\n\n'
        '## Setup\n\n'
        'Requires Windows 10/11 x64 and Google Chrome.\n\n'
        '1. Install **Windows Setup**, or extract the entire **Portable ZIP** to a writable folder '
        'and open `gflowris.exe`.\n'
        '2. In gflowris, choose **Extension setup → Open extension folder**. In Chrome, open '
        '`chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, '
        'and select that folder. Keep the folder in place.\n'
        '3. Sign into Google Flow in Chrome and open a project. Open **gflowris bridge** '
        'and choose **Connect this project**. Keep the project tab open while the queue runs. '
        'Allow multiple downloads if Chrome asks.\n'
        '4. For background removal, open **Cutris editor → AI models** and download the model '
        'you want to use. Existing verified models are reused.\n\n'
        '## How to use\n\n'
        '1. Write a prompt and choose **Add to queue**, or import text or JSON. Queue up to '
        '**25 prompts**. In **Bulk text**, use **Insert separator** between prompts.\n'
        '2. Choose the model, aspect ratio, image count, download size, and optional background '
        'removal. Use shared settings or customize each card. Available options depend on your Flow account.\n'
        '3. Choose an output folder and click **Run queue**. Each prompt waits for generation, '
        'downloads, and optional background removal before the next begins.\n'
        '4. Choose **Edit in Cutris** to touch up, crop, or resize an image. Click **Save & return** '
        'to bring the changes back to the gallery. Originals are preserved.\n\n'
        'Pause after the active prompt or cancel the remaining queue. Clearing the queue or '
        'image gallery keeps your saved files.\n\n'
        '**Updating:** Save edits and finish or cancel the queue before installing. Reload '
        '**gflowris bridge** in `chrome://extensions`, reload Flow, and reconnect your project.\n\n'
        '[Setup and troubleshooting](https://github.com/nahidmrdl/gflowris/blob/main/docs/setup.md) | '
        '[Prompt formats](https://github.com/nahidmrdl/gflowris/blob/main/docs/prompts.md) | '
        '[Cutris](https://github.com/nahidmrdl/cutris)\n')


def source_files(root=ROOT):
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if path.is_symlink() or not path.is_file() or any(p in EXCLUDED or p.endswith('.egg-info') for p in rel.parts):
            continue
        if path.suffix.lower() in {'.pyc', '.pyo', '.log', '.onnx', '.download', '.bak', '.exe', '.dll'}:
            continue
        if len(rel.parts) == 1 and rel.name in TOP_FILES or len(rel.parts) > 1 and rel.parts[0] in TOP_DIRS:
            yield path


def audit(paths, *, dependencies=False):
    """Detect local private paths/credentials without flagging public attribution."""
    findings = []
    patterns = [rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
                rb'(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36}(?![A-Za-z0-9_])',
                rb'(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{60,}']
    if dependencies:
        # Upstream wheels retain public CI/build paths and author attribution.
        # Match this workstation's actual home instead of every upstream account.
        home = str(Path.home())
        hosted_windows_account = (
            os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and os.environ.get('RUNNER_OS') == 'Windows'
            and os.environ.get('USERNAME', '').casefold() == 'runneradmin'
            and home.replace('\\', '/').rstrip('/').casefold() == 'c:/users/runneradmin'
        )
        # This public account also appears inside upstream Windows wheels.
        # Keep home-path checks on developer machines and self-hosted runners.
        # Credential checks above always apply, including on GitHub-hosted CI.
        if not hosted_windows_account:
            patterns += [re.escape(value.encode()) for value in {home, home.replace('\\', '/'), home.replace('\\', '\\\\')}]
    else:
        patterns += [rb'[A-Za-z]:[\\/]Users[\\/](?!runneradmin(?:[\\/]))[^\s\x00<>"\']+', rb'/Users/[^/\s]+/']
    for base in paths:
        candidates = base.rglob('*') if base.is_dir() else [base]
        for file in candidates:
            if not file.is_file():
                continue
            label = file.relative_to(base).as_posix() if base.is_dir() else file.name
            data = file.read_bytes()
            # The auditor's own regex fixtures are source code, not leaked paths.
            if file.name in {'release_utils.py', 'test_release.py'}:
                continue
            if any(re.search(pattern, data, re.IGNORECASE) for pattern in patterns):
                findings.append(label + ': private path or credential detected')
    if findings:
        raise RuntimeError('Publication audit failed:\n' + '\n'.join(findings))


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def zip_sources(output, root=ROOT):
    files = list(source_files(root))
    audit(files)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in files:
            archive.write(file, 'gflowris/' + file.relative_to(root).as_posix())
