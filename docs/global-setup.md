# One shared Mr. Mak, workspaces in each project

This repository is the single copy of the Mr. Mak app, its skills, its agent definitions and its report assets for a machine. Each project keeps only its own workspace content, inside that project's repository.

## What lives where

| Thing | Location |
| --- | --- |
| App source, shared skills, agents, report assets | this repository |
| Installed app | `/Applications/Mr. Mak Workspace.app` (Windows: `%LOCALAPPDATA%\Mr. Mak Workspace`) |
| Skills, for every project | `~/.claude/skills/` and `~/.agents/skills/`, linked to `.agents/skills/` here |
| Agents, for every project | `~/.claude/agents/`, copied from `agents/` here |
| Work routing | a managed block in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, from `global/routing.md` |
| A project's cards, reports, context, project-only scripts and skills | `<project repo>/mr-mak-workspace/` |
| Keys, chat state, job receipts | ignored files in each workspace (`.env.*`, `.mrmak/`) |

## Set up a machine

```bash
npm ci                      # dependencies, also used by project scripts through a link
npm run global:install      # skills, agents and routing for every project
./setup.sh desktop          # build the app (needs Rust); then install it over the existing one
```

`npm run global:check` reports drift. `node scripts/install-global.mjs --uninstall` removes everything the installer created. Skills are links, so an edit here applies immediately; re-run the install after changing an agent file or `global/routing.md`. Entries the installer did not create are left alone.

## Work routing

`global/routing.md` is the table every agent sees. The routes are implemented by:

| Route | Skill | Agent |
| --- | --- | --- |
| Planning on Claude Fable 5.2, xhigh | `plan-handoff` | `planner` |
| Execution on Claude Opus 5.5, xhigh or max | `execute-handoff` | `executor`, `executor-max` |
| Independent check of finished work | | `reviewer` |
| Images: Codex built-in generation, then AtlasCloud once Codex credits are exhausted | `image-edit` | `media-runner` |
| Video: AtlasCloud | `video-edit` | `media-runner` |
| 3D models: Tripo, by hand in Tripo Studio or through the API, as the user picks at each handoff | `tripo-handoff` | `media-runner` (API path) |

Model and effort are pinned in each agent file's frontmatter. Change them there when a newer model replaces one.

## Project workspaces

A workspace is a folder holding `workspace/workspace.json`. The app opens it with `--repo <folder>`.

```bash
npm run workspace -- init  ../SomeGame/mr-mak-workspace --name "Some Game"   # new, content only
npm run workspace -- slim  ../SomeGame/mr-mak-workspace                      # preview stripping a vendored full copy
npm run workspace -- slim  ../SomeGame/mr-mak-workspace --apply
npm run workspace -- sync  ../SomeGame/mr-mak-workspace                      # after cloning, or after updating this repository
```

`slim` removes the app source, tooling and the skills that exist here, and keeps cards, context, knowledge, project-only scripts and skills, keys and local state. `sync` refreshes `workspace/_shared`, writes `Start Workspace.command` and `.cmd` beside the workspace, and creates three ignored links (`desktop`, `docs`, `node_modules`) back to this repository so project scripts and document links keep resolving.

A workspace can rebuild pages it derives from its repository each time it is opened: if it has `scripts/prelaunch.mjs`, the launcher runs it with Node before starting the app. Use this to mirror the project's own documents into a card instead of keeping a second tracked copy.

The app is single-instance: it shows one workspace at a time. To switch projects, quit Mr. Mak and start the other project's launcher. Quitting stops that workspace's running chats, so the launcher never does it for you.

## Updating from upstream

`upstream` is the original project. Merge it into `main` here, run `npm test` and `npm run test:global`, rebuild the app, then `npm run workspace -- sync` each project workspace.
