import type { WorkspaceEntity, WorkspaceMount } from '../types'
import { categoryIcon } from '../lib/categories'
import MakCard from './MakCard'
import MakLogo from './MakLogo'
import ProjectFilter from './ProjectFilter'

interface HomeGridProps {
  entities: WorkspaceEntity[]
  pinned: WorkspaceEntity[]
  grouped: Map<string, WorkspaceEntity[]>
  offline: boolean
  searching: boolean
  query: string
  /** Mounted projects with cards; the filter shows when there are two or more. */
  projects: WorkspaceMount[]
  project: string
  projectName: string
  onProject: (id: string) => void
  /** Why some project cards could not be shown. */
  warnings: string[]
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Burning the midnight oil, sir?'
  if (h < 12) return 'Good morning, sir.'
  if (h < 18) return 'Good day, sir.'
  return 'Good evening, sir.'
}

export default function HomeGrid({
  entities,
  pinned,
  grouped,
  offline,
  searching,
  query,
  projects,
  project,
  projectName,
  onProject,
  warnings,
}: HomeGridProps) {
  const activeCount = entities.filter(e => e.status === 'active').length
  const categoryCount = new Set(entities.map(e => e.category || 'other')).size
  const shown = pinned.length + [...grouped.values()].reduce((n, list) => n + list.length, 0)

  return (
    <div className="home">
      <header className="home-hero">
        <MakLogo size={84} />
        <div>
          <h1 className="home-title">{greeting()}</h1>
          <p className="home-sub">
            <b>{activeCount}</b> active · <b>{entities.length}</b> entities ·{' '}
            <b>{categoryCount}</b> categories
            {offline && <span className="home-offline"> · workspace.json unreachable</span>}
          </p>
        </div>
      </header>

      {projects.length > 1 && (
        <div className="home-tools">
          <ProjectFilter projects={projects} value={project} onChange={onProject} />
        </div>
      )}

      {searching && (
        <p className="home-filter">
          {shown === 0 ? 'No matches for' : `${shown} match${shown === 1 ? '' : 'es'} for`}{' '}
          “{query.trim()}” — archive included{projectName && `, ${projectName} only`}
        </p>
      )}

      {warnings.length > 0 && (
        <details className="home-warnings">
          <summary>
            Some project cards could not be shown · {warnings.length}{' '}
            {warnings.length === 1 ? 'reason' : 'reasons'}
          </summary>
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      {pinned.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <span className="section-title">{'\u{1F4CC}'} pinned</span>
            <span className="section-count">{pinned.length}</span>
          </div>
          <div className="card-grid">
            {pinned.map(e => (
              <MakCard key={e.id} entity={e} />
            ))}
          </div>
        </section>
      )}

      {[...grouped.entries()].map(([cat, list]) => (
        <section key={cat} className="home-section">
          <div className="section-head">
            <span className="section-title">
              {categoryIcon(cat)} {cat.replace(/-/g, ' ')}
            </span>
            <span className="section-count">{list.length}</span>
          </div>
          <div className="card-grid">
            {list.map(e => (
              <MakCard key={e.id} entity={e} />
            ))}
          </div>
        </section>
      ))}

      {shown === 0 && !searching && (
        <div className="home-empty">
          {offline
            ? 'Could not load workspace.json — is the public/workspace link in place? Run npm run dev again, sir.'
            : projectName
              ? `Nothing from ${projectName} here yet, sir.`
              : 'Nothing here yet. New work will appear as cards, sir.'}
        </div>
      )}
    </div>
  )
}
