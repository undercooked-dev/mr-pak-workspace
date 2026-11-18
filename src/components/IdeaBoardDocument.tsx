import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { api } from '../desktop/client'
import type { Preview } from '../desktop/types'
import { formatIdeaBook, parseIdeaBook, snapshotIdeaBook, validateIdeaBoard } from '../lib/ideaBoard'
import type { IdeaBoard, IdeaBook, MechanicIdea } from '../lib/ideaBoard'
import './section-sidebar.css'
import './idea-board.css'

interface State { book: IdeaBook; draft: IdeaBoard; revision: string; busy: boolean; status: string; error: string }
const sessions = new Map<string, BoardSession>()
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

class BoardSession {
  state: State
  listeners = new Set<() => void>()
  key: string
  constructor(public file: Preview) {
    const book = parseIdeaBook(file.text || '')
    this.key = `mrmak.idea-draft.${file.path}`
    this.state = { book, draft: clone(book.board), revision: file.revision || '', busy: false, status: '', error: '' }
    try {
      const stored = sessionStorage.getItem(this.key)
      if (stored) {
        const draft = JSON.parse(stored)
        if (typeof draft.revision !== 'string') throw new Error('Invalid draft revision.')
        this.state.draft = validateIdeaBoard(draft.board)
        this.state.revision = draft.revision
        this.state.status = 'Draft recovered'
        if (draft.revision !== file.revision) this.state.error = 'The saved file changed while you had a draft. Download your draft before reloading the saved version.'
      }
    } catch { this.state.error = 'The stored draft could not be recovered. The saved document is still available.' }
  }
  dirty = () => !same(this.state.draft, this.state.book.board)
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get = () => this.state
  update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    try {
      if (this.dirty()) sessionStorage.setItem(this.key, JSON.stringify({ board: this.state.draft, revision: this.state.revision }))
      else sessionStorage.removeItem(this.key)
    } catch { /* The session still retains the draft across section switches. */ }
    this.listeners.forEach(listener => listener())
  }
  accept(file: Preview) {
    if (this.state.busy || file.revision === this.state.revision) return
    if (this.dirty()) this.update({ error: 'The saved file changed while you had a draft. Download your draft before reloading the saved version.' })
    // The parent preview request may have started before an in-flight save
    // completed. Fetch again instead of replacing the newer session with it.
    else void this.reload()
  }
  edit(board: IdeaBoard) { if (!this.state.busy) this.update({ draft: board, status: '' }) }
  async save() {
    if (this.state.busy || !this.dirty()) return
    this.update({ busy: true, error: '', status: 'Saving…' })
    try {
      const book = snapshotIdeaBook(this.state.book, this.state.draft, crypto.randomUUID(), new Date().toISOString())
      const text = formatIdeaBook(book)
      if (new Blob([text]).size > 2 * 1024 * 1024) throw new Error('This board exceeds the 2 MB document limit. Shorten the draft before saving.')
      const result = await api<Preview>('/files/markdown', { path: this.file.path, text, revision: this.state.revision })
      this.update({ book, draft: clone(book.board), revision: result.revision || '', busy: false, status: 'Saved' })
    } catch (error) { this.update({ busy: false, status: '', error: message(error) }) }
  }
  async reload() {
    if (this.state.busy) return
    this.update({ busy: true, error: '' })
    try {
      const file = await api<Preview>(`/preview?path=${encodeURIComponent(this.file.path)}`)
      const book = parseIdeaBook(file.text || '')
      this.update({ book, draft: clone(book.board), revision: file.revision || '', busy: false, error: '', status: 'Saved version loaded' })
    } catch (error) { this.update({ busy: false, error: message(error) }) }
  }
}

// This guard lives beyond the mounted view: switching tabs must not remove the
// close warning or abandon a save that is still in flight.
window.addEventListener('beforeunload', event => {
  let storedDraft = false
  try { storedDraft = Object.keys(sessionStorage).some(key => key.startsWith('mrmak.idea-draft.')) } catch { /* In-memory guard remains available. */ }
  if (storedDraft || [...sessions.values()].some(session => session.dirty() || session.state.busy)) { event.preventDefault(); event.returnValue = '' }
})

