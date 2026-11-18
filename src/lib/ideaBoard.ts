export interface MechanicIdea { id: string; name: string; description: string; notes: string }
export interface IdeaSection { id: string; name: string; scope: string; ideas: MechanicIdea[] }
export interface IdeaBoard { title: string; intro: string; rule: string; footer: string; sections: IdeaSection[] }
export interface IdeaSnapshot { id: string; savedAt: string; board: IdeaBoard }
export interface IdeaBook { schemaVersion: 1; board: IdeaBoard; snapshots: IdeaSnapshot[] }

// An unused Markdown reference definition stays hidden in ordinary Markdown
// readers too. Its quoted title holds editable JSON rather than encoded data.
const marker = "[mrmak:idea-board]: # '\n"
const legacyMarker = '<!-- mrmak:idea-board\n'
export const isIdeaBoard = (text: string) => text.includes('[mrmak:idea-board]:') || text.includes('<!-- mrmak:idea-board')
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string')

export function validateIdeaBoard(value: unknown): IdeaBoard {
  if (!record(value) || !strings(value, ['title', 'intro', 'rule', 'footer']) || !Array.isArray(value.sections) || !value.sections.length) throw new Error('Invalid idea board.')
  const sections = new Set<string>(), ideas = new Set<string>()
  for (const section of value.sections) {
    if (!record(section) || !strings(section, ['id', 'name', 'scope']) || !section.id || sections.has(section.id as string) || !Array.isArray(section.ideas)) throw new Error('Invalid or duplicate direction.')
    sections.add(section.id as string)
    for (const idea of section.ideas) {
      if (!record(idea) || !strings(idea, ['id', 'name', 'description', 'notes']) || !idea.id || ideas.has(idea.id as string)) throw new Error('Invalid or duplicate mechanic.')
      ideas.add(idea.id as string)
    }
  }
  return copy(value) as unknown as IdeaBoard
}

export function validateIdeaBook(value: unknown): IdeaBook {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.snapshots) || value.snapshots.length > 5) throw new Error('Invalid idea history or unsupported version.')
  const board = validateIdeaBoard(value.board)
  const ids = new Set<string>()
  const snapshots = value.snapshots.map(snapshot => {
    if (!record(snapshot) || !strings(snapshot, ['id', 'savedAt']) || !snapshot.id || ids.has(snapshot.id as string) || !Number.isFinite(Date.parse(snapshot.savedAt as string))) throw new Error('Invalid save snapshot.')
    ids.add(snapshot.id as string)
    return { id: snapshot.id as string, savedAt: snapshot.savedAt as string, board: validateIdeaBoard(snapshot.board) }
  })
  if (snapshots.length && JSON.stringify(snapshots[0].board) !== JSON.stringify(board)) throw new Error('Latest snapshot does not match the saved board.')
  return { schemaVersion: 1, board, snapshots }
}

export function parseIdeaBook(text: string): IdeaBook {
  const delimiter = text.includes(marker) ? marker : legacyMarker
  const start = text.indexOf(delimiter), end = text.indexOf(delimiter === marker ? "\n'" : '\n-->', start)
  if (start < 0 || end < 0 || text.indexOf(delimiter, start + delimiter.length) >= 0 || (text.includes(marker) && text.includes(legacyMarker))) throw new Error('Idea board data is missing or incomplete. The original document has been kept.')
  return validateIdeaBook(JSON.parse(text.slice(start + delimiter.length, end)))
}

export function snapshotIdeaBook(book: IdeaBook, board: IdeaBoard, id: string, savedAt: string): IdeaBook {
  return validateIdeaBook({ schemaVersion: 1, board, snapshots: [{ id, savedAt, board }, ...book.snapshots].slice(0, 5) })
}

const escapeMarkdown = (text: string) => text.replace(/[\\`*_{}[\]()#+.!|<>~]/g, '\\$&').replace(/\r?\n/g, '  \n')

export function formatIdeaBook(value: IdeaBook): string {
  const book = validateIdeaBook(value), { board } = book
  const lines = [`# ${escapeMarkdown(board.title)}`, '', escapeMarkdown(board.intro), '', `**${escapeMarkdown(board.rule)}**`, '', 'In Mr. Mak, choose a direction from the sidebar or use **Add direction**, then choose **Add mechanic**. Edit the cards directly, then **Save**. History keeps the last five manual saves; loading a snapshot opens a draft.', '']
  for (const [index, section] of board.sections.entries()) {
    lines.push(`## ${index + 1}. ${escapeMarkdown(section.name)}`, '', escapeMarkdown(section.scope), '')
    if (!section.ideas.length) lines.push('*No mechanic ideas yet.*', '')
    for (const idea of section.ideas) {
      lines.push(`### ${escapeMarkdown(idea.name.trim() || 'Untitled mechanic')}`, '', escapeMarkdown(idea.description) || '*No description yet.*', '')
      if (idea.notes) lines.push(`**Notes:** ${escapeMarkdown(idea.notes)}`, '')
    }
  }
  if (board.footer) lines.push(board.footer, '')
  // Keep arbitrary idea text from terminating the hidden data block. The prose
  // above remains readable in Mobile Access, browser preview and older clients.
  const data = JSON.stringify(book, null, 2).replace(/'/g, '\\u0027').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  return lines.join('\n') + '\n' + marker + data + "\n'\n"
}
