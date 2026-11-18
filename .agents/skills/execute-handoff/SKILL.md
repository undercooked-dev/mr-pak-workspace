---
name: execute-handoff
description: Route the execution of an agreed plan to Claude Opus 5.5 - xhigh effort for ordinary stages, max for high-complexity ones. Use when a plan is ready to implement, when handing a stage to another agent, or when deciding which model and effort should do a piece of implementation work.
---

# Execute handoff

Plans are executed by Claude Opus 5.5. The plan's tier for each stage picks the effort.

| Stage tier | Agent | Model and effort |
| --- | --- | --- |
| `xhigh` | `executor` | Opus 5.5, xhigh |
| `max` | `executor-max` | Opus 5.5, max |

A stage is `max` when it changes persistence or a schema, changes networking, concurrency, timing or determinism, crosses three or more subsystems or a relied-on contract, includes a hard-to-reverse operation, leaves design judgment open, or is a retry after a failed attempt. If the plan has no tier for a stage, apply that rule yourself and say which you chose. Pick the agent; do not override an agent's effort per call.

From Codex or another CLI, run `claude -p --agent executor "<brief>"` (or `executor-max`) from the repository root.

## The brief

One stage per handoff. The executor starts with nothing but the brief, so include:

- the stage's output and its acceptance check, copied from the plan;
- the files to change, the files it must not touch, and who owns any shared file;
- what is already implemented and what earlier stages changed;
- the constraints that apply: accepted assets, budgets, tools the repository requires or forbids;
- whether the owner has asked for a commit. Without that, the executor does not commit.

For a larger handoff, a continuation, or anything involving assets, follow `feature-handoff` for what a complete brief contains.

## Order

Run stages in the plan's order. Run two at once only when they change disjoint files and neither depends on the other; otherwise their edits collide.

## After each stage

Read the report against the acceptance check before moving on. "Not done" and failed checks are part of the result; carry them forward, do not smooth them over.

- If the executor stopped and reported that the stage needs `max`, re-run it on `executor-max` with the executor's findings added to the brief.
- For a `max` stage, or any stage that changed a contract other code relies on, have `reviewer` check the result before you report it. Give the reviewer the plan stage and the changed files, not your conclusion.
- If a stage fails twice, stop executing and go back to `plan-handoff` with what was learned.

When you report to the user, keep three things apart: what was implemented, what an agent verified, and what the owner still has to accept.
