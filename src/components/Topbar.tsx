import { useEffect, useRef } from 'react'
import type { WorkspaceEntity, WorkspaceMount } from '../types'
import { isDesktop } from '../desktop/client'
import BrowserSettings from './BrowserSettings'
import { EntityStatusButton } from './EntityControls'
import NewCard from './NewCard'
import { workspaceNavigation } from '../lib/workspace-navigation'

interface TopbarProps {
  entity: WorkspaceEntity | null
  stepIndex: number
  onStep: (id: string, index: number) => void
  onHome: () => void
  reportUrl: string | null
  /** Projects a new card can be created in; empty creates it in the home Workspace. */
  mounts: WorkspaceMount[]
  /** The card list's project filter (a mount id, or '' for all). */
  project: string
}

export default function Topbar({ entity, stepIndex, onStep, onHome, reportUrl, mounts, project }: TopbarProps) {
  const lastSections = useRef(new Map<string, number>())
  const sectionTabs = useRef<HTMLDivElement>(null)
  const { sections, grouped, groups, activeGroup, groupSections, tabs, activeTab, tabName } = workspaceNavigation(entity, stepIndex)

  useEffect(() => {
    if (entity && grouped && activeGroup) lastSections.current.set(JSON.stringify([entity.id, activeGroup]), stepIndex)
    if (entity && activeTab) lastSections.current.set(JSON.stringify([entity.id, activeGroup, activeTab]), stepIndex)
    const tabs = sectionTabs.current
    if (tabs && tabs.scrollHeight > tabs.clientHeight) tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [entity, grouped, activeGroup, activeTab, stepIndex])

  const openGroup = (group: string) => {
    if (!entity || group === activeGroup) return
    const previous = lastSections.current.get(JSON.stringify([entity.id, group]))
    const section = sections.find(step => step.group === group && step.index === previous)
      ?? sections.find(step => step.group === group)
    if (section) onStep(entity.id, section.index)
  }

  const openTab = (tab: string) => {
    if (!entity || tab === activeTab) return
    const previous = lastSections.current.get(JSON.stringify([entity.id, activeGroup, tab]))
    const section = groupSections.find(step => tabName(step) === tab && step.index === previous)
      ?? groupSections.find(step => tabName(step) === tab)
    if (section) onStep(entity.id, section.index)
  }

  return (
    <div className={`topbar${grouped ? ' topbar-grouped' : ''}`}>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <button className="crumb-link" onClick={onHome}>
          Workspace
        </button>
        {entity && (
          <>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{entity.title}</span>
            <EntityStatusButton entity={entity} />
          </>
        )}
        {!isDesktop && <BrowserSettings />}
        {isDesktop && <NewCard mounts={mounts} project={project} />}
      </nav>

      {entity && (
        <>
          {grouped && (
            <nav className="folder-tabs" aria-label="Workspace folders">
              {groups.map(group => (
                <button
                  key={group}
                  type="button"
                  className={`folder-tab${group === activeGroup ? ' active' : ''}`}
                  aria-pressed={group === activeGroup}
                  onClick={() => openGroup(group)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" /></svg>
                  <span>{group}</span>
                </button>
              ))}
            </nav>
          )}
          <div className="topbar-right">
            {entity.steps.length > 0 && (
              <div ref={sectionTabs} className="step-tabs" role="tablist" aria-label={tabs.length ? `${activeGroup} tabs` : grouped ? `${activeGroup} sections` : 'Report sections'}>
                {tabs.length ? tabs.map(tab => (
                  <button key={tab} role="tab" aria-selected={tab === activeTab} className={`step-tab${tab === activeTab ? ' active' : ''}`} onClick={() => openTab(tab)}>{tab}</button>
                )) : groupSections.map(s => (
                  <button
                    key={s.index}
                    role="tab"
                    aria-selected={s.index === stepIndex}
                    className={`step-tab${s.index === stepIndex ? ' active' : ''}`}
                    onClick={() => onStep(entity.id, s.index)}
                    title={s.name}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {reportUrl && (
              <a
                className="open-ext"
                href={reportUrl}
                target="_blank"
                rel="noreferrer"
                title="Open report in a new tab"
              >
                ↗
              </a>
            )}
          </div>
        </>
      )}
    </div>
  )
}
