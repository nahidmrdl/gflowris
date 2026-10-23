# Background processing update

- Faster batches: after the previous prompt's images finish downloading, gflowris starts generating the next prompt while Cutris removes backgrounds locally.
- Fixed a cancelled generation blocking a fresh queue with “A generation is already being tracked.”
- Cutris processes one image at a time. A batch is marked complete only after all requested cutouts are saved.
- Pause finishes the active prompt and pending cutouts before waiting. Cancel stops pending work and keeps files already saved.
- If background removal fails, the original stays available and the affected image is marked for attention. Any prompt already submitted finishes downloading before generation stops.

Release workflow notes field:

```text
Start the next prompt after downloads while background removal runs locally; Process cutouts one at a time and wait for all cutouts before completing the batch; Fix cancelled generations blocking a fresh queue; Preserve saved originals, pause, cancellation, and per-image error reporting
```
