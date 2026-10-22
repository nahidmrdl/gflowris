# How it works

1. **Compose.** Store up to 25 prompt cards with independent settings. Drafts persist separately from generated results.
2. **Generate.** The Node companion sends one command through Chrome Native Messaging. The extension applies settings, enters the prompt, and invokes Generate once in the selected project.
3. **Wait and save.** Observe generation and match every completed download. The next prompt waits until all expected images finish.
4. **Refine.** The local Cutris API removes backgrounds, applies output settings, and creates editable projects. Originals remain separate.
5. **Edit and return.** The complete Cutris editor opens in the same desktop window. Save & return exports the edited crop and dimensions, updates the revision, and refreshes gflowris with a new PNG. Earlier versions remain on disk.

Python owns the WebView2 desktop window and embedded editor. Node manages queue coordination and persistence. A C# host relays Chrome's length-prefixed messages without opening a console. Google login stays in normal Chrome.

## Pause and cancel

Pause finishes the current prompt before waiting. Cancel revokes outstanding local commands, stops waiting, and marks remaining items cancelled. Files remain saved. A task already submitted to Google or executing inside Cutris may finish in its engine; late replies cannot advance a cancelled queue.

## Standalone Cutris

`vendor/cutris` is a reviewed source snapshot that builds a normal Python wheel. gflowris bundles it for the full editor and API. The same package works independently as a CLI/API or desktop app; a separate Cutris executable is optional.

## Release layout

The installer and portable ZIP contain the desktop launcher, app assets, unpacked extension, native host, Node.js, and a relocated Python runtime with Cutris dependencies. Tcl/Tk is retained for model setup. Model weights and private settings are excluded.

The bootstrap creates private runtime paths using the actual install location and registers only the release extension origin under the current Windows user. Reconfiguration preserves settings and queues.
