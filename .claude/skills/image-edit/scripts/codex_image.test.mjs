// Run: node --test .agents/skills/image-edit/scripts/codex_image.test.mjs
// Uses a stand-in for the Codex CLI, so no account, credits or network are involved.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify, instruction } from './codex_image.mjs';

const script = fileURLToPath(new URL('./codex_image.mjs', import.meta.url));
const posix = process.platform !== 'win32';

test('only real exhaustion selects the paid fallback', () => {
  assert.equal(classify("You've hit your usage limit. Try again at 4pm.", 1), 'exhausted');
  assert.equal(classify('error: insufficient_quota', 1), 'exhausted');
  assert.equal(classify('You are out of credits', 1), 'exhausted');
  assert.equal(classify('429 Too Many Requests', 1), 'transient');
  assert.equal(classify('stream disconnected before completion', 1), 'transient');
  assert.equal(classify('Please log in with codex login', 1), 'unavailable');
  assert.equal(classify('I could not make that image.', 0), 'noImage');
  assert.equal(classify('unexpected crash', 1), 'transient');
});

test('the instruction keeps Codex on its built-in tool and preserves references', () => {
  const edit = instruction({ prompt: ' Make the cloak green. ', count: 2, refs: ['a.png'] });
  assert.match(edit, /exactly 2 images/);
  assert.match(edit, /no CLI fallback, no API key and no other provider/);
  assert.match(edit, /attached image is the reference/);
  assert.ok(edit.endsWith('Make the cloak green.'));
  assert.match(instruction({ prompt: 'A robot', count: 1, refs: [] }), /exactly 1 image\./);
});

async function fakeCodex(directory, body) {
  const file = path.join(directory, 'fake-codex');
  await writeFile(file, `#!/bin/sh\ncat > "$FAKE_STDIN"\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}

function run(home, args, via = script) {
  return spawnSync(process.execPath, [via, ...args], { encoding: 'utf8', env: { ...process.env, CODEX_HOME: home, FAKE_STDIN: path.join(home, 'stdin.txt') } });
}

test('delivers new images, never overwrites, and works through a symlinked skill', { skip: !posix }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-image-'));
  await mkdir(path.join(home, 'generated_images', 'old'), { recursive: true });
  await writeFile(path.join(home, 'generated_images', 'old', 'exec-old.png'), 'old');
  const bin = await fakeCodex(home, 'mkdir -p "$CODEX_HOME/generated_images/new" && printf png > "$CODEX_HOME/generated_images/new/exec-1.png"');
  const out = path.join(home, 'out');
  const args = ['--prompt', 'A robot', '--out', out, '--name', 'robot', '--codex-bin', bin];
  const first = run(home, args);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout).outputs, [path.join(out, 'robot-01.png')]);

  const link = path.join(home, 'linked-skill');
  await symlink(path.dirname(script), link, 'dir');
  const bin2 = await fakeCodex(home, 'printf png2 > "$CODEX_HOME/generated_images/new/exec-2.png"');
  const second = run(home, [...args.slice(0, -1), bin2], path.join(link, 'codex_image.mjs'));
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual((await readdir(out)).sort(), ['robot-01.png', 'robot-02.png']);
});

test('reports exhaustion as exit 20 and a rate limit as exit 22', { skip: !posix }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-image-'));
  const args = ['--prompt', 'A robot', '--out', path.join(home, 'out'), '--codex-bin'];
  const exhausted = run(home, [...args, await fakeCodex(home, 'echo "You have hit your usage limit" >&2; exit 1')]);
  assert.equal(exhausted.status, 20);
  assert.equal(JSON.parse(exhausted.stderr).status, 'exhausted');
  assert.equal(run(home, [...args, await fakeCodex(home, 'echo "429 Too Many Requests" >&2; exit 1')]).status, 22);
  assert.equal(run(home, [...args, path.join(home, 'no-such-codex')]).status, 23);
  assert.equal(run(home, ['--out', home]).status, 2);
});

test('a dry run calls nothing and shows the read-only command', async () => {
  const result = run(os.tmpdir(), ['--prompt', 'A robot', '--ref', script, '--out', os.tmpdir(), '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.command.slice(0, 4), ['codex', 'exec', '-i', script]);
  assert.ok(plan.command.includes('read-only'));
});
