import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { terminalInput, terminalNewline } from '../../../src/desktop/terminalKeys.ts';

async function consoleKeys(chunks) {
  // ReadKey uses the same native console input API as Windows Codex. A fake
  // PTY cannot detect ConPTY silently dropping an unsupported CSI-u sequence.
  const script = `[Console]::WriteLine('NEWLINE_READY')
while ($true) {
  $pressed = [Console]::ReadKey($true)
  if ($pressed.Key -eq [ConsoleKey]::F12) { break }
  [Console]::WriteLine(('NEWLINE_KEY:{0}:{1}:{2}' -f [int]$pressed.Key, [int]$pressed.Modifiers, [int]$pressed.KeyChar))
}`;
  // Isolate node-pty's console worker handles from the test runner. Exit this
  // helper only after the console probe exits; no user process is involved.
  const runner = `
    import pty from 'node-pty';
    import { ptyOptions } from './platform.mjs';
    const proc = pty.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', process.argv[1]], ptyOptions({ cwd: process.cwd(), cols: 100, rows: 30, env: process.env }));
    let output = '', sent = false;
    const timer = setTimeout(() => { proc.kill(); process.stderr.write('Native console did not receive both keys'); process.exit(1); }, 10000);
    proc.onData(data => {
      output += data;
      if (!sent && output.includes('NEWLINE_READY')) {
        sent = true;
        const chunks = JSON.parse(Buffer.from(process.argv[2], 'base64').toString());
        chunks.forEach((chunk, index) => setTimeout(() => proc.write(chunk), index * 100));
      }
    });
    proc.onExit(event => {
      clearTimeout(timer);
      process.stdout.write(JSON.stringify({ code: event.exitCode, output }), () => process.exit(0));
    });`;
  // F12 finishes the fixture even if an earlier Esc was swallowed. Each key
  // arrives in a separate write, as it does during normal interactive typing.
  const input = [...chunks, '\x1b[24~'];
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', runner, Buffer.from(script, 'utf16le').toString('base64'), Buffer.from(JSON.stringify(input)).toString('base64')], { cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, timeout: 12000 });
  const result = JSON.parse(stdout);
  assert.equal(result.code, 0);
  return result.output.match(/NEWLINE_KEY:\d+:\d+:\d+/g);
}

test('Windows Codex newline reaches the native console as Shift+Enter, followed by plain Enter', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  assert.deepEqual(await consoleKeys([terminalNewline('codex', true), '\r']), ['NEWLINE_KEY:13:2:13', 'NEWLINE_KEY:13:0:13']);
});

test('Esc after Shift+Enter cancels immediately and does not turn the next character into Alt+key', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const chunks = [terminalNewline('codex', true), '\x1b', 'x'];
  assert.deepEqual(await consoleKeys(chunks.map(data => terminalInput(data, 'codex', true))), ['NEWLINE_KEY:13:2:13', 'NEWLINE_KEY:27:0:27', 'NEWLINE_KEY:88:0:120']);
});
