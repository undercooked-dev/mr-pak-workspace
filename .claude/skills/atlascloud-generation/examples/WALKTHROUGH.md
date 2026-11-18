# A small first task

Ask your agent: "Use AtlasCloud to make one brass observatory robot concept.
Inspect the live schema and cost first. Save the result locally with the prompt
and prediction ID. I will decide whether to edit it after reviewing it."

The agent uses the selected model or discovers a suitable current model. These
inputs illustrate Nano Banana Pro; they are not a standing model preference.
From this skill directory, rehearse locally using Python 3.10+ (see
[setup](../references/setup.md) for the virtual environment):

```text
python scripts/atlas_job.py submit --kind image --model google/nano-banana-pro/text-to-image --input examples/concept.json --out /path/to/ignored/robot --dry-run
```

Expected: `dry_run: true`, model, endpoint and input field names. No network,
receipt or generated image. This checks structure, not live schema/account access.

For an authorized generation, omit `--dry-run` and provide credentials through
the environment or `--env /path/to/project/.env.atlascloud` before the subcommand.
Keep output outside the shared skill. The receipt is `robot/job.json`.
Continue without resubmitting:

```text
python scripts/atlas_job.py status --job /path/to/ignored/robot/job.json
python scripts/atlas_job.py result --job /path/to/ignored/robot/job.json
```

Each call checks once. Repeat at a reasonable interval while processing. A
successful result downloads to `robot/assets`. If downloading fails, rerun
`result`; if its saved URLs expired, add `--refresh` to query the same prediction.
Inspect the object before calling it accepted.

For a requested edit, upload the accepted source:

```text
python scripts/atlas_job.py upload --file /path/to/accepted.png --out /path/to/ignored/robot-edit/upload.json
```

Read `url` from the upload receipt locally. Replace the placeholder in a working
copy of `edit.json`, match its aspect ratio to the source, inspect the edit schema,
then submit using `--kind image --model google/nano-banana-pro/edit` and a new
output directory. Do not submit a placeholder or omit the image from an edit.

Expected visual criteria: one complete robot, telescope head, three feet, blue
body and readable silhouette. For the edit, only the paint changes. No generated
sample is bundled; this is a rehearsal brief, not a paid result.
