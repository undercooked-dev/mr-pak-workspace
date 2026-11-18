---
name: video-edit
description: Generate or edit video through the AtlasCloud API. Use for motion studies, animation reference clips, image-to-video, video-to-video edits, turntables and any other video output. Covers model choice, cost check, submission, recovery and delivery.
---

# Video through AtlasCloud

All video generation and editing goes through AtlasCloud. There is no other video route and no fallback provider; if AtlasCloud cannot do the job, report that.

The mechanics live in [atlascloud-generation](../atlascloud-generation/SKILL.md): model discovery, the live schema, upload, submit, recover, download. Read it before the first job. This skill adds what is specific to video.

## Before submitting

- **Start frame.** For image-to-video, verify the opening frame first. If it needs generating or editing, that is an image job: use `image-edit`. Reuse one accepted starting image across the takes of a round so they can be compared.
- **Model.** Use the model the user or the repository's preferences name. Otherwise pick from the live catalog for the task (image-to-video, video-to-video, transfer) and say which you chose. Read that model's schema: duration, resolution casing and reference field names differ between models.
- **Cost.** Work out the price for the whole batch: clips, duration and resolution. State it before the first submission. Stay inside the budget and the take count the task gives; do not add takes.
- **Prompt.** Describe the action, the contact or key moment, the recovery, the duration and the camera. Hold the camera still unless motion is asked for. Do not restyle an accepted subject.

## Running jobs

One receipt per clip, saved before you wait. `processing` is normal for minutes. After a local timeout, recover the same prediction; never resubmit it. Download each result before relying on a provider link, into the folder the repository uses for the task.

When there are many clips, hand the submitting, polling and downloading to the `media-runner` agent with the prompts, references and output folder, so the job logs stay out of the working conversation.

## Review

Watch each clip at full size before presenting it. Check that the subject kept its identity, the action reads, contacts do not slide, the camera did what was asked, and a loop closes. Record what is actually in the clip, including flaws; `video-watch` gives timestamped analysis when timing matters.

Keep rejected takes with the reason. Present the takes for the user to choose; a completed job is not a selected clip, and your review does not replace the user's choice. A reference clip is not an authored animation: carrying it onto a rig is separate work.
