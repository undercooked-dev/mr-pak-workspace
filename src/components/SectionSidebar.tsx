import { useId, useState } from 'react'
import type { WorkspaceEntity } from '../types'
import { workspaceNavigation } from '../lib/workspace-navigation'
import { entityHash } from '../lib/route'
import './section-sidebar.css'

export default function SectionSidebar({ entity, stepIndex, onStep }: {
  entity: WorkspaceEntity
  stepIndex: number
  onStep: (id: string, index: number) => void
}) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const selectId = useId()
  const { activeTab, sidebarSections } = workspaceNavigation(entity, stepIndex)
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = sidebarSections.filter(step => words.every(word => step.name.toLowerCase().includes(word)))
  const navigate = (index: number) => onStep(entity.id, index)

  return <nav className="section-sidebar" aria-label={`${activeTab} sections`}>
    <div className="section-search">
      <label htmlFor={searchId}>Find section</label>
      <div className="section-search-field">
        <input id={searchId} type="search" placeholder="Section name" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setQuery('') }
          if (event.key === 'Enter' && matches.length) { event.preventDefault(); navigate(matches[0].index) }
        }} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear section search">Clear</button>}
      </div>
      <p className="section-search-count" role="status">{query ? `${matches.length} of ${sidebarSections.length}` : sidebarSections.length} {sidebarSections.length === 1 ? 'section' : 'sections'}</p>
    </div>
    <div className="section-links">
      <h2>{activeTab}</h2>
      {matches.map(step => <a key={step.index} href={entityHash(entity.id, step.index)} aria-current={step.index === stepIndex ? 'page' : undefined} onClick={event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        event.preventDefault(); navigate(step.index)
      }}>{step.name}</a>)}
    </div>
    <div className="section-mobile">
      <label htmlFor={selectId}>{activeTab} section</label>
      <select id={selectId} value={matches.some(step => step.index === stepIndex) ? stepIndex : ''} disabled={!matches.length} onChange={event => navigate(Number(event.target.value))}>
        {!matches.some(step => step.index === stepIndex) && <option value="" disabled>{matches.length ? 'Choose a matching section' : 'No matching sections'}</option>}
        {matches.map(step => <option key={step.index} value={step.index}>{step.name}</option>)}
      </select>
    </div>
    {!matches.length && <p className="section-empty">No matching sections. Try another name.</p>}
  </nav>
}
