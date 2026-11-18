// Keep project workspaces inside their own repositories while this repository holds the one
// shared copy of the app, its skills and its report assets.
//   node scripts/workspace.mjs init <dir> --name "Project"   create a content-only workspace
//   node scripts/workspace.mjs slim <dir> [--apply]          strip app code from a vendored full copy
//   node scripts/workspace.mjs sync <dir>                    refresh shared assets, links and launchers
// A workspace holds content: workspace/, projects/, context/, knowledge/, processes/, inbox/,
// its AGENTS.md and any project-only scripts or skills. The app opens it with --repo <dir>.
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
// Application code and tooling that now live only in this repository.
const APP_PATHS = ['src', 'src-tauri', 'public', 'dist', 'node_modules', 'desktop', 'docs', '.github', 'index.html', 'vite.config.ts',
  'tsconfig.json', 'tsconfig.tsbuildinfo', 'eslint.config.js', 'package-lock.json', 'Setup.ps1', 'setup.sh', 'Start Mr. Mak.cmd',
  'Start Mr. Mak.command', 'CHANGELOG.md', 'SECURITY.md', '.env.example'];
// Ignored links back to this repository, so project scripts and document links keep resolving.
const LINKS = ['desktop', 'docs', 'node_modules'];
const IGNORE_HEADER = '# Links to the shared Mr. Mak repository; recreated by its scripts/workspace.mjs sync.';

const info = file => lstat(file).catch(() => null);
const list = async (directory, test = () => true) => (await readdir(directory, { withFileTypes: true }).catch(() => [])).filter(test).map(entry => entry.name).sort();
const same = async (a, b) => { try { return await realpath(a) === await realpath(b); } catch { return false; } };
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function requireWorkspace(directory) {
  if (await same(directory, root)) throw new Error('That is the shared Mr. Mak repository, not a project workspace.');
  if (!(await info(path.join(directory, 'workspace', 'workspace.json')))) throw new Error(`${directory} has no workspace/workspace.json.`);
}

export async function sync(directory, log = console.log) {
  await requireWorkspace(directory);
  const shared = path.join(directory, 'workspace', '_shared');
  await mkdir(shared, { recursive: true });
  for (const name of await list(path.join(root, 'workspace', '_shared'), entry => entry.isFile())) {
    const from = path.join(root, 'workspace', '_shared', name), to = path.join(shared, name);
    const [a, b] = await Promise.all([readFile(from), readFile(to).catch(() => null)]);
    if (!b || !a.equals(b)) { await copyFile(from, to); log(`updated workspace/_shared/${name}`); }
  }
  for (const name of LINKS) {
    const target = path.join(root, name), link = path.join(directory, name), existing = await info(link);
    if (!(await info(target))) continue; // node_modules is absent until npm ci has run here.
    if (existing && await same(link, target)) continue;
    if (existing && !existing.isSymbolicLink()) { log(`left ${name}/ alone: it is a real folder, not a link (run slim first)`); continue; }
    if (existing) await rm(link, { force: true });
    await symlink(target, link, windows ? 'junction' : 'dir');
    log(`linked ${name} -> ${target}`);
  }
  const ignoreFile = path.join(directory, '.gitignore');
  const ignore = await readFile(ignoreFile, 'utf8').catch(() => '');
  const lines = new Set(ignore.split(/\r?\n/).map(line => line.trim()));
  // No trailing slash: a link to a directory is a file to Git, and "name/" would not match it.
  const missing = ['.mrmak/', '.env', '.env.*', '.cache/', ...LINKS.map(name => `/${name}`)].filter(entry => !lines.has(entry));
  if (missing.length) { await writeFile(ignoreFile, `${ignore.trimEnd()}${ignore.trim() ? '\n\n' : ''}${IGNORE_HEADER}\n${missing.join('\n')}\n`); log(`added ${missing.join(', ')} to .gitignore`); }
  await launchers(directory, log);
}

