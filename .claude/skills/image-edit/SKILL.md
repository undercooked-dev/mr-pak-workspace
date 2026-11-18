---
name: image-edit
description: Generate or edit raster images - concepts, reference sheets, isolated parts, UI art, textures, opening frames, faithful edits of an accepted image. Routes to Codex built-in image generation first and to the AtlasCloud API once Codex credits are exhausted. Use for any image generation or image editing request.
---

# Image generation and editing

Images have one route with one fallback:

1. **Codex built-in image generation.** It draws on the Codex plan's credits and needs no API key.
2. **AtlasCloud**, only when Codex reports that its credits or usage limit are exhausted, or when the user names AtlasCloud for the task.

A weak result, a refusal, a rate limit or a network error is not exhaustion. Retry or report those; they do not authorize a paid job. Preserve an explicit user choice of provider or model for a task.

For what to ask for (exploration versus a faithful edit, camera, labelling takes), read `image-reference-workflow`. This skill covers where the job runs.

## Route 1: Codex

**Inside a Codex session**, use the built-in image tool directly, then copy the selected output from `$CODEX_HOME/generated_images/` into the project. Do not use its API-key CLI fallback.

**From Claude Code or any other agent**, call the helper, which runs one non-interactive Codex job and copies the results into the folder you name:

```bash
node <this skill>/scripts/codex_image.mjs \
  --prompt-file brief.txt --ref accepted/front.png \
  --out path/to/task/folder --name robot-side --count 1
```

Pass each accepted reference with `--ref`; for an edit, the prompt states only the change. `--dry-run` prints the command without calling Codex. Outputs are numbered and never overwrite an existing file. The helper prints the delivered paths as JSON.

| Exit | Meaning | Do |
| --- | --- | --- |
| 0 | Images delivered | Review them |
| 20 | Codex credits or usage limit exhausted | Go to Route 2 |
| 21 | Codex finished without producing an image | Read the saved log; fix the prompt or report |
| 22 | Rate limit, timeout or network error | Wait and retry; do not fall back |
| 23 | Codex is not installed or not signed in | Tell the user; do not fall back |

## Route 2: AtlasCloud fallback

Use [atlascloud-generation](../atlascloud-generation/SKILL.md) for the mechanics: live schema, upload, one receipt per job, recovery and download.

- **Model.** Default to `openai/gpt-image-2/edit` for edits and reference-led generation, the same family Codex uses, unless the user or the repository names another. Confirm it in the live catalog before the first job.
- **Cost.** Say that you are switching to AtlasCloud and what the remaining images will cost, using [observed prices](references/costs.md), not the catalog base price. The request for the images already authorizes this switch; do not ask again for a small batch. If the remaining batch is estimated above US$5, stop and ask first.
- **Key.** `ATLASCLOUD_API_KEY` from the environment, else the repository workspace's ignored `.env.atlascloud`, else `~/.config/mr-pak/atlascloud.env`. Never print it or write it to a tracked file.
- Finish only the images Codex did not deliver. Do not regenerate ones already made.

Record the observed charge in `references/costs.md` when a model or setting is new.

## Either route

- Edit from the accepted file itself, never from a description of it. State what must stay unchanged.
- Add no style words the brief does not contain; they redesign the asset.
- Review every image at full size against the brief: identity, framing, missing or added parts, the requested change. Keep rejected takes with a one-line reason.
- Put outputs where the repository keeps that task's media. Record which provider and model made each image.
- A generated image is a candidate. The user accepts or rejects it.
