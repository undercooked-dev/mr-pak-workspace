import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from './server.mjs';
import { expandHome, saveJson } from './util.mjs';
import { createInterface } from 'node:readline';

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const options = name => args.flatMap((value, index) => value === name && index + 1 < args.length ? [args[index + 1]] : []);
const repo = path.resolve(option('--repo') || process.env.MRMAK_REPO || path.join(directory, '../..'));
const uiDir = path.resolve(option('--ui') || path.join(directory, '../../dist'));
const stateDir = path.resolve(option('--state') || path.join(repo, '.mrmak'));
// Folders whose projects' mr-mak-workspace cards join this Workspace: every --scan <dir>, else
// MRMAK_SCAN_ROOTS (separated like PATH), else the repository's parent. --no-scan turns it off.
const scanned = options('--scan'), configured = (process.env.MRMAK_SCAN_ROOTS || '').split(path.delimiter).filter(Boolean);
const scanRoots = args.includes('--no-scan') ? [] : (scanned.length ? scanned : configured.length ? configured : [path.dirname(repo)]).map(folder => path.resolve(expandHome(folder)));
const writeNative = value => process.stdout.write(JSON.stringify(value) + '\n');
const service = await createService({ repo, uiDir, stateDir, native: writeNative, restoreSessions: true, scanRoots });
// Diagnostics are readable project state. Window credentials travel only over
// the private startup pipe to the desktop shell, never through this file.
await saveJson(path.join(stateDir, 'runtime.json'), { pid: process.pid, origin: service.origin });
writeNative({ type: 'ready', ...service.urls });
let exiting = false;
async function stop() {
  if (exiting) return; exiting = true;
  const deadline = setTimeout(() => process.exit(1), 8000); deadline.unref();
  await service.close(); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
if (process.env.MRMAK_PARENT_PID) {
  const parent = Number(process.env.MRMAK_PARENT_PID);
  const timer = setInterval(() => { try { process.kill(parent, 0); } catch { stop(); } }, 2000); timer.unref();
}
createInterface({ input: process.stdin }).on('line', line => {
  if (line.trim() === 'quit') { void stop(); return; }
  try { service.nativeMessage(JSON.parse(line)); } catch { /* Ignore malformed native messages. */ }
});
process.on('uncaughtException', error => { process.stderr.write(`Service error: ${error.message}\n`); stop(); });
