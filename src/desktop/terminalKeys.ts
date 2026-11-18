import type { AgentId } from './types'

export function terminalInput(data: string, agent: AgentId, windows: boolean): string {
  // After the first Win32 input packet, ConPTY buffers a bare ESC as a
  // sequence prefix. Encode the key explicitly so cancel reaches Codex now
  // instead of combining with the next character as Alt+key. Keep complete
  // escape sequences (arrows, Alt shortcuts and bracketed paste) unchanged.
  if (windows && agent === 'codex' && data === '\x1b') return '\x1b[27;1;27;1;0;1_\x1b[27;1;27;0;0;1_'
  return data
}

export function terminalNewline(agent: AgentId, windows: boolean): string {
  // Native Windows Codex reads console key events. ConPTY drops CSI-u for
  // that API, so send a Win32 Shift+Enter key-down/key-up pair instead.
  // Stream-based CLIs need CSI-u: ConPTY flattens Win32 Shift+Enter to CR
  // when converting console events back into their byte-oriented input.
  if (windows && agent === 'codex') return '\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_'
  return '\x1b[13;2u'
}
