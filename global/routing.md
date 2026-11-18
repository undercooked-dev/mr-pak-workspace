## Work routing

These routes apply in every repository. A repository's own `AGENTS.md` or `CLAUDE.md` adds its project rules (code conventions, engine tools, what counts as verification) and wins where it is more specific.

| Work | Goes to | How |
| --- | --- | --- |
| Planning: scope, staging, approach, re-plan | Claude Fable 5.2, xhigh effort | `plan-handoff` skill, `planner` agent |
| Executing a plan | Claude Opus 5.5: xhigh for ordinary stages, max for high-complexity ones | `execute-handoff` skill, `executor` / `executor-max` agents |
| Checking finished work | Claude Fable 5.2, xhigh, read-only | `reviewer` agent |
| Image generation and editing | Codex built-in image generation; AtlasCloud once Codex credits are exhausted | `image-edit` skill |
| Video generation and editing | AtlasCloud | `video-edit` skill |
| Audio generation | AtlasCloud | `atlascloud-generation` skill |
| 3D model generation and Tripo texturing | The user, by hand in Tripo Studio | `tripo-handoff` skill; agents never call Tripo |
| Accepting a visual or playable result | The user | Agent verification does not replace it |

- Plan before implementing anything that takes more than one step, and hand execution to the tier the plan names.
- Paid media jobs: check the cost first, save the job receipt before waiting, and recover a job after a timeout instead of submitting it again.
- Do not commit or push without an explicit request.
