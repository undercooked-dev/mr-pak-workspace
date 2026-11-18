---
name: 3d-production-routing
description: Choose a workflow for 3D concepts, meshes, materials, animation, game VFX, UI, levels, audio and native visual review.
---

# Route 3D production

Start with the intended deliverable: image reference, editable geometry,
textured mesh, material maps, rigged character or engine-ready animation.
Inspect the supplied assets and the target engine before selecting a route.

Use built-in imagegen by default for raster image generation and editing,
including concepts, reference sheets, isolated parts, UI art and VFX textures.
Preserve an explicit user choice of another image provider. Do not automatically
fall back to Nano Banana, AtlasCloud or another image API if built-in generation
is unavailable or misses a requirement; report the limitation for a route choice.

| Need | Skill |
| --- | --- |
| Explore silhouettes or edit an accepted image | `image-reference-workflow` |
| Front sheet, parts and modeling references | `character-sheet-pipeline` |
| Generate video, audio or supported meshes through AtlasCloud; images only when explicitly chosen | `atlascloud-generation` |
| Editable procedural geometry in Three.js | `img2threejs` |
| Validate and deliver a PBR material | `materials-to-game` |
| Analyze motion timing | `motion-reference-workflow` or `video-watch` |
| Rig, skin, animate and export in Blender | `blender-game-animation` |
| Integrate clips and locomotion transitions in an engine | `game-animation-integration` |
| Plan and implement event-driven visual effects | `game-vfx-workflow` |
| Develop a HUD or menu from concept through live game state | `game-ui-workflow` |
| Design and validate a playable level | `game-level-design` |
| Select and integrate game sounds | `game-audio-workflow` |
| Verify the result in the actual game | `gameplay-visual-review` |

Read the selected skill before execution. Its presence does not mean its MCP,
CLI, account or editor is connected. Inspect live capabilities and exact model
schemas; keep provider choices and accepted references from the current task.

For a game asset, separate concept acceptance from mesh acceptance. Verify
topology, scale, materials, rig, root motion and engine import as applicable.
A successful API request or attractive render is not an engine handoff.
Record the chosen route and acceptance criteria in the current project card.