async function launchers(directory, log) {
  const parent = path.dirname(directory), folder = path.basename(directory);
  const command = `#!/usr/bin/env bash
# Opens this repository's workspace in the shared Mr. Mak app. The app shows one workspace at a time.
here="$(cd "$(dirname "$0")" && pwd)"
workspace="$here/${folder}"
state="$HOME/Library/Application Support/com.mrmak.workspace/repository.json"
if pgrep -x mrmak-workspace >/dev/null 2>&1 && [ -f "$state" ] && ! grep -qF "\\"$workspace\\"" "$state"; then
  echo "Mr. Mak is open on another workspace: $(cat "$state")"
  echo "Quit it first (this stops its running chats), then run this again."
  read -r -p "Press Return to close." _; exit 1
fi
# A workspace may rebuild pages it derives from its repository before the app reads them.
if [ -f "$workspace/scripts/prelaunch.mjs" ] && command -v node >/dev/null 2>&1; then
  node "$workspace/scripts/prelaunch.mjs" || echo "The workspace's prelaunch step failed; opening it as it is."
fi
for app in "/Applications/Mr. Mak Workspace.app" "$HOME/Applications/Mr. Mak Workspace.app"; do
  if [ -d "$app" ]; then open -a "$app" --args --repo "$workspace"; exit 0; fi
done
echo "Mr. Mak Workspace is not installed. Build it in the shared mr-pak-workspace repository: ./setup.sh desktop"
read -r -p "Press Return to close." _
`;
  const cmd = `@echo off\r\nsetlocal\r\nrem Opens this repository's workspace in the shared Mr. Mak app. The app shows one workspace at a time.\r\nset "WORKSPACE=%~dp0${folder}"\r\nif not exist "%WORKSPACE%\\workspace\\workspace.json" (\r\n  echo Workspace files are missing: %WORKSPACE%\r\n  exit /b 1\r\n)\r\nif exist "%WORKSPACE%\\scripts\\prelaunch.mjs" node "%WORKSPACE%\\scripts\\prelaunch.mjs"\r\nif exist "%LOCALAPPDATA%\\Mr. Mak Workspace\\mrmak-workspace.exe" (\r\n  start "" "%LOCALAPPDATA%\\Mr. Mak Workspace\\mrmak-workspace.exe" --repo "%WORKSPACE%"\r\n  exit /b 0\r\n)\r\necho Mr. Mak Workspace is not installed. Install it from the shared mr-pak-workspace repository.\r\npause\r\n`;
  for (const [name, text, mode] of [['Start Workspace.command', command, 0o755], ['Start Workspace.cmd', cmd, 0o644]]) {
    const file = path.join(parent, name);
    if (await readFile(file, 'utf8').catch(() => null) === text) continue;
    await writeFile(file, text, { mode });
    log(`wrote ${path.join(path.basename(parent), name)}`);
  }
}

