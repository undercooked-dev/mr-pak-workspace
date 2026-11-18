// Keep project workspaces inside their own repositories while this repository holds the one
// shared copy of the app, its skills and its report assets.
//   node scripts/workspace.mjs init <dir> --name "Project"   create a content-only workspace
//   node scripts/workspace.mjs slim <dir> [--apply]          strip app code from a vendored full copy
//   node scripts/workspace.mjs sync <dir>                    refresh the links and .gitignore entries
//   node scripts/workspace.mjs trust <dir>                   let the app run the workspace's scripts/prelaunch.mjs
//   node scripts/workspace.mjs untrust <dir>                 stop running it
//   node scripts/workspace.mjs trusted                       list the trusted workspaces
// A workspace holds content: workspace/, projects/, context/, knowledge/, processes/, inbox/,
// its AGENTS.md and any project-only scripts or skills. The app, opened on this repository, finds
// every <project>/mr-mak-workspace beside it and shows those cards together with its own.
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
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
// The app finds <scan root>/<project>/mr-mak-workspace; by default the scan root is this repository's parent.
const MOUNT_FOLDER = 'mr-mak-workspace';
// Workspaces whose scripts/prelaunch.mjs the app may run when it starts: absolute real paths.
const TRUST_FILE = path.join(root, '.mrmak', 'trusted-workspaces.json');

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
}

// A note when the app, which looks for <project>/mr-mak-workspace beside this repository, will not find this workspace.
async function placementNote(directory) {
  const projects = path.dirname(path.dirname(directory)), home = path.dirname(root);
  if (path.basename(directory) === MOUNT_FOLDER && (projects === home || await same(projects, home))) return null;
  return `note: the app shows only <project>/${MOUNT_FOLDER} folders in ${home}, so it will not show this workspace where it is.`;
}

export async function init(directory, { name, log = console.log } = {}) {
  if (!name) throw new Error('init needs --name "Project name".');
  if (await info(path.join(directory, 'workspace', 'workspace.json'))) throw new Error(`${directory} already has a workspace.`);
  const id = slug(name), today = new Date().toISOString().slice(0, 10), folder = `${today}_${id}`;
  const files = {
    'workspace/workspace.json': `${JSON.stringify({ entities: [{ id, title: name, description: `${name} project hub.`, type: 'group', category: 'project', created: today, updated: today, folder, stepGroups: ['Overview'], steps: [{ name: 'Start here', path: 'start-here.md', group: 'Overview' }], status: 'active', pinned: true, defaultStep: 0 }] }, null, 2)}\n`,
    [`workspace/${folder}/start-here.md`]: `# ${name}\n\nThis card is the ${name} hub in Mr. Mak. The repository that contains this folder owns the code, assets, documentation and backlog; link to them from here instead of copying them.\n`,
    'AGENTS.md': `# ${name} workspace\n\nThis folder is the Mr. Mak workspace for ${name}. The repository that contains it is the parent directory (\`..\`); read its \`AGENTS.md\` first and follow it. Keep code, assets and authoritative documents there, and keep Workspace cards and reports here.\n\nThe Mr. Mak app, its shared skills and the work routing are installed once per machine from the shared mr-pak-workspace repository. Do not copy application code or shared skills into this folder. Register deliverables in \`workspace/workspace.json\`.\n\nThe ${name} hub card uses the three-level layout from "Laying out a project card" in the shared repository's \`processes/workspace-authoring.md\`: folders in \`stepGroups\` (it starts with Overview), sections as tabs, and the items of a section in the sidebar.\n\nDo not commit or publish without an explicit request.\n`,
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
  const note = await placementNote(directory);
  if (note) log(note);
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

async function readTrusted() {
  const text = await readFile(TRUST_FILE, 'utf8').catch(error => { if (error.code === 'ENOENT') return '[]'; throw error; });
  let list;
  try { list = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { list = null; }
  if (!Array.isArray(list)) throw new Error(`${TRUST_FILE} is not a JSON list of folders. Fix or delete it, then try again.`);
  return [...new Set(list.filter(item => typeof item === 'string' && item))];
}

async function writeTrusted(list) {
  await mkdir(path.dirname(TRUST_FILE), { recursive: true });
  const temporary = `${TRUST_FILE}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(list, null, 2)}\n`);
  await rename(temporary, TRUST_FILE);
}

// The app runs a workspace's scripts/prelaunch.mjs at start only when its real path is listed here,
// so a folder that merely sits beside this repository cannot run code on this machine.
export async function trust(directory, log = console.log) {
  await requireWorkspace(directory);
  const real = await realpath(directory), list = await readTrusted();
  if (list.includes(real)) log(`${real} is already trusted.`);
  else { await writeTrusted([...list, real]); log(`trusted ${real}`); }
  if (!(await info(path.join(real, 'scripts', 'prelaunch.mjs')))) log('note: it has no scripts/prelaunch.mjs yet, so there is nothing to run.');
  const note = await placementNote(directory);
  if (note) log(note);
  return real;
}

export async function untrust(directory, log = console.log) {
  // The folder may be gone already; its entry still matches the path as given.
  const candidates = new Set([path.resolve(directory), await realpath(directory).catch(() => null)].filter(Boolean));
  const list = await readTrusted(), kept = list.filter(item => !candidates.has(item));
  if (kept.length === list.length) { log(`${path.resolve(directory)} was not trusted.`); return false; }
  await writeTrusted(kept);
  for (const item of list.filter(entry => candidates.has(entry))) log(`no longer trusted: ${item}`);
  return true;
}

export async function trusted(log = console.log) {
  const list = await readTrusted();
  if (!list.length) { log(`No workspace may run scripts/prelaunch.mjs (${TRUST_FILE}).`); return list; }
  log(`Workspaces whose scripts/prelaunch.mjs the app runs at start (${TRUST_FILE}):`);
  for (const item of list) log(`  ${item}${(await info(item))?.isDirectory() ? '' : '  (missing: the folder no longer exists)'}`);
  return list;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && await same(process.argv[1], self)) {
  const [command, target, ...rest] = process.argv.slice(2);
  const option = flag => { const index = rest.indexOf(flag); return index >= 0 ? rest[index + 1] : undefined; };
  try {
    if (command === 'trusted') await trusted();
    else {
      if (!['init', 'slim', 'sync', 'trust', 'untrust'].includes(command) || !target) throw new Error('Usage: node scripts/workspace.mjs <init|slim|sync|trust|untrust> <workspace dir> [--name "Project"] [--apply]\n       node scripts/workspace.mjs trusted');
      const directory = path.resolve(target);
      if (command === 'init') await init(directory, { name: option('--name') });
      else if (command === 'slim') await slim(directory, { apply: rest.includes('--apply') });
      else if (command === 'trust') await trust(directory);
      else if (command === 'untrust') await untrust(directory);
      else await sync(directory);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
