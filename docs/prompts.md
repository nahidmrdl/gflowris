# Prompt input

The queue holds up to 25 prompt cards. Each card captures its settings when added. Changing the composer does not change existing cards. **Apply settings** copies checked settings to selected cards or the whole queue.

Choose the **?** beside Prompt for copyable examples, an always-visible settings reference, and every model, ratio, image count, and download size discovered in your connected Flow project. Examples cover white-background removal, any-background removal, keeping the background, and shared or individual settings. **Copy AI instructions** includes these choices and the full background-removal schema. Use **JSON** mode or **Import JSON** to turn its response into queue cards.

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

| Field | Values | Meaning |
| --- | --- | --- |
| `removeBackground` | `true`, `false` | Remove the background or keep the complete image. |
| `cutrisMode` | `"ai"`, `"white"` | Any background or White illustration. |
| `cutrisQuality` | `"detail"`, `"fast"` | Best detail or Faster. |
| `autoCrop` | `true`, `false` | Trim unused transparent margins or keep the original canvas. |

Mode, quality, and auto crop apply only when `removeBackground` is `true`. These choices can differ for each prompt. Use real booleans; `"white"` is a mode, not a value for `removeBackground`.

```json
{
  "title": "Crystal icon",
  "prompt": "A lavender crystal game icon on white",
  "ratio": "1:1",
  "count": 1,
  "resolution": "2K",
  "removeBackground": true,
  "cutrisMode": "white",
  "cutrisQuality": "detail",
  "autoCrop": true
}
```

Use the exact model and ratio choices shown in Prompt help. Counts are integers from 1 to 4; download sizes are `"1K"`, `"2K"`, or `"4K"`, when available in your account. The helper lists the discovered subset rather than assuming that every account enables every choice.

The optional `title` names the exported image. Without one, gflowris uses Flow's image title, then the prompt text. Multiple images and duplicate titles receive numbers.

Structured image JSON without a `prompt` field is preserved as one image prompt. A structured object inside `prompt` is also supported. Model, ratio, count, and resolution must be available in the connected Flow project when running.

Imports are previewed before they enter the queue. Invalid JSON and settings are rejected before generation. Maximum input size is 150 KB; each image prompt can contain up to 16,000 characters.
