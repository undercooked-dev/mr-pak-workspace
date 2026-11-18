---
name: plan-handoff
description: Route planning work to Claude Fable 5.2 at xhigh effort. Use before implementing anything that takes more than one step - scoping a feature, staging a change, choosing between approaches, re-planning after a failed attempt - and whenever the user asks for a plan.
---

# Plan handoff

Planning is done by Claude Fable 5.2 at xhigh effort. Execution is a separate step on a different model (`execute-handoff`), so the plan has to stand on its own.

## Who plans

- **You are a Claude Code session on Fable 5.2 at xhigh:** plan inline, in the format below. The conversation context you already hold is worth more than a fresh agent.
- **You are on any other model or effort:** delegate to the `planner` subagent. Its definition pins Fable 5.2 and xhigh.
- **You are Codex or another CLI:** run `claude -p --agent planner "<brief>"` from the repository root and use its output as the plan.

When you delegate, the brief is all the planner knows. Give it the goal in one sentence, what you have already established or ruled out, the files and documents worth reading, the constraints (scope, budget, accepted assets, things not to touch), and where this repository keeps plans.

## Plan format

1. **Outcome**: one sentence stating what will be true when the work is done.
2. **Current state**: verified facts the plan depends on, with file references.
3. **Stages**: the smallest sequence of independently reviewable steps. Each stage names its output, the files or systems it changes and must not touch, its acceptance check, its dependencies, its executor tier (`xhigh` or `max`, with the reason), and any non-code handoff it needs.
4. **Open questions**: only those whose answer changes the plan, each with the assumption used if no answer arrives.
5. **Out of scope**.

The acceptance check is an observation in the form the repository accepts. Read the repository's `AGENTS.md` for that: one project requires native evidence and tests, another forbids automated tests and relies on the owner inspecting the result. The default is no automated tests: plan them only for a repository whose instructions say it is a production app that requires them. Everywhere else the check is running the change once.

## Executor tier

Mark a stage `max` when any of these holds, otherwise `xhigh`:

- it changes persistence, save data, a schema or a migration;
- it changes networking, replication, concurrency, timing or determinism;
- it crosses three or more subsystems, or changes a contract other code relies on;
- it includes an operation that is hard to reverse;
- the specification leaves design judgment to be made during implementation;
- an earlier attempt at the same stage failed.

## Non-code handoffs

Name these in the stage that needs them so the executor does not improvise a provider:

| Need | Route |
| --- | --- |
| Image generation or editing | `image-edit` |
| Video generation or editing | `video-edit` |
| Audio generation | `atlascloud-generation` |
| A 3D model or its textures | `tripo-handoff` (the owner picks manual or API at the handoff) |
| A visual or playable result accepted | the owner |

## After the plan

Keep the plan where the repository says plans live; do not create a new planning document elsewhere. If the user asked only for a plan, present it and stop. If they asked for the work, continue with `execute-handoff` once the open questions that block the first stage are answered.
