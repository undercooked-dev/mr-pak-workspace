import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../desktop/client'
import { entityHash } from '../lib/route'
import type { WorkspaceEntity, WorkspaceMount } from '../types'
import type { CardTemplate } from '../../desktop/service/card-schema.mjs'
import '../styles/editable-cards.css'

// With mounted projects the card is created inside one of them; without, in the home Workspace.
function NewCardDialog({ mounts, project, onClose }: { mounts: WorkspaceMount[]; project: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(''), [template, setTemplate] = useState<CardTemplate>('gallery')
  const [mount, setMount] = useState(project)
  // Settled when the dialog opens: one that asks for a project never falls back to the home Workspace.
  const [asksProject] = useState(mounts.length > 0)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  // The filter's project when it is still mounted, otherwise the first project.
  const target = mounts.find(item => item.id === mount) ?? mounts[0]
  const ready = !!title.trim() && (!asksProject || !!target)
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  async function create() {
    if (busy || !ready) return
    setBusy(true); setError('')
    try {
      const { entity } = await api<{ entity: WorkspaceEntity }>('/workspace/cards', asksProject && target ? { title, template, mount: target.id } : { title, template })
      window.dispatchEvent(new Event('mrmak-workspace-changed')); location.hash = entityHash(entity.id)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error)); setBusy(false)
      // A project may have gone; refresh the list so the choice offers the current ones.
      if (asksProject) window.dispatchEvent(new Event('mrmak-workspace-changed'))
    }
  }
  return createPortal(<dialog ref={dialog} className="new-card-dialog" aria-label="New Workspace card" onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onKeyDown={event => event.stopPropagation()}><form onSubmit={event => { event.preventDefault(); void create() }}>
    <div className="new-card-heading"><div><span>Create in Workspace</span><h2>A place for your next idea.</h2></div><button type="button" aria-label="Close new card" disabled={busy} onClick={onClose}>×</button></div>
    <label>Card title<input autoFocus required maxLength={200} placeholder="Character references, tool research…" value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
    {asksProject && <label className="new-card-project">Project<span className="new-card-select"><select required value={target?.id ?? ''} disabled={busy} onChange={event => setMount(event.target.value)}>{target ? mounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">No project is available</option>}</select></span></label>}
    <fieldset disabled={busy} className="new-card-templates"><legend>Choose a starting view</legend>{(['gallery', 'research'] as const).map(value => <label key={value} className={template === value ? 'selected' : ''}><input type="radio" name="template" value={value} checked={template === value} onChange={() => setTemplate(value)} /><strong>{value === 'gallery' ? 'Gallery' : 'Research'}</strong><span>{value === 'gallery' ? 'Images, reference notes and saved prompts.' : 'Findings, source links and decisions.'}</span></label>)}</fieldset>
    <p className="new-card-hint">Edit it yourself or ask your agent to update it. You can switch views later.</p>
    {error && <p className="card-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="card-primary" disabled={busy || !ready}>{busy ? 'Creating…' : 'Create card'}</button></footer>
  </form></dialog>, document.body)
}

export default function NewCard({ mounts, project }: { mounts: WorkspaceMount[]; project: string }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return <><button ref={button} className="new-card-button" onClick={() => setOpen(true)}>+ New card</button>{open && <NewCardDialog mounts={mounts} project={project} onClose={() => { setOpen(false); button.current?.focus() }} />}</>
}
