# Changelog

## Unreleased

- Continue cancelled or interrupted queues from their first unfinished prompt, keeping completed images and cached Flow generation references.
- Recognize Flow download filenames shortened to five title words and recover missed download-completion notifications on each heartbeat.
- Save original-image checkpoints before returning to the Flow grid, with clearer download and navigation stages.
- Keep raw Flow downloads in `gflowris-downloads` beside the image output folder, removing browser landing copies only after saving the original and archive.
- Reset stale Flow generation tracking after cancellation so a new queue can start without reloading the page.
- Start the next Flow prompt after downloads finish while local background removal continues.
- Process cutouts one at a time and keep the queue running until every requested cutout is saved.
- Keep pause, cancellation, saved originals, and per-image errors working across generation and background removal.
- Name exported images from prompt or Flow titles and separate originals from cutouts and edited PNGs.
- Show all JSON settings and available Flow choices, with examples for background modes, quality, and auto crop.
- Display background treatment and AI quality on each prompt card.
- Fix folder opening and browsing in the workspace and embedded Cutris editor, with visible errors instead of silent failures.
- Stop background helpers during updates and uninstall to release locked files.
- Protect open edits and active queues during setup; keep the Chrome extension installed.

## Initial release

- Windows desktop workspace with a Chrome extension and Native Messaging.
- Up to 25 prompt cards with independent generation and Cutris settings.
- Text/JSON imports with an explicit prompt separator.
- Sequential generation, matched downloads, pause, and cancellation.
- Complete Cutris editor with touch-ups, crop, resize, and Save & return.
- Preserved originals, versioned PNG edits, output folders, and saved drafts.
- Installer, portable, extension, and source releases through GitHub Actions.
