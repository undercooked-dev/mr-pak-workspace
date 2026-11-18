#!/usr/bin/env node
// Generate or edit images with Codex's built-in image tool from any agent or shell.
// Runs one non-interactive `codex exec`, then copies the images it produced into --out.
// Exit codes tell the caller which route to take next:
//   0  images delivered            20  Codex credits or usage limit exhausted -> use the AtlasCloud fallback
//   21 finished without an image   22  temporary rate limit or network error  -> retry later, do not fall back
//   23 Codex missing or signed out  2  bad arguments
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT = { ok: 0, usage: 2, exhausted: 20, noImage: 21, transient: 22, unavailable: 23 };
const IMAGE = /\.(png|jpe?g|webp)$/i;
// Exhaustion means the account cannot generate until credits return. A plain 429 is not that.
const EXHAUSTED = /usage[ _]limit|out of credits|credits? (?:have |has )?(?:run out|been exhausted|exhausted)|insufficient[ _](?:credits?|quota|balance)|hit your [a-z ]*limit|quota (?:exceeded|exhausted)|purchase more credits|add (?:more )?credits/i;
const TRANSIENT = /rate[ _-]?limit|too many requests|\b429\b|timed? ?out|ECONNRESET|ENOTFOUND|network error|stream disconnected|temporarily unavailable|\b50[234]\b/i;
const SIGNED_OUT = /not (?:logged|signed) in|please (?:log|sign) in|codex login|unauthorized|\b401\b/i;

export function classify(text, code) {
  if (EXHAUSTED.test(text)) return 'exhausted';
  if (SIGNED_OUT.test(text)) return 'unavailable';
  if (TRANSIENT.test(text)) return 'transient';
  return code === 0 ? 'noImage' : 'transient';
}

export function instruction({ prompt, count, refs }) {
  const reference = refs.length
    ? `The ${refs.length === 1 ? 'attached image is the reference' : `${refs.length} attached images are the references`}. Change only what the request below asks; keep everything else as it is in the reference.`
    : 'Create the image from the request below.';
  return [
    `Use the built-in image generation tool to produce exactly ${count} image${count === 1 ? '' : 's'}.`,
    'Use only that built-in tool: no CLI fallback, no API key and no other provider. If it is unavailable or refuses, say so and stop.',
    'Do not create, edit or delete any file in the working directory.',
    reference,
    'When finished, reply with one short line per image.',
    '',
    prompt.trim(),
  ].join('\n');
}

function parse(argv) {
  const options = { refs: [], count: 1, name: 'image', timeoutMin: 20, codexBin: 'codex', cwd: process.cwd() };
  const value = index => { if (argv[index + 1] === undefined) throw new Error(`${argv[index]} needs a value`); return argv[index + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--prompt') options.prompt = value(i++);
    else if (flag === '--prompt-file') options.promptFile = value(i++);
    else if (flag === '--ref') options.refs.push(path.resolve(value(i++)));
    else if (flag === '--out') options.out = path.resolve(value(i++));
    else if (flag === '--name') options.name = value(i++);
    else if (flag === '--count') options.count = Number(value(i++));
    else if (flag === '--cwd') options.cwd = path.resolve(value(i++));
    else if (flag === '--timeout-min') options.timeoutMin = Number(value(i++));
    else if (flag === '--codex-bin') options.codexBin = value(i++);
    else throw new Error(`Unknown option ${flag}`);
  }
  return options;
}

const HELP = `Usage: node codex_image.mjs (--prompt TEXT | --prompt-file FILE) --out DIR [options]
  --ref FILE        Reference image to edit or follow; repeat for several
  --count N         Images to produce (default 1)
  --name BASE       Output base name (default "image"); files are never overwritten
  --cwd DIR         Working directory for Codex (default: current)
  --timeout-min N   Give up after N minutes (default 20)
  --dry-run         Print the command and instruction without calling Codex
Exit: 0 delivered, 20 credits exhausted (use AtlasCloud), 21 no image, 22 temporary failure, 23 Codex unavailable.`;

async function snapshot(root) {
  const seen = new Map();
  async function walk(directory, depth) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (depth < 3) await walk(full, depth + 1); }
      else if (IMAGE.test(entry.name)) seen.set(full, (await stat(full).catch(() => null))?.mtimeMs ?? 0);
    }
  }
  await walk(root, 0);
  return seen;
}

