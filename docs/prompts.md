# Prompt input

The queue holds up to 25 prompt cards. Each card captures its settings when added. Changing the composer does not change existing cards. **Apply settings** copies checked settings to selected cards or the whole queue.

Choose the **?** beside Prompt for copyable examples of one prompt, shared or individual settings, and multiple JSON blocks. **Copy AI instructions** provides a brief you can give your AI, including the choices available in your connected Flow project. Use **JSON** mode or **Import JSON** to turn its response into queue cards.

## Single prompt

Write your full prompt, including paragraphs, and choose **Add to queue**. **Edit** loads a card back into the composer; **Save prompt** updates that card.

## Bulk text

Choose **Bulk text** or import as bulk text. Put `---PROMPT---` on its own line between prompts. **Insert separator** adds the marker at the cursor. Ordinary blank lines remain part of the prompt. Empty blocks are rejected.

```text
A lavender crystal game icon.

Keep a clean silhouette and soft highlights.
---PROMPT---
A mountain valley at sunrise.
```

## JSON

Accepted forms:

- A single object with a `prompt`.
- An array of prompt objects or strings.
- An object containing `prompts` and optional `defaults`.
- Several objects pasted together, including JSONL.
- Separate objects or arrays divided by `---PROMPT---`.
- One or more `.json`, `.jsonl`, or `.txt` files.

```json
{
  "defaults": {"resolution":"2K","count":1},
  "prompts": [
    {"title":"Crystal icon","prompt":"A crystal icon on white","ratio":"1:1","removeBackground":true},
    {"title":"Landscape","prompt":"A mountain valley at sunrise","ratio":"16:9","removeBackground":false}
  ]
}
```

Options: `model`, `ratio` (or `aspectRatio`), `count` (1–4), `resolution`, `removeBackground`, `autoCrop`, `cutrisQuality` (`detail` or `fast`), and `cutrisMode` (`ai` or `white`). Options can also be grouped under `settings`. The composer supplies missing options. A wrapper's `defaults` override the composer; individual entries override the wrapper.

Structured image JSON without a `prompt` field is preserved as one image prompt. A structured object inside `prompt` is also supported. Model, ratio, count, and resolution must be available in the connected Flow project when running.

Imports are previewed before they enter the queue. Invalid JSON and settings are rejected before generation. Maximum input size is 150 KB; each image prompt can contain up to 16,000 characters.
