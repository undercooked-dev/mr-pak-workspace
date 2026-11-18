---
name: tripo-handoff
description: Get a 3D model or its textures made in Tripo. Use whenever work needs a new mesh, a retopologised or textured model, or any other Tripo output. At the handoff, ask the user whether they will do it by hand in Tripo Studio or want it submitted through the Tripo API, then prepare the inputs, run or wait accordingly, and take in the result.
---

# Tripo handoff

3D models come from Tripo, by one of two paths. The user picks the path each time a model is needed.

## 1. Confirm the inputs, then ask which path

Confirm the views are the accepted ones before anything is generated: a mesh built from an unaccepted reference wastes credits on either path. Use the accepted originals unchanged.

Then ask the user, once per handoff:

- **Manual**: they generate in Tripo Studio themselves. This draws on their Studio allowance and lets them judge and regenerate in the app.
- **API**: you submit the job. This spends the separate API credit balance; state the expected cost when you ask.

Do not ask when the answer is already given: the user named a path for this task, or the repository's pipeline or checklist assigns the step (a step marked "User" is manual). Do not substitute another mesh generator on either path.

## 2. Settings

Take settings from the repository's standing preferences where it records them. Otherwise use the recipe this workflow was proven on, and say that you are using it:

| Setting | Default |
| --- | --- |
| Inputs | Three separate views of the accepted design: front, left, back |
| Model | Tripo P2 (`P2-20260801` when proven; confirm the current ID) |
| Topology | Quad output |
| Face target | Small 10,000, medium 12,000, large 15,000. A best-effort request, not an acceptance gate |
| Texture | On, with PBR, aligned to the original image, standard quality |

Do not audit polygon counts, or regenerate or decimate to hit the number, unless the repository asks for that.

## 3a. Manual path

Give the request in the chat, or tick the repository's checklist if it keeps one for this step. Do not create a report file for it. Tell the user:

- the exact input files, in upload order, and which view each is;
- the settings above, in plain words;
- one line per expected output;
- the folder to drop the downloads into, with their companion files (textures, `.mtl`, material maps).

Then stop and wait, and carry on with work that does not depend on the model.

## 3b. API path

Use [the job helper](scripts/tripo_job.py). One job directory is one paid submission; keep it in an ignored folder, because it holds API receipts.

```bash
python <this skill>/scripts/tripo_job.py prepare --job .cache/tripo/<name> \
  --front front.png --left left.png --back back.png --faces 12000 \
  --expected-credits <N> --out <model folder> --name <name> [--dry-run]
python <this skill>/scripts/tripo_job.py submit --job .cache/tripo/<name>
python <this skill>/scripts/tripo_job.py poll   --job .cache/tripo/<name>
```

- Read the current price for the chosen model and settings and pass it as `--expected-credits`. The proven P2 run (quad, textured, PBR) cost 110 credits, about US$1.10, on 2026-10-27. `submit` refuses if the balance is lower and never buys credits.
- `prepare --dry-run` shows the request without a key or a network call. Use `--option key=value` for a field the helper does not name, and `--model` when the proven ID has been replaced.
- The key is `TRIPO_API_KEY` from the environment, else `--env <file>`, else `./.env.tripo`, else `~/.config/mr-pak/tripo.env`. Never print it or put it in a tracked file.
- After a timeout or a dropped connection, run `status` or `poll` on the same job directory. `submit` cannot be repeated for a job; a second submission would be a second charge.
- The helper needs the `requests` package. Install it in a virtual environment, not the system Python.
- The download never overwrites a different file. Report the credits consumed.

## 4. Take in the result

On either path, once the files exist:

1. Check every expected output is present, with its companion files.
2. Give files and objects usable names where the provider's names are unhelpful. Keep companion paths other files depend on.
3. Preserve the original download separately from anything you edit.
4. Open the model in the DCC tool the repository uses and check what the next step needs: scale and orientation, disconnected or overlapping islands, missing parts, material and texture assignment.
5. Report what arrived and what you found.

A returned mesh is an input to the next stage, not an accepted asset. Topology, UVs, rigging and import still get their own checks, and the user decides whether the model looks right.

## If the result is not usable

Describe the concrete problem (a fused limb, a missing cavity, a texture baked with lighting) and what would fix it: a different view, a different setting, or a correction in the DCC tool. Fix in the DCC tool when that is cheaper than a new generation. A new generation needs a specific reason and, on the API path, a new job directory and the user's agreement to the cost.
