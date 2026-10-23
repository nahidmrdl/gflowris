# Queue continuation and download recovery

- Continue cancelled or interrupted queues from the first unfinished prompt, preserving completed images.
- Reuse saved originals, cutouts, and Flow image references instead of generating completed work again.
- Recognize shortened Flow download filenames and recover missed download-completion notifications.
- Save original-image checkpoints before returning to the project grid, with clearer progress stages.

Release workflow notes field:

```text
Continue cancelled or interrupted queues from the first unfinished prompt while keeping completed images; Reuse saved originals, cutouts, and Flow image references when continuing; Fix shortened Flow filenames leaving completed downloads unrecognized; Recover missed download-completion notifications automatically; Save download checkpoints before returning to the Flow project and show clearer progress stages
```
