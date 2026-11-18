---
name: atlascloud-generation
description: Create video, audio or supported 3D assets through AtlasCloud, or generate and edit images when the user explicitly chooses AtlasCloud. Use for model discovery, schema and cost checks, reference uploads, generation, recovery and local delivery.
---

# AtlasCloud generation

Turn the user's brief and supplied references into downloaded, reviewed assets.
Use an available AtlasCloud MCP connection; the included Python REST helper
supports local uploads and recoverable asynchronous jobs when MCP is unavailable.
This skill and its relative resources can be copied into another project.

Raster images use built-in imagegen by default. Use AtlasCloud for images only
when the user explicitly chooses that provider; its image examples are opt-in
capabilities, not an automatic fallback. A failed or unavailable built-in image
tool does not authorize switching to Nano Banana or another image API. Video,
audio and supported 3D operations retain their existing routing and task budgets.

## Choose the operation

Distinguish concept exploration, faithful editing, reference-sheet preparation,
motion generation, mesh generation and material creation. Preserve a selected
provider, model, accepted image, pose, camera and requested output count.
An edit changes the requested feature; it does not redesign the whole asset.

Discover available tools first. With AtlasCloud MCP, use `atlas_list_models` and
`atlas_get_model_info` for the exact model ID, input/output schema and pricing.
Otherwise use the official model catalog or an already installed Atlas CLI.
Display names and another provider's IDs/parameters are not interchangeable.
Check the full batch cost, including duration, resolution and output count.
Use existing authorization without asking again for already-approved work.
Defaults in an old script are not a model choice or permission to spend.

Read [API and MCP workflow](references/mcp-workflow.md) for exact calls, examples
and recovery. Read [prompting and review](references/prompting-and-review.md)
for concept, reference-edit and material decisions. Read [setup](references/setup.md)
when connecting another machine. Each recipient uses their own credentials.

For 3D, verify that the selected AtlasCloud model returns a mesh and identify its
actual formats. For materials, verify separate PBR-map outputs; an image model
does not imply normal, roughness or metalness generation. Explain unavailable
operations instead of inventing an endpoint or silently switching providers.

## Run and retain the job

1. Inspect the selected input files. Upload only references needed for the task.
   A local stdio MCP can use local paths; a remote host cannot read the agent's
   filesystem. Use `atlas_upload_media` where accessible or the Python helper.
   Keep upload URLs in local receipts; they are temporary, not permanent assets.
2. Build inputs from the live schema. AtlasCloud models can use `images`, `image`,
   `image_url` or other fields; resolution casing and duration vary by model.
   The REST body contains `model` plus model fields at the top level. MCP uses
   `model` and a separate `params` object. Do not add extra features by default.
3. Submit through the matching image/video/audio endpoint or MCP tool. Save the
   model, inputs and prediction ID immediately. The helper creates an exclusive
   receipt before its single POST and never automatically retries submission.
4. Continue the same prediction with `atlas_get_prediction` or helper
   `status`/`result`. `processing` is normal. A local wait timeout does not
   authorize a duplicate job. Terminal failure, cancellation or provider timeout
   ends polling; inspect the saved error before considering another attempt.
   If submission returned no ID, inspect account history before resubmitting.
5. Download outputs before relying on provider links. Retry a failed download
   from the same result; refresh that prediction if its URLs have expired.
   Inspect every requested asset, preserve rejected takes and their reasons,
   and record technical completion separately from visual acceptance.

Keep prompt, source filenames/hashes, model ID, prediction ID, local outputs and
review verdict together. Keep credentials, raw responses and signed links out of
shared reports and Git. Use an ignored task directory for receipts. A generated
mesh still needs topology, rig and export checks. In Mr. Mak, use the current card
and shared media viewer; elsewhere use the recipient's requested output folder.

For a requested Blender handoff, verify the downloaded asset imports with its
materials and save the editable scene. Remote completion alone does not prove
that handoff. Inspect existing generation scripts before reuse: replaying a
numbered project script can submit another paid job or use stale checkpoints.
Record estimated cost separately from observed billing.

## Included tools and examples

- [REST helper](scripts/atlas_job.py): upload, submit, status and result download.
  One receipt per job; an existing receipt blocks another submission.
- [Python dependencies](scripts/requirements.txt).
- [Concept input](examples/concept.json) and [edit input](examples/edit.json):
  Nano Banana Pro examples, not standing model choices.
- [Example task](examples/WALKTHROUGH.md): a non-spending rehearsal and recovery.

Resolve paths against this skill directory. `--help` and `submit --dry-run` need
no account, dependencies or network. The local dry run checks input structure,
not the provider's live schema, availability, credentials or balance. The helper
supports asynchronous URL outputs; use the provider's documented tools for
synchronous or base64 output modes. Keys come from `ATLASCLOUD_API_KEY` in the
environment or a selected ignored env file; never print their values.
