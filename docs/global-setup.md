# One shared Mr. Mak, workspaces in each project

This repository is the single copy of the Mr. Mak app, its skills, its agent definitions, the work routing and the report assets for a machine. It is also the app's home: the app opens on it and shows, in one window, its own cards together with the cards of every project beside it. Each project keeps only its own workspace content, inside that project's repository.

## What lives where

| Thing | Location |
| --- | --- |
| App source, shared skills, agents, routing table | this repository |
| Shared report assets (`report.css`, `report.js` and the rest of `workspace/_shared/`) | this repository only; every project's reports get them from here |
| Installed app | macOS: `/Applications/Mr. Mak Workspace.app`. Windows: `%LOCALAPPDATA%\Mr. Mak Workspace` |
| Which repository the app opens | `repository.json` in the app's config folder (macOS: `~/Library/Application Support/com.mrmak.workspace/`, Windows: `%APPDATA%\com.mrmak.workspace\`) |
| Skills, for every project | `~/.claude/skills/` and `~/.agents/skills/`, linked to `.agents/skills/` here |
| Agents, for every project | `~/.claude/agents/`, copied from `agents/` here |
| Work routing | a managed block in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, from `global/routing.md` |
| A project's cards, reports, context, project-only scripts and skills | `<project repo>/mr-mak-workspace/` |
| App settings, chats and the prelaunch trust list | `.mrmak/` in this repository (ignored by Git) |
| Keys | ignored `.env` files; the app reads this repository's `.env` |

Keep this repository and the project repositories side by side in one folder, for example:

```text
Projects/
  mr-pak-workspace/            this repository, the app's home
  SomeGame/                    a project repository
    mr-mak-workspace/          its workspace: workspace/workspace.json, cards, context
  OtherProject/
    mr-mak-workspace/
```

## Set up a machine

Install the prerequisites from [Build from source](getting-started.md#build-from-source): Node.js 22.20 or newer and Rust, plus the Xcode Command Line Tools on macOS, or Microsoft C++ Build Tools and WebView2 on Windows. Then, in this repository:

```bash
npm ci                    # dependencies, also used by project scripts through a link
npm run global:install    # skills, agents and routing for every project
```

Build and install the app:

- **macOS**: run `./setup.sh desktop`, then copy the build into Applications:
  `ditto "src-tauri/target/release/bundle/macos/Mr. Mak Workspace.app" "/Applications/Mr. Mak Workspace.app"`.
- **Windows**: run `powershell -ExecutionPolicy Bypass -File .\Setup.ps1 -Mode Desktop`, then run the installer it leaves in `src-tauri\target\release\bundle\nsis`.

Open the app once with this repository's own launcher: **Start Mr. Mak.command** on macOS, **Start Mr. Mak.cmd** on Windows. It starts the app with `--repo` pointing here, and the app remembers this repository as its home; after that the app opens here however it is started.

`npm run global:check` reports drift. `node scripts/install-global.mjs --uninstall` removes everything the installer created. Skills are links, so an edit here applies immediately; re-run the install after changing an agent file or `global/routing.md`. Entries the installer did not create are left alone.

Then clone the project repositories beside this one and run `npm run workspace -- sync ../<Project>/mr-mak-workspace` for each, to recreate the ignored links described below. Trust any whose prelaunch script should run (see below); trust is per machine.

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

## How the app finds projects

When it starts, and again whenever the card list is read, the app scans the folder that contains its home (`Projects/` above) for `<project>/mr-mak-workspace/workspace/workspace.json`. Every project it finds joins the Workspace: its cards appear beside this repository's own, labelled with the project's folder name, and a project filter appears once two or more projects have cards. The filter is remembered across restarts. Each card is read from and saved to its own project's `mr-mak-workspace/`; a new card is created in the project chosen in the **New card** dialog. A project cloned while the app is open appears without a restart.

Card ids and card folder names must be unique across this repository and all projects. A card that repeats one is skipped, and the home page says which and why. Once a project's cards are shown, this repository's starter sample cards are hidden (`MRMAK_SHOW_SAMPLES=1` keeps them).

## Give a project a workspace

Run these from this repository:

```bash
npm run workspace -- init  ../SomeGame/mr-mak-workspace --name "Some Game"   # new, content only
npm run workspace -- slim  ../SomeGame/mr-mak-workspace                      # preview stripping a folder that still holds a copy of the app
npm run workspace -- slim  ../SomeGame/mr-mak-workspace --apply
npm run workspace -- sync  ../SomeGame/mr-mak-workspace                      # after cloning, or after updating this repository
```

`init` creates `workspace/workspace.json` with a pinned hub card laid out as described under "Laying out a project card" in [the workspace workflow](../processes/workspace-authoring.md), starting with an Overview folder, plus the workspace's `AGENTS.md`, `CLAUDE.md`, `inbox/` and `.gitignore`. `slim` removes the app source, tooling and the skills and scripts that exist here, and keeps cards, context, knowledge, project-only scripts and skills, keys and local state. `init`, `slim --apply` and `sync` all create three ignored links (`desktop`, `docs`, `node_modules`) back to this repository, so project scripts and document links keep resolving, and add them to the workspace's `.gitignore`.

A workspace needs no copy of `workspace/_shared` and no launcher of its own. Workspaces prepared by an earlier version may still have a `workspace/_shared` copy and `Start Workspace.command` / `Start Workspace.cmd` beside them; nothing uses them now, and starting such a launcher would make that workspace the app's home, so delete them from that project's repository.

## Prelaunch scripts and trust

A workspace can rebuild pages it derives from its repository each time the app starts, instead of keeping a second tracked copy of the project's documents: put the script in `<workspace>/scripts/prelaunch.mjs`. The app runs it with Node once per start, in the workspace folder, while the window opens. Scripts of different projects run side by side, and one that runs longer than two minutes is stopped. The cards refresh when a script succeeds; a failure is written to the app's `service.log` and leaves the cards as they were.

The app runs a prelaunch script only for workspaces on this machine's trust list, `.mrmak/trusted-workspaces.json` in this repository (a JSON list of the workspaces' real paths). Without it, any folder placed beside this repository could run code on this machine the next time the app starts.

```bash
npm run workspace -- trust    ../SomeGame/mr-mak-workspace   # allow its scripts/prelaunch.mjs
npm run workspace -- untrust  ../SomeGame/mr-mak-workspace   # stop running it
npm run workspace -- trusted                                 # list trusted workspaces; missing folders are marked
```

`trust` refuses a folder without `workspace/workspace.json`. A change takes effect the next time the app starts.

## Checks

This repository is tooling, not a production app, and has no automated tests. Check a change by running `npm run build` and `npm run lint` and then running the changed part once. `desktop/service/test/browser.mjs` only launches a headless browser for looking at the UI.

## Updating from upstream

`upstream` is the original project. Merge `upstream/main` into `main` here. Upstream still carries the test suite this repository deleted; keep those files deleted when resolving the merge. Then run `npm ci`, `npm run build` and `npm run lint`, re-run `npm run global:install`, rebuild and reinstall the app as in [updating](updating.md), and run `npm run workspace -- sync` for each project workspace.
