# Desktop setup

## Windows release

Download Windows Setup or the portable ZIP from [Releases](https://github.com/nahidmrdl/gflowris/releases). Windows 10/11 x64, Google Chrome, and Microsoft Edge WebView2 Runtime are required. The app installs for your account and includes its own Python, Node.js, full Cutris editor, and unpacked extension.

Setup downloads missing Microsoft WebView2 and Visual C++ runtimes from Microsoft and verifies their signatures. Installing the system Visual C++ prerequisite can request administrator approval. Portable users should install [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) and the [Visual C++ x64 runtime](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) if absent. Model setup is also available as an optional installer task.

Open gflowris and choose **Extension setup → Download extension ZIP**. The link follows the latest published release. Extract the ZIP to a permanent folder, enter `chrome://extensions` in Chrome's address bar, enable **Developer mode**, and choose **Load unpacked** to select the extracted folder. Sign into Flow through normal Chrome, open a project, and choose **Connect this project** in the extension popup.

The release registers its stable extension ID automatically. If the latest download cannot be checked, **View latest release** opens the release page so you can download the extension ZIP under Assets. The desktop download also includes an `extension` folder you can load manually.

For the portable build, extract the whole folder to a writable location and open `gflowris.exe`. Keep the loaded extension folder in place. Opening the app registers the bridge for that location.

For background removal, download a model from **Cutris editor → AI models** before running. Existing verified Cutris models are reused. AI weights are excluded from the app download.

## Run from source

The current source build uses Node.js 22+, Python 3.11–3.13, Google Chrome, and Microsoft Edge WebView2 Runtime.

Use a Python environment containing Cutris with its desktop dependencies. In the gflowris folder:

```powershell
npm ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install ".\vendor\cutris[desktop]"
```

## Connect Chrome

These manual native-registration steps apply to source installations. Packaged releases register automatically.

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select gflowris's `extension` folder.
3. Copy its extension ID. Register the native bridge:

   ```powershell
   .\scripts\setup-native.ps1 -ExtensionId <extension-id> -Python <python.exe>
   ```

   Add `-CutrisRoot <cutris-folder>` when loading Cutris directly from source.

4. Open **Start.cmd** or the gflowris shortcut.
5. Sign into Google Flow in normal Chrome and open a project. In **gflowris bridge**, choose **Connect this project**.

**Extension setup** provides the latest extension download and installation steps. Enter `chrome://extensions` in Chrome's address bar to manage extensions. Source installs use the project's own `extension` folder and development registration above.

The selected project must remain open during a queue. Chrome may ask to allow multiple downloads. Approve it to save a batch. After updating the extension, reload it and the Flow tab, then reconnect.

## Output and models

The default `gflowris-images` folder follows Windows' Pictures location. If Windows cannot provide one, it falls back to the user's home folder. Missing folders are created. A write check runs before generation; if it fails, choose another folder with **Browse**.

**Browse** opens a native folder picker in the desktop app. **Open folder** shows the output folder in Windows Explorer. Folder errors appear in the workspace or settings dialog.

Open **Cutris editor → AI models** to install or repair models. The same models and engine are used by automatic processing and the embedded editor. A standalone Cutris desktop installation is optional.

## Local state

`.local/` contains private runtime configuration, Native Messaging registration, API keys, settings, queued prompts, recent queues, logs, and developer captures. It is ignored by Git and must stay out of release payloads. Clearing the Images view preserves both exported files and the recent queue.

## Updates and troubleshooting

Save edits, finish or cancel any active queue, and close gflowris before updating. Setup stops the app's background helpers before replacing files; uninstall does the same before removing files. The Chrome extension stays installed. Reload the extension, reload Flow, and reconnect after updating. Packaged releases keep the same extension ID. Source installs can have a different development ID. Private settings and queues are kept across updates.

| Symptom | Action |
| --- | --- |
| Native messaging host not found | Open the release app once to register it; source installs need the setup command above. |
| Waiting for Chrome | Reload the extension and project, then connect the project again. |
| Desktop cannot open | Install or repair Microsoft Edge WebView2 Runtime. |
| AI model unavailable | Download the selected quality from Cutris editor → AI models. |
| Output folder not writable | Choose a different location using Browse. |
| Generation needs attention | Inspect Flow before retrying; ambiguous Generate actions are not retried automatically. |

Uninstall preserves exported images, shared Cutris models, and untracked private state. [Extension permissions](extension.md).