async function freeName(directory, base, extension) {
  for (let n = 1; ; n++) {
    const candidate = path.join(directory, `${base}-${String(n).padStart(2, '0')}${extension}`);
    if (!existsSync(candidate)) return candidate;
  }
}

async function main() {
  let options;
  try { options = parse(process.argv.slice(2)); } catch (error) { console.error(`${error.message}\n\n${HELP}`); return EXIT.usage; }
  if (options.help) { console.log(HELP); return EXIT.ok; }
  const prompt = options.promptFile ? await readFile(options.promptFile, 'utf8') : options.prompt;
  if (!prompt?.trim() || !options.out || !(options.count >= 1)) { console.error(`A prompt, --out and a positive --count are required.\n\n${HELP}`); return EXIT.usage; }
  for (const ref of options.refs) if (!existsSync(ref)) { console.error(`Reference not found: ${ref}`); return EXIT.usage; }

  const text = instruction({ prompt, count: options.count, refs: options.refs });
  // The prompt goes through stdin: -i takes several values and would swallow a positional prompt.
  const args = ['exec', ...options.refs.flatMap(ref => ['-i', ref]), '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '-C', options.cwd];
  if (options.dryRun) { console.log(JSON.stringify({ status: 'dry-run', command: [options.codexBin, ...args], instruction: text }, null, 2)); return EXIT.ok; }

  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images');
  const before = await snapshot(root);
  const started = Date.now();
  const { code, output, missing } = await new Promise(resolve => {
    let child, captured = '';
    try { child = spawn(options.codexBin, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch { return resolve({ missing: true, output: '' }); }
    const timer = setTimeout(() => { captured += '\ntimed out waiting for Codex'; child.kill(); }, options.timeoutMin * 60000);
    child.on('error', error => { clearTimeout(timer); resolve({ missing: error.code === 'ENOENT', output: String(error.message), code: 1 }); });
    child.stdout.on('data', chunk => { captured += chunk; });
    child.stderr.on('data', chunk => { captured += chunk; });
    child.on('close', exit => { clearTimeout(timer); resolve({ code: exit ?? 1, output: captured }); });
    child.stdin.end(text);
  });
  if (missing) { console.error('Codex CLI not found. Install it or pass --codex-bin.'); return EXIT.unavailable; }

  const after = await snapshot(root);
  const fresh = [...after].filter(([file, mtime]) => !before.has(file) || (mtime > before.get(file) && mtime >= started - 2000)).sort((a, b) => a[1] - b[1]).map(([file]) => file);
  if (fresh.length) {
    await mkdir(options.out, { recursive: true });
    const outputs = [];
    for (const file of fresh) {
      const target = await freeName(options.out, options.name, path.extname(file).toLowerCase());
      await copyFile(file, target);
      outputs.push(target);
    }
    const short = fresh.length < options.count ? ` Codex produced ${fresh.length} of ${options.count} requested.` : '';
    console.log(JSON.stringify({ status: 'ok', provider: 'codex-imagegen', outputs, sources: fresh, note: short.trim() || undefined }, null, 2));
    return EXIT.ok;
  }
  const kind = classify(output, code);
  const log = path.join(os.tmpdir(), `codex-image-${started}.log`);
  await writeFile(log, output).catch(() => {});
  console.error(JSON.stringify({ status: kind, provider: 'codex-imagegen', exitCode: code, log, tail: output.trim().split('\n').slice(-6) }, null, 2));
  return EXIT[kind];
}

// Compare real paths: the skill may be reached through a symlinked skills directory.
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(self)) process.exitCode = await main();