function sessionFor(file: Preview) {
  let session = sessions.get(file.path)
  if (!session) { session = new BoardSession(file); sessions.set(file.path, session) }
  return session
}

export default function IdeaBoardDocument({ file }: { file: Preview }) {
  let session: BoardSession
  try { session = sessionFor(file) }
  catch (error) { return <div className="report-error" role="alert"><strong>Cannot open mechanic ideas</strong><p>{message(error)}</p><a href={file.url} target="_blank" rel="noreferrer">Open original document</a></div> }
  return <IdeaBoardEditor session={session} file={file} />
}

function IdeaBoardEditor({ session, file }: { session: BoardSession; file: Preview }) {
  const instance = useId()
  const state = useSyncExternalStore(session.subscribe, session.get)
  const { draft, book, busy, error } = state
  const selectionKey = `mrmak.idea-direction.${file.path}`
  const [selectedId, setSelectedId] = useState(() => {
    try { return sessionStorage.getItem(selectionKey) || draft.sections[0].id } catch { return draft.sections[0].id }
  })
  const [query, setQuery] = useState('')
  const [editingDirection, setEditingDirection] = useState(false)
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null)
  const section = draft.sections.find(item => item.id === selectedId) || draft.sections[0]
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = draft.sections.filter(item => words.every(word => item.name.toLowerCase().includes(word)))
  const [history, setHistory] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<{ idea: MechanicIdea; section: string; index: number } | null>(null)
  useEffect(() => { session.accept(file) }, [session, file])
  const edit = (change: (board: IdeaBoard) => void) => { const next = clone(draft); change(next); session.edit(next); setConfirm(null) }
  const selectDirection = (id: string) => {
    setSelectedId(id); setEditingDirection(false); setEditingIdeaId(null)
    try { sessionStorage.setItem(selectionKey, id) } catch { /* Selection remains in memory. */ }
  }
  const addDirection = () => {
    const id = crypto.randomUUID()
    let name = 'New direction', number = 2
    while (draft.sections.some(item => item.name === name)) name = `New direction ${number++}`
    edit(board => board.sections.push({ id, name, scope: '', ideas: [] }))
    selectDirection(id); setQuery(''); setEditingDirection(true)
    requestAnimationFrame(() => { const input = document.getElementById(`${instance}-direction-name-${id}`) as HTMLInputElement | null; input?.focus(); input?.select() })
  }
  const focus = (id: string) => requestAnimationFrame(() => document.getElementById(`${instance}-idea-name-${id}`)?.focus())
  const add = (section: string, source?: MechanicIdea) => {
    const idea = { name: '', description: '', notes: '', ...source, id: crypto.randomUUID() }
    if (source?.name) idea.name += ' (copy)'
    edit(board => board.sections.find(item => item.id === section)!.ideas.push(idea))
    selectDirection(section); setEditingIdeaId(idea.id); focus(idea.id)
  }
  const updateIdea = (id: string, key: 'name' | 'description' | 'notes', value: string) => edit(board => {
    const idea = board.sections.flatMap(section => section.ideas).find(item => item.id === id)!
    idea[key] = value
  })
  const move = (id: string, destination: string) => {
    edit(board => {
      const source = board.sections.find(section => section.ideas.some(idea => idea.id === id))!
      const [idea] = source.ideas.splice(source.ideas.findIndex(item => item.id === id), 1)
      board.sections.find(section => section.id === destination)!.ideas.push(idea)
    })
    selectDirection(destination); setEditingIdeaId(id); setQuery(''); focus(id)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2) + '\n'], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'mechanic-ideas-draft.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const loadSnapshot = (id: string) => {
    const saved = book.snapshots.find(snapshot => snapshot.id === id)
    if (saved) { session.edit(clone(saved.board)); setDeleted(null); setConfirm(null); setEditingDirection(false); setEditingIdeaId(null) }
  }
  return <section className="idea-board" aria-label="Mechanic ideas" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void session.save() }
  }}>
    <div className="idea-toolbar">
      <span role="status">{busy ? 'Saving / loading…' : state.status || (session.dirty() ? 'Unsaved draft' : 'All changes saved')}</span>
      <button disabled={busy} aria-expanded={history} onClick={() => setHistory(!history)}>History ({book.snapshots.length}/5)</button>
      <button disabled={busy} onClick={download}>Download draft</button>
      <button disabled={busy} onClick={() => session.dirty() ? setConfirm('reload') : void session.reload()}>Reload saved</button>
      <button className="idea-save" disabled={busy || !session.dirty()} onClick={() => void session.save()}>Save</button>
    </div>
    <div className="idea-workspace">
      <nav className="section-sidebar idea-sidebar" aria-label="Progression directions">
        <div className="section-search">
          <label htmlFor={`${instance}-direction-search`}>Find direction</label>
          <div className="section-search-field">
            <input id={`${instance}-direction-search`} type="search" placeholder="Direction name" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
              if (event.key === 'Escape') { event.preventDefault(); setQuery('') }
              if (event.key === 'Enter' && matches.length) { event.preventDefault(); selectDirection(matches[0].id) }
            }} />
            {query && <button onClick={() => setQuery('')} aria-label="Clear direction search">Clear</button>}
          </div>
          <p className="section-search-count">{query ? `${matches.length} of ${draft.sections.length}` : draft.sections.length} directions</p>
        </div>
        <div className="section-links"><h2>Directions</h2>{matches.map(item => <button key={item.id} aria-label={item.name || 'Untitled direction'} aria-current={item.id === section.id ? 'page' : undefined} onClick={() => selectDirection(item.id)}><span>{item.name || 'Untitled direction'}</span><small>{item.ideas.length}</small></button>)}</div>
        <div className="section-mobile">
          <label htmlFor={`${instance}-direction-select`}>Progression direction</label>
          <select id={`${instance}-direction-select`} aria-label="Progression direction" value={matches.some(item => item.id === section.id) ? section.id : ''} disabled={!matches.length} onChange={event => selectDirection(event.target.value)}>
            {!matches.some(item => item.id === section.id) && <option value="" disabled>{matches.length ? 'Choose a matching direction' : 'No matching directions'}</option>}
            {matches.map(item => <option key={item.id} value={item.id}>{item.name || 'Untitled direction'}</option>)}
          </select>
        </div>
        {!matches.length && <p className="section-empty">No matching directions.</p>}
        <button className="idea-new-direction" disabled={busy} onClick={addDirection}>+ Add direction</button>
      </nav>
      <div className="idea-scroll">
      <main className="idea-content">
        <header><p className="idea-eyebrow">PROGRESSION · MECHANIC IDEAS</p><h1>{draft.title}</h1><p>{draft.intro}</p><p className="idea-rule">{draft.rule}</p></header>
        {error && <div className="idea-notice" role="alert">{error} Your ideas remain in this view.</div>}
        {confirm && <div className="idea-notice" role="group" aria-label="Replace draft">
          <p>{confirm === 'reload' ? 'Discard unsaved changes and load the saved file?' : 'Replace unsaved changes with this snapshot?'}</p>
          <button disabled={busy} onClick={() => { if (confirm === 'reload') { setConfirm(null); setDeleted(null); void session.reload() } else loadSnapshot(confirm) }}>Replace draft</button>
          <button disabled={busy} onClick={() => setConfirm(null)}>Keep editing</button>
        </div>}
        {deleted && <div className="idea-notice" role="status">Mechanic deleted. <button disabled={busy} onClick={() => {
          edit(board => { board.sections.find(section => section.id === deleted.section)!.ideas.splice(deleted.index, 0, deleted.idea) }); selectDirection(deleted.section); setQuery(''); setDeleted(null)
        }}>Undo delete</button></div>}
        {history && <section className="idea-history" aria-label="Save history"><h2>Last five saves</h2><p>Loading opens a draft. Save to keep it.</p>
          {!book.snapshots.length && <p>No manual saves yet.</p>}
          {book.snapshots.map((snapshot, index) => <div key={snapshot.id}><span>{new Date(snapshot.savedAt).toLocaleString()}{index === 0 ? ' · Latest' : ''} · {snapshot.board.sections.reduce((sum, section) => sum + section.ideas.length, 0)} ideas</span><button disabled={busy} onClick={() => session.dirty() ? setConfirm(snapshot.id) : loadSnapshot(snapshot.id)}>Load as draft</button></div>)}
        </section>}
        <section className="idea-direction" key={section.id} aria-label={section.name || 'Untitled direction'}>
            <div className="idea-direction-title"><h2>{section.name || 'Untitled direction'}</h2><span>{section.ideas.length} {section.ideas.length === 1 ? 'idea' : 'ideas'}</span><button disabled={busy} onClick={() => setEditingDirection(!editingDirection)}>{editingDirection ? 'Done' : 'Edit direction'}</button></div>
            <div className="idea-section-body">
              {editingDirection ? <fieldset className="idea-card idea-direction-editor" aria-label="Direction details" disabled={busy}>
                <label>Direction name<input id={`${instance}-direction-name-${section.id}`} aria-label="Direction name" value={section.name} onChange={event => edit(board => { board.sections.find(item => item.id === section.id)!.name = event.target.value })} placeholder="Direction name" /></label>
                <label>Description <span>(optional)</span><textarea aria-label="Direction description (optional)" rows={2} value={section.scope} onChange={event => edit(board => { board.sections.find(item => item.id === section.id)!.scope = event.target.value })} placeholder="What kinds of mechanics belong here?" /></label>
              </fieldset> : section.scope && <p className="idea-scope">{section.scope}</p>}
              {!section.ideas.length && <p className="idea-empty">No ideas yet. Start with a name or describe the mechanic.</p>}
              {section.ideas.map(idea => editingIdeaId === idea.id ? <fieldset key={idea.id} className="idea-card" disabled={busy} aria-label={idea.name || 'Untitled mechanic'}>
                <div className="idea-card-heading"><strong>Edit mechanic</strong><button aria-label={`Done editing ${idea.name || 'Untitled mechanic'}`} onClick={() => {
                  setEditingIdeaId(null)
                  requestAnimationFrame(() => document.getElementById(`${instance}-idea-edit-${idea.id}`)?.focus())
                }}>Done</button></div>
                <label>Name<input aria-label="Name" id={`${instance}-idea-name-${idea.id}`} value={idea.name} onChange={event => updateIdea(idea.id, 'name', event.target.value)} placeholder="Mechanic name" /></label>
                <label>Description<textarea aria-label="Description" rows={3} value={idea.description} onChange={event => updateIdea(idea.id, 'description', event.target.value)} placeholder="What does it do?" /></label>
                <label>Notes <span>(optional)</span><textarea aria-label="Notes (optional)" rows={2} value={idea.notes} onChange={event => updateIdea(idea.id, 'notes', event.target.value)} placeholder="Questions, variations, possible values…" /></label>
                <div className="idea-card-actions"><label>Direction<select aria-label="Direction" value={section.id} onChange={event => move(idea.id, event.target.value)}>{draft.sections.map(target => <option key={target.id} value={target.id}>{target.name || 'Untitled direction'}</option>)}</select></label><button onClick={() => add(section.id, idea)}>Duplicate</button><button onClick={() => {
                  setDeleted({ idea: clone(idea), section: section.id, index: section.ideas.findIndex(item => item.id === idea.id) })
                  edit(board => { board.sections.find(item => item.id === section.id)!.ideas = section.ideas.filter(item => item.id !== idea.id) })
                }}>Delete</button></div>
              </fieldset> : <article key={idea.id} className="idea-card idea-card-summary" aria-label={idea.name || 'Untitled mechanic'}>
                <div className="idea-card-heading"><h3>{idea.name || 'Untitled mechanic'}</h3><button id={`${instance}-idea-edit-${idea.id}`} disabled={busy} aria-label={`Edit ${idea.name || 'Untitled mechanic'}`} onClick={() => { setEditingIdeaId(idea.id); focus(idea.id) }}>Edit</button></div>
                {idea.description && <p>{idea.description}</p>}
              </article>)}
              <button className="idea-add" disabled={busy} onClick={() => add(section.id)}>+ Add mechanic</button>
            </div>
        </section>
        <p className="idea-footnote">Save manually when ready. Switching sections keeps your draft in this app session. Specific mechanics remain proposals until selected for implementation.</p>
      </main>
      </div>
    </div>
  </section>
}
