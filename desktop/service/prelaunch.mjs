import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isWindows, terminateProcessTree } from './platform.mjs';
import { within } from './util.mjs';

// A project workspace may rebuild the pages it derives from its project in scripts/prelaunch.mjs.
// The service runs it once at start, only for the mount roots its owner listed as trusted in
// <stateDir>/trusted-workspaces.json (a JSON array of their real paths).
export const PRELAUNCH_SCRIPT = path.join('scripts', 'prelaunch.mjs');
const LIMIT_MS = 120 * 1000, KEPT_BYTES = 16 * 1024, LOGGED_LINES = 12;

// A missing or unreadable list trusts nothing.
export async function trustedWorkspaces(stateDir) {
  try {
    const list = JSON.parse((await readFile(path.join(stateDir, 'trusted-workspaces.json'), 'utf8')).replace(/^﻿/, ''));
    return new Set(Array.isArray(list) ? list.filter(item => typeof item === 'string' && path.isAbsolute(item)).map(item => path.resolve(item)) : []);
  } catch { return new Set(); }
}

export class Prelaunch {
  constructor({ stateDir, mounts, finished = () => {}, log = text => process.stderr.write(text) }) {
    this.stateDir = stateDir; this.mounts = mounts; this.finished = finished; this.log = log;
    this.children = new Set(); this.closed = false; this.started = null;
  }
  // Once per service: later rescans never run a script again. Scripts of different projects run side by side.
  start() {
    this.started ||= (async () => {
      if (!this.mounts?.enabled) return;
      const trusted = await trustedWorkspaces(this.stateDir);
      if (!trusted.size || this.closed) return;
      const { mounts } = await this.mounts.list();
      await Promise.all(mounts.filter(mount => trusted.has(mount.root)).map(mount => this.run(mount)));
    })().catch(error => this.log(`Prelaunch scripts could not be started: ${error.message}\n`));
    return this.started;
  }
  async run(mount) {
    const script = path.join(mount.root, PRELAUNCH_SCRIPT);
    const actual = await realpath(script).catch(() => null);
    if (!actual || !(await stat(actual).catch(() => null))?.isFile() || this.closed) return;
    if (!within(mount.root, actual)) { this.log(`${mount.name}: ${PRELAUNCH_SCRIPT} leads outside its workspace and was not run.\n`); return; }
    // Its own process group, so a timeout or shutdown also stops what the script started.
    const child = spawn(process.execPath, [script], { cwd: mount.root, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWindows, windowsHide: true });
    this.children.add(child);
    let output = '', timedOut = false;
    const keep = chunk => { output = (output + chunk.toString('utf8')).slice(-KEPT_BYTES); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const timer = setTimeout(() => { timedOut = true; terminateProcessTree(child.pid, { force: true }).catch(() => {}); }, LIMIT_MS);
    const { code, signal, error } = await new Promise(resolve => {
      child.once('error', error => resolve({ error }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timer); this.children.delete(child);
    if (this.closed) return;
    if (!error && !timedOut && code === 0) { this.finished(mount); return; }
    const reason = error ? `could not start (${error.message})` : timedOut ? `did not finish within ${LIMIT_MS / 1000} seconds and was stopped` : signal ? `was stopped (${signal})` : `exited with code ${code}`;
    const lines = output.split(/\r?\n/).filter(line => line.trim()).slice(-LOGGED_LINES).map(line => `  ${line.slice(0, 400)}\n`).join('');
    this.log(`${mount.name}: ${PRELAUNCH_SCRIPT} ${reason}.\n${lines}`);
  }
  // Stops any script still running.
  async close() {
    this.closed = true;
    await Promise.all([...this.children].map(child => terminateProcessTree(child.pid, { force: true }).catch(() => {})));
  }
}
