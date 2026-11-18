# Project skills

Nineteen skills live in this project. `.agents/skills` is the maintained source
for Codex; `.claude/skills` contains complete, identical copies for Claude Code,
including scripts and references. Both Skills sections open the full instructions.
These are local project files, not global installations.

Raster image generation and editing default to the host's built-in imagegen.
AtlasCloud remains available for video, audio and supported 3D, and for images
only when the user explicitly chooses it. No automatic paid-image fallback is
authorized. Built-in tool availability and exposed account usage vary by host;
the skill pack neither bundles that tool nor establishes that generation is free.

Claude reads the instructions in its own `SKILL.md` when a skill is used; a
Markdown link is just a request to read another file, not automatic inheritance.
The template includes full folders so a normal Windows clone needs no symlinks.
See [Claude's skill format](https://code.claude.com/docs/en/skills).

For shared changes, edit `.agents/skills`, then run `npm run skills:sync`.
If you edited a Claude copy directly, first move that intended change into the
maintained source. `npm run test:template` checks that the two copies agree.

| Skill | Use it for |
| --- | --- |
| [3d-production-routing](../.agents/skills/3d-production-routing/SKILL.md) | Choose a practical workflow for 3D concepts, generated meshes, material maps, procedural Three.js reconstruction and game animation. |
| [blender-game-animation](../.agents/skills/blender-game-animation/SKILL.md) | Rig and animate supplied characters in Blender, revise motion from references, and deliver editable sources plus a verified game export. |
| [character-sheet-pipeline](../.agents/skills/character-sheet-pipeline/SKILL.md) | Prepare strict-front character sheets, isolated parts and optional multiview references for 3D modeling from an approved image. |
| [atlascloud-generation](../.agents/skills/atlascloud-generation/SKILL.md) | Create video, audio or supported 3D assets through AtlasCloud, plus image jobs explicitly chosen by the user. Discover models and schemas, upload references, recover jobs and download results. |
| [feature-handoff](../.agents/skills/feature-handoff/SKILL.md) | Prepare a precise handoff for an agent or developer implementing a feature, continuing a task or reviewing a finished change. |
| [game-animation-integration](../.agents/skills/game-animation-integration/SKILL.md) | Bring approved animation into a game, including clip mapping, turn exits, locomotion phase and gameplay event timing. |
| [game-audio-workflow](../.agents/skills/game-audio-workflow/SKILL.md) | Audition, select and integrate sounds with stable asset IDs, contact events, mixer rules and native listening checks. |
| [game-level-design](../.agents/skills/game-level-design/SKILL.md) | Build reviewable level drafts, validate scale and traversal, and apply accepted changes to the actual scene. |
| [game-ui-workflow](../.agents/skills/game-ui-workflow/SKILL.md) | Take a HUD or menu from a visual study to live game data, input behavior and native review. |
| [game-vfx-workflow](../.agents/skills/game-vfx-workflow/SKILL.md) | Develop effect layers, event timing, attachment, cleanup and in-game visual comparisons. |
| [gameplay-visual-review](../.agents/skills/gameplay-visual-review/SKILL.md) | Verify game changes with controlled native captures and separate implementation, visual review and acceptance. |
| [image-reference-workflow](../.agents/skills/image-reference-workflow/SKILL.md) | Explore image concepts and make faithful edits of accepted references for 3D or creative production, with explicit model choices and visual review. |
| [img2threejs](../.agents/skills/img2threejs/SKILL.md) | Turn an object or character reference image into a quality-gated, animation-ready procedural Three.js model built in code. Use for image-to-3D reconstruction, detail-accurate object rebuilds, stylized/likeness-maximized human characters, sculpt specs, and staged code generation. |
| [materials-to-game](../.agents/skills/materials-to-game/SKILL.md) | Create or apply material maps and bake a textured high-poly mesh onto a game mesh, with channel, UV and export checks. |
| [motion-reference-workflow](../.agents/skills/motion-reference-workflow/SKILL.md) | Prepare and select character motion references, or transfer approved motion to a human reference for a later mocap workflow. |
| [plan](../.agents/skills/plan/SKILL.md) | Turn a broad project request into a small actionable plan with concrete deliverables, dependencies and acceptance checks. |
| [video-watch](../.agents/skills/video-watch/SKILL.md) | Inspect a local or publicly accessible video through sampled scene frames, timestamps and a visual report, especially for motion and 3D reference analysis. |
| [voice-dictation-setup](../.agents/skills/voice-dictation-setup/SKILL.md) | Help configure optional local Whisper dictation into terminals and other apps, with language, hotkey and CPU or GPU checks. |
| [workspace-authoring](../.agents/skills/workspace-authoring/SKILL.md) | Create or maintain Workspace cards, report tabs and Markdown deliverables with consistent styling, working media previews and clear project organization. |

## Game production in 0.4.14

The six new game workflows connect concept work to implementation. They describe
how to inspect an existing project, preserve accepted work, hand over exact
event markers and review the result in the engine. They contain no private game
assets, character names, fixed balance values or personal working preferences.
Examples are illustrative; the receiving project's rules remain authoritative.

Blender animation now covers multiple Action owners, slots, bind-basis checks
and portable clip exports. Motion references keep a stable take ledger and
separate appearance transfer from mocap. Handoffs separate a selected proposal,
implementation, agent verification and user acceptance. The routing skill helps
an agent choose among these workflows.

These are instructions for agents, not bundled editor integrations. Use your
existing Unity or Blender connection, and check its available operations.
Generation is optional. A skill does not install an engine, connect an MCP
server or perform paid work by itself.

## Use the skills in another project

The release includes a separate **Mr-Mak-Skills-0.4.14.zip**. Extract it to a
temporary folder, then ask your agent to read `SKILLS-README.md` and copy only
the chosen modules and their dependencies into your project. Keep full skill
folders, including scripts, references and licences. The ZIP includes complete
Codex and Claude copies; no global installation or symlink is required.

The seven creative modules and six game workflows can be copied
with their own local resources. Preserve any referenced sibling skill when you
choose to use it. Keep the full img2threejs folder and its licences.

Workspace authoring, video inspection and dictation setup also reference this
repository's processes, knowledge and scripts. Copy those referenced files when
extracting a module; the ZIP includes these support files and shared report
assets. Merge them with an existing project instead of replacing its instructions,
reports or shared styles. Planning and handoff skills use the receiving project's
conventions. The standalone pack contains no Workspace cards or application.

A skill does not authenticate a provider or install a tool. Follow its setup
references and bring your own account. Credentials and raw paid-job receipts
must stay outside a shared skill pack.

For an existing Mr. Mak installation, see the
[update guide](https://github.com/witnesstodark/mr-mak-workspace/blob/main/docs/updating.md). Installing the
desktop update alone does not put new skills into your repository.
