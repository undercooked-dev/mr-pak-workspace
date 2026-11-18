import type { WorkspaceMount } from '../types'

/** Narrows the card list to one mounted project. `value` is a mount id, or '' for all. */
export default function ProjectFilter({ projects, value, onChange }: {
  projects: WorkspaceMount[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <span className="project-filter">
      <select value={value} onChange={ev => onChange(ev.target.value)} aria-label="Show cards from project">
        <option value="">All projects</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </span>
  )
}
