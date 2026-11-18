import { isDesktop, pageDataRequest } from '../desktop/client'
import { downloadText } from './download'

/** The card tab a report frame shows. The app, never the page, decides whose files a page uses. */
export type PageDataCard = { entityId: string; step: number; path: string }

type Message = Record<string, unknown>
const MAX_BYTES = 2 * 1024 * 1024
// The fields each operation may carry besides `type`, `id`, `op` and `name`.
const fields: Record<string, string[]> = { load: [], save: ['text', 'revision'], history: [], version: ['version'], download: ['text'] }
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const tooLarge = (text: string) => text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES
// A download's name: a plain file name of up to 100 characters, never a path or a hidden file.
const downloadName = (name: string) => name.length > 0 && name.length <= 100 && !name.startsWith('.') && ![...name].some(char => char === '/' || char === '\\' || char < ' ' || char === '\x7f')

// What the page receives; workspace/_shared/report.js turns `text` back into a value.
function result(op: string, value: Message) {
  if (op === 'load') return value.exists ? { text: value.text, revision: value.revision } : null
  if (op === 'save') return { revision: value.revision }
  if (op === 'history') return value.versions
  return { text: value.text }
}

/**
 * Serves `mak.data` requests (docs/page-data.md) from one report frame. A message is heard only
 * when its source is that frame's own window; every other sender is ignored. A request the frame
 * cannot serve gets an error reply, never silence. The service checks the file rules itself; a
 * download never reaches the service, the app saves it as it saves its own downloads.
 */
export function servePageData(frame: { readonly current: HTMLIFrameElement | null }, card: PageDataCard | null) {
  const listener = (event: MessageEvent) => {
    const target = frame.current?.contentWindow
    if (!target || event.source !== target) return
    const received: unknown = event.data
    if (!received || typeof received !== 'object' || (received as Message).type !== 'mrmak:data-request') return
    const message = received as Message
    const id = typeof message.id === 'string' && message.id.length <= 100 ? message.id : null
    const reply = (body: Message) => {
      // A page with an opaque origin can only be answered with '*'; the frame is still the one asked.
      try { target.postMessage({ type: 'mrmak:data-response', id, ...body }, event.origin === 'null' ? '*' : event.origin) } catch { /* The page has gone. */ }
    }
    // `available: false` tells the page it cannot use mak.data here at all, not just for one file.
    const refuse = (code: string, text: string, available?: boolean) => reply({ ok: false, error: { code, message: text }, ...(available === false ? { available } : {}) })
    if (!isDesktop || !card) return refuse('read-only', 'Saving works only in the Mr. Mak desktop app, with this page open as a tab of its card.', false)
    const op = typeof message.op === 'string' && has(fields, message.op) ? message.op : ''
    if (!op) return refuse('invalid', 'Use load, save, history, version or download.')
    // The page names a file and nothing else: a field naming a folder, card or project is refused.
    const extra = Object.keys(message).find(key => !['type', 'id', 'op', 'name', ...fields[op]].includes(key))
    if (extra) return refuse('invalid', `A data request cannot include "${extra}".`)
    if (!id) return refuse('invalid', 'A data request needs an id of up to 100 characters.')
    if (typeof message.name !== 'string') return refuse('invalid', 'Name the data file.')
    if (op === 'save' || op === 'download') {
      if (typeof message.text !== 'string') return refuse('invalid', op === 'save' ? 'Send the content as JSON text.' : 'Pass the content to download as text.')
      if (tooLarge(message.text)) return refuse('too-large', `${message.name} would be larger than 2 MB.`)
    }
    if (op === 'download') {
      if (!downloadName(message.name)) return refuse('invalid', 'Use a file name of up to 100 characters, with no folder and no leading dot.')
      try { downloadText(message.name, message.text as string) } catch { return refuse('failed', `Mr. Mak could not download ${message.name}.`) }
      return reply({ ok: true, result: null })
    }
    const forwarded: Message = { entityId: card.entityId, step: card.step, path: card.path, origin: event.origin, name: message.name }
    for (const key of fields[op]) if (has(message, key)) forwarded[key] = message[key]
    pageDataRequest(op, forwarded).then(
      value => reply({ ok: true, result: result(op, value) }),
      (error: Error & { code?: string; available?: boolean }) => refuse(error.code || 'failed', error.message, error.available),
    )
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
