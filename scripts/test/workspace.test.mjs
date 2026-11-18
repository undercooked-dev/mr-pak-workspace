// Run: node --test scripts/test/workspace.test.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { init, slim, sync } from '../workspace.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const quiet = () => {};
const write = async (file, text = 'x') => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); };

async function vendoredCopy() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mak-project-')), dir = path.join(repo, 'mr-mak-workspace');
  await write(path.join(dir, 'workspace/workspace.json'), '{"entities":[]}');
  await write(path.join(dir, 'workspace/2026-01-01_game/report.md'), '# Report');
  await write(path.join(dir, 'workspace/_shared/report.js'), 'stale');
  await write(path.join(dir, 'src/App.tsx'));
  await write(path.join(dir, 'desktop/service/main.mjs'));
  await write(path.join(dir, 'docs/getting-started.md'));
  await write(path.join(dir, 'node_modules/react/index.js'));
  await write(path.join(dir, '.agents/skills/plan/SKILL.md'));
  await write(path.join(dir, '.agents/skills/game-only/SKILL.md'));
  await write(path.join(dir, '.claude/skills/plan/SKILL.md'));
  await write(path.join(dir, 'scripts/sync-skills.mjs'));
  await write(path.join(dir, 'scripts/game/build.mjs'));
  await write(path.join(dir, '.env.atlascloud'), 'ATLASCLOUD_API_KEY=secret');
  await write(path.join(dir, '.gitignore'), '.env\n.env.*\n.mrmak/\nnode_modules/\n');
  await write(path.join(dir, 'package.json'), JSON.stringify({ name: 'mr-mak-workspace', type: 'module', scripts: { dev: 'vite', 'game:edit': 'node scripts/game/build.mjs' }, dependencies: { react: '1' } }));
  return { repo, dir };
}

test('slim reports first, then removes shared app code and keeps project content', async () => {
  const { repo, dir } = await vendoredCopy();
  const plan = await slim(dir, { log: quiet });
  assert.ok(existsSync(path.join(dir, 'src/App.tsx')), 'a dry run changes nothing');
  assert.deepEqual(plan.keep, ['.agents/skills/game-only', 'scripts/game']);

  await slim(dir, { apply: true, log: quiet });
  for (const gone of ['src', '.agents/skills/plan', '.claude', 'scripts/sync-skills.mjs']) assert.ok(!existsSync(path.join(dir, gone)), `${gone} removed`);
  for (const kept of ['workspace/2026-01-01_game/report.md', '.agents/skills/game-only/SKILL.md', 'scripts/game/build.mjs', '.env.atlascloud']) assert.ok(existsSync(path.join(dir, kept)), `${kept} kept`);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')).scripts, { 'game:edit': 'node scripts/game/build.mjs' });

  // Shared code is reachable again through ignored links, and report assets are current.
  assert.ok((await lstat(path.join(dir, 'desktop'))).isSymbolicLink());
  assert.equal(await realpath(path.join(dir, 'desktop')), await realpath(path.join(root, 'desktop')));
  assert.equal(await readFile(path.join(dir, 'workspace/_shared/report.js'), 'utf8'), await readFile(path.join(root, 'workspace/_shared/report.js'), 'utf8'));
  const ignore = await readFile(path.join(dir, '.gitignore'), 'utf8');
  for (const entry of ['/desktop', '/docs', '/node_modules', '.cache/']) assert.ok(ignore.split('\n').includes(entry), `${entry} ignored`);
  assert.match(await readFile(path.join(repo, 'Start Workspace.command'), 'utf8'), /--repo "\$workspace"/);

  const before = await readFile(path.join(dir, '.gitignore'), 'utf8');
  await sync(dir, quiet);
  assert.equal(await readFile(path.join(dir, '.gitignore'), 'utf8'), before, 'sync is repeatable');
});

test('init creates a content-only workspace the app accepts', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mak-project-')), dir = path.join(repo, 'mr-mak-workspace');
  await init(dir, { name: 'Gym Buddy', log: quiet });
  const { entities } = JSON.parse(await readFile(path.join(dir, 'workspace/workspace.json'), 'utf8'));
  assert.equal(entities[0].id, 'gym-buddy');
  assert.ok(existsSync(path.join(dir, 'workspace', entities[0].folder, entities[0].steps[0].path)));
  assert.ok(existsSync(path.join(dir, 'workspace/_shared/report.css')));
  assert.ok(!existsSync(path.join(dir, 'src')) && !existsSync(path.join(dir, '.agents')));
  await assert.rejects(init(dir, { name: 'Gym Buddy', log: quiet }), /already has a workspace/);
});

test('refuses the shared repository and standalone clones', async () => {
  await assert.rejects(slim(root, { log: quiet }), /shared Mr\. Mak repository/);
  const { dir } = await vendoredCopy();
  await mkdir(path.join(dir, '.git'));
  await assert.rejects(slim(dir, { apply: true, log: quiet }), /its own Git repository/);
});
