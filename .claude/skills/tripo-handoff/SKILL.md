---
name: tripo-handoff
description: Hand 3D model generation and Tripo texturing to the user, who does it by hand in Tripo Studio. Use whenever work needs a new mesh, a retopologised or textured model, or any other Tripo output - prepare the inputs and settings, stop for the user, then take in the files they return. Agents never call Tripo.
---

# Tripo handoff

3D model generation is manual work done by the user in the Tripo Studio workspace. An agent prepares everything the user needs, waits, and then takes in the result. Do not call the Tripo API or CLI, even if a key is present, and do not substitute another mesh generator.

## 1. Prepare the request

Confirm the inputs are the accepted ones before asking for anything: Tripo credits are spent on the user's account, and a mesh built from an unaccepted reference is wasted.

Put the request in the chat, not in a new report file, unless the repository keeps a checklist for this step (then tick it there). Give the user:

- **Input files**: exact paths of the views or the FBX to upload, in upload order, and which view each one is (front, left, back). Use the accepted originals unchanged.
- **Settings**: read them from the repository's standing preferences and state them plainly, for example model version, quad or triangle output, face target, and whether a texture pass is wanted. If the repository records none, ask instead of inventing them.
- **What to produce**: one line per expected output, such as "neutral body, 100% body, 200% body".
- **Where to put the result**: the folder to drop the downloads into, and that companion files (textures, `.mtl`, material maps) must come with the model.
- **What to keep**: the original download stays untouched; all later work happens on copies.

Then stop and wait. Carry on with any work that does not depend on the model.

## 2. Take in the result

When the user says the files are there:

1. Read the folder. Check every expected output is present, with its companion files.
2. Give files and objects usable names where the provider's names are unhelpful. Keep companion paths that other files depend on.
3. Preserve the original download separately from anything you edit.
4. Open the model in the DCC tool the repository uses and check what the next step needs: scale and orientation, disconnected or overlapping islands, missing parts, material and texture assignment.
5. Report what arrived and what you found. Do not judge it by polygon count unless the repository says to; requested face counts are best-effort targets.

A returned mesh is an input to the next stage, not an accepted asset. Topology, UVs, rigging and import still get their own checks, and the user decides whether the model looks right.

## If the result is not usable

Describe the concrete problem (a fused limb, a missing cavity, a texture baked with lighting) and what would fix it: a different view, a different setting, or a correction in the DCC tool. Fix in the DCC tool when that is cheaper than a new generation. Ask for a new generation only with a specific reason, since each one costs the user credits and time.
