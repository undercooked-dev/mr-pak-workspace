# AtlasCloud API and MCP workflow

Checked against official docs and MCP source on 2026-10-26. Discover live tools
and schemas again when executing; host prefixes and installed versions differ.

| Stage | MCP tool | Essential inputs |
| --- | --- | --- |
| Find models | `atlas_list_models` | `query`, optional `type` (`Image`, `Video`, `Audio`) |
| Inspect schema and pricing | `atlas_get_model_info` | `model` |
| Upload a local reference | `atlas_upload_media` | `file_path` accessible to that MCP process |
| Generate image or supported 3D mesh | `atlas_generate_image` | `model`, `params` |
| Generate video | `atlas_generate_video` | `model`, `params` |
| Generate audio | `atlas_generate_audio` | `model`, `params` |
| Continue the same task | `atlas_get_prediction` | `prediction_id` |
| Recover an unknown submission | `atlas_list_predictions`, when available | Filter by model/time; otherwise inspect console history |

Some current generation tools accept `dry_run: true` for schema validation.
Check the installed tool schema before using it. Avoid keyword-based quick
generation when it could override a selected model or reference contract.

## REST contract

Base: `https://api.atlascloud.ai/api/v1`. Authenticate with
`Authorization: Bearer <ATLASCLOUD_API_KEY>`.

| Operation | Method and path |
| --- | --- |
| Image / supported 3D model | `POST /model/generateImage` |
| Video | `POST /model/generateVideo` |
| Audio | `POST /model/generateAudio` |
| Reference upload | `POST /model/uploadMedia`, multipart field `file` |
| Status and outputs | `GET /model/prediction/{prediction_id}` |

Generation bodies contain `model` alongside the model-specific fields, not a
nested `input` or `params`. The usual response is `data.id`; polling returns
`data.status` and `data.outputs`. Some generated API examples show an unwrapped
prediction; the helper accepts both. Uploads return `data.download_url` in the
current MCP implementation; the quick-start also documents a top-level `url`.
The helper accepts both response forms. Keep returned links local.

## Example: one faithful image edit

Inspect `google/nano-banana-pro/edit` before using the bundled
[edit input](../examples/edit.json). Its reference field is `images`; resolution
values are lowercase (`1k`, `2k`, `4k`). Do not add an unsupported `num_images`
field. Choose a supported aspect ratio matching the accepted reference.
For example, MCP inputs for a square reference are:

```json
{
  "model": "google/nano-banana-pro/edit",
  "params": {
    "prompt": "Keep the same object, proportions, camera, background and lighting. Change only the blue painted panels to muted green. Preserve unpainted metal and all small details.",
    "images": ["https://example.invalid/replace-with-your-upload.png"],
    "aspect_ratio": "1:1",
    "resolution": "2k",
    "output_format": "png"
  }
}
```

Replace the placeholder URL with an actual upload. For a new concept, inspect
`google/nano-banana-pro/text-to-image`; editing requires the source image.
Neither ID is a standing preference. Recheck schema and price at execution.

## Recovery and delivery

Save prediction ID, exact model, request inputs and any returned URLs immediately.
`created`, `queued`, `starting` and `processing` mean continue the existing job.
`completed` or `succeeded` permits result inspection. `failed`, `error`,
`canceled`/`cancelled` and provider `timeout` are terminal. A terminal task can
arrive inside an HTTP error response; inspect its status instead of polling forever.
A local polling timeout only means stop waiting and resume later.

Use bounded polling, around 2 seconds for images and 5 seconds for video, with
user updates. The helper performs one status request per invocation. Never
automatically retry the generation POST. If its outcome is unknown, retain the
receipt guard and recover the ID from history before any new paid submission.

The helper saves `result.json` before downloading and reuses it for recovery.
If output URLs expire, `result --refresh` queries the same prediction again.
An expired input upload may need a new upload receipt before a future job;
do not regenerate an already submitted asset to repair a download. Cancellation
is separate scope, not a response to a slow request.

Outputs can be media URLs, nested mesh/map objects or text, depending on the
model. Download only output media, not reference or status links. Verify expected
files and visual quality separately from provider success. For mesh or PBR work,
confirm the catalog supports the actual operation and expected channels/formats.

Sources: [MCP documentation](https://www.atlascloud.ai/docs/en/mcp-server),
[official MCP implementation](https://github.com/AtlasCloudAI/mcp-server),
[prediction lifecycle](https://www.atlascloud.ai/docs/predictions),
[uploads](https://www.atlascloud.ai/docs/upload-files),
[concept schema](https://www.atlascloud.ai/docs/en/more-models/google/nano-banana-pro-text-to-image/generateImage),
[edit schema](https://www.atlascloud.ai/docs/more-models/google/nano-banana-pro-edit/generateImage).
