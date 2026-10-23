# How it works

1. **Compose.** Store up to 25 prompt cards with independent settings. Drafts persist separately from generated results.
2. **Generate.** The Node companion sends one command through Chrome Native Messaging. The extension applies settings, enters the prompt, and invokes Generate once in the selected project.
3. **Wait and save.** Observe generation and match every completed download. Start the next prompt after all expected originals are downloaded, while pending Cutris work continues locally.
4. **Refine.** A separate serial queue sends downloaded originals to the local Cutris API, which removes backgrounds, applies output settings, and creates editable projects. Originals remain separate. A prompt completes only after its requested cutouts are saved; the full queue stays running until both generation and background removal finish.
5. **Edit and return.** The complete Cutris editor opens in the same desktop window. Save & return exports the edited crop and dimensions, updates the revision, and refreshes gflowris with a new PNG. Earlier versions remain on disk.

Python owns the WebView2 desktop window and embedded editor. Node manages queue coordination and persistence. A C# host relays Chrome's length-prefixed messages without opening a console. Google login stays in normal Chrome.

## Pause and cancel

Pause stops new prompts after the current prompt finishes downloading, then finishes all pending cutouts before waiting. Cancel revokes outstanding local commands, aborts background-removal requests, stops waiting, and marks remaining items cancelled. Files remain saved. A task already submitted to Google or executing inside Cutris may finish in its engine; late replies cannot advance a cancelled queue.

Paused, cancelled, and interrupted queues can continue without resetting completed prompts. Generation tickets and completed asset references are saved before download work, and each original is checkpointed before navigating back to the project grid. Continuation reuses saved files and only requests missing downloads or cutouts. If an older or ambiguous generation has no saved reference, the app stops with a recovery message rather than silently submitting the prompt again. Reopen the original Flow project before continuing.

The download matcher accepts Flow's full image title or its first five words, while retaining resolution, source, and time-window checks. The extension reconciles the armed Chrome download on each heartbeat, so a missed completion event or transient bridge failure cannot strand an already completed download. Concurrent completion reports share one in-flight operation.

If background removal fails, the affected original is retained and marked for attention. No further prompts are submitted after the current prompt finishes downloading, and already queued cutouts finish before the queue reports the error. Generation and download errors also stop new submissions while previously queued cutouts finish. The app does not retry automatically.

## Standalone Cutris

`vendor/cutris` is a reviewed source snapshot that builds a normal Python wheel. gflowris bundles it for the full editor and API. The same package works independently as a CLI/API or desktop app; a separate Cutris executable is optional.

## Release layout

The installer and portable ZIP contain the desktop launcher, app assets, unpacked extension, native host, Node.js, and a relocated Python runtime with Cutris dependencies. Tcl/Tk is retained for model setup. Model weights and private settings are excluded.

The bootstrap creates private runtime paths using the actual install location and registers only the release extension origin under the current Windows user. Reconfiguration preserves settings and queues.
