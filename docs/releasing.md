# Publishing a release

Open **Actions → Release gflowris → Run workflow** on `main`.

| Input | Example |
| --- | --- |
| Version | `1.0.0` |
| Release notes | `Queue up to 25 prompts; Generate and download in sequence; Edit cutouts inside gflowris` |

Each semicolon starts a bullet; empty entries are ignored. Use three numbers without `v`. The workflow adds the tag prefix. Renaming a downloaded file does not change the app version.

## Build and publish

The workflow validates inputs and rejects existing versions, applies the version to package files/extension/executable/installer, audits publishable sources, and builds the runtime and Cutris wheel. It runs only when manually started. It does not run tests, sign into Google, or download AI models.

A separate publishing job downloads only that run's artifacts, checks SHA-256 hashes, creates a versioned release commit, uploads all assets to a draft, verifies uploaded digests, then publishes. The tag points to the versioned commit; `main` is not rewritten or automatically bumped.

Use a new version such as `1.0.1` next time. Existing versions are never overwritten. A failed upload leaves a draft for inspection; remove only an unpublished failed draft before retrying that version.

The build job has read-only repository access. Only publishing can write releases. Actions are pinned by commit. Inputs use environment variables or structured API fields instead of shell interpolation.

## Downloads

| File | Contents |
| --- | --- |
| `gflowris-VERSION-windows-x64-setup.exe` | Per-user installer with the runtime, full editor, and extension. |
| `gflowris-VERSION-windows-x64-portable.zip` | Same app in an extractable writable folder. |
| `gflowris-VERSION-chrome-extension.zip` | Stable-ID unpacked Chrome bridge. |
| `gflowris-VERSION-source.zip` | Source, documentation, tests, and reviewed Cutris snapshot. |
| `SHA256SUMS.txt` | Checksums for the four downloads. |

AI weights download through the model manager. Windows binaries are currently unsigned.

## Local build

Use a clean checkout, Windows x64, full Python 3.12 with Tcl/Tk, Node.js 22+, and Inno Setup 6. Existing `dist/gflowris` or nonempty `release` folders cause a build to stop rather than mixing old artifacts.

```powershell
python -m pip install -r requirements-build.txt
npm ci
$env:RELEASE_VERSION = '1.0.0'
$env:RELEASE_NOTES = 'Initial release; Full Cutris editor'
python -B scripts/prepare_release.py
python -B scripts/build.py --installer --iscc 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
```

`python -B scripts/build.py --source-only` packages publishable sources only. Developers can explicitly add `--verify-runtime` for a local smoke check; the release workflow does not enable it. Change `packaging/runtime-lock.json` deliberately when updating Node.js, verifying the official archive checksum.

Before release, review notes/media and run the real five-prompt smoke test when Flow controls change. Check multi-image downloads, cancellation, retained backgrounds, and Cutris Save & return. Keep private state, models, browser profiles, and account details out of public files.
