// Install this repository's skills, agents and work routing for every project on this machine.
//   node scripts/install-global.mjs            install or update
//   node scripts/install-global.mjs --check    report differences, change nothing
//   node scripts/install-global.mjs --dry-run  list what an install would do
//   node scripts/install-global.mjs --uninstall
// Skills are linked (junction on Windows), so edits here apply at once. Agent files and the
// routing block are copied; re-run after changing them. Entries this script did not create
// are left alone unless --force is given.
import { copyFile, lstat, mkdir, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Set(process.argv.slice(2));
const unknown = [...flags].filter(flag => !['--check', '--dry-run', '--uninstall', '--force'].includes(flag));
if (unknown.length) { console.error(`Unknown option ${unknown.join(', ')}`); process.exit(2); }
const check = flags.has('--check'), dryRun = flags.has('--dry-run'), uninstall = flags.has('--uninstall'), force = flags.has('--force');
const readOnly = check || dryRun;
const home = process.env.MRPAK_HOME || os.homedir();
const windows = process.platform === 'win32';
const START = '<!-- mr-pak:routing:start (managed by mr-pak-workspace/scripts/install-global.mjs) -->';
const END = '<!-- mr-pak:routing:end -->';

const skillSource = path.join(root, '.agents', 'skills');
const agentSource = path.join(root, 'agents');
const skillTargets = [path.join(home, '.claude', 'skills'), path.join(home, '.agents', 'skills')];
const agentTarget = path.join(home, '.claude', 'agents');
const routingTargets = [path.join(home, '.claude', 'CLAUDE.md'), path.join(home, '.codex', 'AGENTS.md')];
const manifestFile = path.join(home, '.claude', 'mr-pak-global.json');

const report = { done: [], pending: [], skipped: [] };
const act = async (label, work) => { if (readOnly) report.pending.push(label); else { await work(); report.done.push(label); } };
const names = async (directory, test) => (await readdir(directory, { withFileTypes: true }).catch(() => [])).filter(test).map(entry => entry.name).sort();
const info = file => lstat(file).catch(() => null);
const same = async (a, b) => { try { return await realpath(a) === await realpath(b); } catch { return false; } };

async function linkSkill(name, directory) {
  const source = path.join(skillSource, name), target = path.join(directory, name), existing = await info(target);
  if (existing?.isSymbolicLink() || (existing && await same(target, source))) {
    if (await same(target, source)) return;
    // A link we manage that points elsewhere (moved clone) is replaced; anything else is foreign.
    const destination = await readlink(target).catch(() => '');
    if (!force && !/mr-(?:pak|mak)-workspace/.test(destination)) return report.skipped.push(`${target} links to ${destination}; left alone`);
    return act(`relink ${target}`, async () => { await rm(target, { recursive: true, force: true }); await symlink(source, target, windows ? 'junction' : 'dir'); });
  }
  if (existing && !force) return report.skipped.push(`${target} exists and is not managed here; left alone (--force replaces it)`);
  return act(`link ${target}`, async () => {
    await mkdir(directory, { recursive: true });
    if (existing) await rm(target, { recursive: true, force: true });
    await symlink(source, target, windows ? 'junction' : 'dir');
  });
}

async function copyAgent(name, managed) {
  const source = path.join(agentSource, name), target = path.join(agentTarget, name);
  const [a, b] = await Promise.all([readFile(source), readFile(target).catch(() => null)]);
  if (b && a.equals(b)) return;
  if (b && !managed.agents?.includes(name) && !force) return report.skipped.push(`${target} exists and is not managed here; left alone (--force replaces it)`);
  return act(`${b ? 'update' : 'copy'} ${target}`, async () => { await mkdir(agentTarget, { recursive: true }); await copyFile(source, target); });
}

async function writeRouting(target, block) {
  const current = await readFile(target, 'utf8').catch(() => null);
  if (current === null && !(await info(path.dirname(target)))) return report.skipped.push(`${path.dirname(target)} does not exist; routing not added there`);
  const body = current ?? '';
  const start = body.indexOf(START), end = body.indexOf(END);
  const next = start >= 0 && end > start
    ? body.slice(0, start) + block + body.slice(end + END.length)
    : `${body.trimEnd()}${body.trim() ? '\n\n' : ''}${block}\n`;
  if (next === body) return;
  return act(`${current === null ? 'create' : 'update routing in'} ${target}`, () => writeFile(target, next));
}

async function removeRouting(target) {
  const body = await readFile(target, 'utf8').catch(() => null);
  if (body === null) return;
  const start = body.indexOf(START), end = body.indexOf(END);
  if (start < 0 || end < start) return;
  const next = `${(body.slice(0, start) + body.slice(end + END.length)).trimEnd()}\n`;
  return act(`remove routing from ${target}`, () => next.trim() ? writeFile(target, next) : rm(target));
}

const managed = JSON.parse(await readFile(manifestFile, 'utf8').catch(() => '{}'));
const skills = await names(skillSource, entry => entry.isDirectory() && !entry.name.startsWith('.'));
const agents = await names(agentSource, entry => entry.isFile() && entry.name.endsWith('.md'));

if (uninstall) {
  for (const directory of skillTargets) for (const name of managed.skills ?? []) {
    const target = path.join(directory, name);
    if ((await info(target))?.isSymbolicLink()) await act(`unlink ${target}`, () => rm(target, { recursive: true, force: true }));
  }
  for (const name of managed.agents ?? []) if (await info(path.join(agentTarget, name))) await act(`remove ${path.join(agentTarget, name)}`, () => rm(path.join(agentTarget, name)));
  for (const target of routingTargets) await removeRouting(target);
  if (await info(manifestFile)) await act(`remove ${manifestFile}`, () => rm(manifestFile));
} else {
  for (const directory of skillTargets) for (const name of skills) await linkSkill(name, directory);
  // Skills removed from this repository leave dangling links behind; clear the ones we created.
  for (const directory of skillTargets) for (const name of (managed.skills ?? []).filter(name => !skills.includes(name))) {
    const target = path.join(directory, name);
    if ((await info(target))?.isSymbolicLink()) await act(`unlink retired ${target}`, () => rm(target, { recursive: true, force: true }));
  }
  for (const name of agents) await copyAgent(name, managed);
  for (const name of (managed.agents ?? []).filter(name => !agents.includes(name))) {
    if (await info(path.join(agentTarget, name))) await act(`remove retired ${path.join(agentTarget, name)}`, () => rm(path.join(agentTarget, name)));
  }
  const block = `${START}\n${(await readFile(path.join(root, 'global', 'routing.md'), 'utf8')).trim()}\n${END}`;
  for (const target of routingTargets) await writeRouting(target, block);
  const manifest = `${JSON.stringify({ source: root, skills, agents }, null, 2)}\n`;
  if (manifest !== await readFile(manifestFile, 'utf8').catch(() => '')) await act(`write ${manifestFile}`, () => writeFile(manifestFile, manifest));
}

for (const line of report.skipped) console.warn(`skipped: ${line}`);
for (const line of readOnly ? report.pending : report.done) console.log(`${readOnly ? 'would ' : ''}${line}`);
if (check && report.pending.length) {
  console.error(`Global install differs in ${report.pending.length} place(s). Run npm run global:install.`);
  process.exitCode = 1;
} else if (!report.pending.length && !report.done.length) console.log(`Global install is current: ${skills.length} skills, ${agents.length} agents, routing in ${routingTargets.length} files.`);
else if (!readOnly) console.log(`${uninstall ? 'Removed' : 'Installed'}: ${report.done.length} change(s). Source: ${root}`);
