# Connect AtlasCloud in another project

Copy the complete `atlascloud-generation` folder into the project's agent skill
directory. Keep scripts and references together. No original project assets,
account or credentials are included.

## Account and MCP

Use your own [AtlasCloud API key](https://www.atlascloud.ai/docs/en/api-keys).
The official local stdio MCP runs with `npx -y atlascloud-mcp` and reads
`ATLASCLOUD_API_KEY` from its process environment. Follow the current
[MCP guide](https://www.atlascloud.ai/docs/en/mcp-server) for your client.
Merge any requested connection into existing configuration. Supply the secret
through the client's environment-secret support; never commit a literal key.
A skill edit alone does not authorize installing or reconfiguring a connection.

An env file is not automatically loaded by every MCP client. Confirm the tools
are actually available in the intended session; model/schema discovery needs
no generation. API generations use the AtlasCloud account's media budget.
Do not assume another product's subscription or coding allowance covers them.

## Python helper

Use Python 3.10+ and a project-local virtual environment. From this skill folder:

```text
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
.venv/bin/python scripts/atlas_job.py --help
```

On Windows, use `python -m venv .venv` and `.venv/Scripts/python.exe` for later
commands. In examples below, `python` means that virtual environment's Python.

Set `ATLASCLOUD_API_KEY` in the process environment or an ignored env file.
Use `--env /path/to/project/.env.atlascloud` for an explicit file. Otherwise only
the current directory's `.env` is considered. Environment values take precedence;
no parent-directory search or credential migration occurs. This workspace uses
`.env.atlascloud`; select it explicitly. The helper never prints keys.

```text
python scripts/atlas_job.py submit --kind image --model google/nano-banana-pro/text-to-image --input examples/concept.json --out /path/to/ignored/robot --dry-run
```

Dry runs do not load credentials or HTTP dependencies, upload, contact AtlasCloud
or create receipts. Actual submission spends API credits. Inspect the model's
live schema and price first. Keep job/upload/result receipts in an ignored task
directory outside the skill. Share clean skill sources, not working output.

## Existing Atlas CLI

If the official `atlas` CLI is already installed, inspect `atlas --help` and
`atlas models get MODEL_ID --json` for current discovery/schema support.
`atlas generate cost image MODEL_ID ... --json` (or `cost video`) estimates the
specific request without generating. Use the same parameters as the planned job.
Do not install a CLI or change its account merely to read this skill.

Sources checked 2026-10-26: [official MCP source](https://github.com/AtlasCloudAI/mcp-server),
[CLI guide](https://www.atlascloud.ai/docs/cli).