export async function init(directory, { name, log = console.log } = {}) {
  if (!name) throw new Error('init needs --name "Project name".');
  if (await info(path.join(directory, 'workspace', 'workspace.json'))) throw new Error(`${directory} already has a workspace.`);
  const id = slug(name), today = new Date().toISOString().slice(0, 10), folder = `${today}_${id}`;
  const files = {
    'workspace/workspace.json': `${JSON.stringify({ entities: [{ id, title: name, description: `${name} project hub.`, type: 'group', category: 'project', created: today, updated: today, folder, steps: [{ name: 'Start here', path: 'start-here.md' }], status: 'active', pinned: true, defaultStep: 0 }] }, null, 2)}\n`,
    [`workspace/${folder}/start-here.md`]: `# ${name}\n\nThis card is the ${name} hub in Mr. Mak. The repository that contains this folder owns the code, assets, documentation and backlog; link to them from here instead of copying them.\n`,
    'AGENTS.md': `# ${name} workspace\n\nThis folder is the Mr. Mak workspace for ${name}. The repository that contains it is the parent directory (\`..\`); read its \`AGENTS.md\` first and follow it. Keep code, assets and authoritative documents there, and keep Workspace cards and reports here.\n\nThe Mr. Mak app, its shared skills and the work routing are installed once per machine from the shared mr-pak-workspace repository. Do not copy application code or shared skills into this folder. Register deliverables in \`workspace/workspace.json\`.\n\nDo not commit or publish without an explicit request.\n`,
    'CLAUDE.md': '@AGENTS.md\n',
    'inbox/.gitkeep': '',
    '.gitignore': `# Credentials and local state\n.env\n.env.*\n.mrmak/\n.cache/\n\n# Local inputs\ninbox/*\n!inbox/.gitkeep\n**/job.json\n**/result.json\n**/upload.json\n\n.DS_Store\n`,
  };
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(directory, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  log(`created ${Object.keys(files).length} files in ${directory}`);
  await sync(directory, log);
}

export async function slim(directory, { apply = false, log = console.log } = {}) {
  await requireWorkspace(directory);
  if (await info(path.join(directory, '.git'))) throw new Error(`${directory} is its own Git repository. slim is for a copy vendored inside a project repository.`);
  const remove = [], keep = [];
  for (const name of APP_PATHS) {
    const existing = await info(path.join(directory, name));
    if (existing && !existing.isSymbolicLink()) remove.push(name);
  }
  const sharedSkills = new Set(await list(path.join(root, '.agents', 'skills'), entry => entry.isDirectory()));
  for (const home of ['.agents/skills', '.claude/skills']) {
    for (const name of await list(path.join(directory, home), entry => entry.isDirectory())) (sharedSkills.has(name) ? remove : keep).push(`${home}/${name}`);
  }
  const sharedScripts = new Set(await list(path.join(root, 'scripts')));
  for (const name of await list(path.join(directory, 'scripts'))) (sharedScripts.has(name) ? remove : keep).push(`scripts/${name}`);

  // Keep only the npm scripts that are the project's own; dependencies come through the links.
  const packageFile = path.join(directory, 'package.json');
  const manifest = JSON.parse(await readFile(packageFile, 'utf8').catch(() => 'null'));
  const shared = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).scripts;
  const own = manifest ? Object.fromEntries(Object.entries(manifest.scripts ?? {}).filter(([name]) => !(name in shared))) : {};

  log(`${apply ? 'Removing' : 'Would remove'} ${remove.length} shared app entries from ${directory}:`);
  for (const name of remove) log(`  - ${name}`);
  log(`Keeping project-only entries: ${keep.join(', ') || 'none'}`);
  if (manifest) log(`package.json: ${Object.keys(own).length ? `reduced to the project's own scripts (${Object.keys(own).join(', ')})` : 'removed, it has no project scripts'}`);
  if (!apply) { log('Nothing changed. Re-run with --apply.'); return { remove, keep }; }

  for (const name of remove) await rm(path.join(directory, name), { recursive: true, force: true });
  for (const home of ['.agents/skills', '.agents', '.claude/skills', '.claude', 'scripts']) {
    if (!(await list(path.join(directory, home))).length) await rm(path.join(directory, home), { recursive: true, force: true });
  }
  if (manifest) {
    if (Object.keys(own).length) await writeFile(packageFile, `${JSON.stringify({ name: manifest.name, private: true, type: manifest.type ?? 'module', scripts: own }, null, 2)}\n`);
    else await rm(packageFile);
  }
  await sync(directory, log);
  return { remove, keep };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && await same(process.argv[1], self)) {
  const [command, target, ...rest] = process.argv.slice(2);
  const option = flag => { const index = rest.indexOf(flag); return index >= 0 ? rest[index + 1] : undefined; };
  try {
    if (!['init', 'slim', 'sync'].includes(command) || !target) throw new Error('Usage: node scripts/workspace.mjs <init|slim|sync> <workspace dir> [--name "Project"] [--apply]');
    const directory = path.resolve(target);
    if (command === 'init') await init(directory, { name: option('--name') });
    else if (command === 'slim') await slim(directory, { apply: rest.includes('--apply') });
    else await sync(directory);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
