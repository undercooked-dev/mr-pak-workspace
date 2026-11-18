import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceEntity, WorkspaceMount, WorkspaceState } from '../types'
import { api, isDesktop, useDesktop } from '../desktop/client'

const POLL_MS = 30_000
const ARCHIVE_DAYS = 7
const PROJECT_KEY = 'mrmak.workspaceProject'

/** The mounted projects that have cards in this registry, by name. Home cards belong to none. */
export function cardProjects(entities: WorkspaceEntity[]): WorkspaceMount[] {
  const found = new Map<string, string>()
  for (const e of entities) if (e.mount && !found.has(e.mount)) found.set(e.mount, e.project || e.mount)
  return [...found]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

function readLocalProject(): string {
  try { return localStorage.getItem(PROJECT_KEY) || '' } catch { return '' }
}

function saveLocalProject(id: string) {
  try {
    if (id) localStorage.setItem(PROJECT_KEY, id)
    else localStorage.removeItem(PROJECT_KEY)
  } catch { /* The choice still applies to this window. */ }
}

/**
 * The card list's remembered project filter: a mount id, or '' for all projects.
 * The desktop app keeps it in the service's settings, so it outlives a restart (the UI's
 * origin, and with it localStorage, changes every launch). localStorage is the fallback for
 * the browser preview, a failed save, and a service that does not know the setting.
 */
export function useProjectFilter(): [string, (id: string) => void] {
  const { settings } = useDesktop()
  const saved = isDesktop && typeof settings.workspaceProject === 'string' ? settings.workspaceProject : undefined
  const [choice, setChoice] = useState(() => saved ?? readLocalProject())
  // A choice saved by another window arrives with the settings broadcast. The service drops the
  // setting for "all projects", which that window also cleared from the shared localStorage.
  const [seen, setSeen] = useState(saved)
  if (saved !== seen) {
    setSeen(saved)
    setChoice(saved ?? readLocalProject())
  }
  const choose = useCallback((id: string) => {
    setChoice(id)
    saveLocalProject(id)
    if (isDesktop) api('/settings', { workspaceProject: id }).catch(() => { /* localStorage keeps it. */ })
  }, [])
  return [choice, choose]
}

export type EntityPatch = Partial<Pick<WorkspaceEntity, 'status' | 'category' | 'pinned'>>

export async function updateWorkspaceEntity(id: string, patch: EntityPatch) {
  const route = `/workspace/entities/${encodeURIComponent(id)}`
  if (!isDesktop) throw new Error('Open the desktop app to edit Workspace cards.')
  await api(route, patch, 'PATCH')
  window.dispatchEvent(new Event('mrmak-workspace-changed'))
}

export function archiveCutoff(): string {
  const d = new Date()
  d.setDate(d.getDate() - ARCHIVE_DAYS)
  return d.toISOString().slice(0, 10)
}

/**
 * Loads workspace.json and keeps it fresh: refetch on window focus /
 * visibility and a light poll while the tab is visible. State only
 * changes when the file content actually changed, so re-renders are
 * cheap. A failed fetch (or a mid-write half-file from an agent)
 * flips `offline` and keeps the last good data.
 */
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [offline, setOffline] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const rawRef = useRef('')

  const reload = useCallback(async () => {
    try {
      const res = isDesktop ? null : await fetch('/workspace/workspace.json', { cache: 'no-store' })
      if (res && !res.ok) throw new Error(`HTTP ${res.status}`)
      const text = res ? await res.text() : JSON.stringify(await api<WorkspaceState>('/workspace'))
      if (text !== rawRef.current) {
        const parsed = JSON.parse(text) as WorkspaceState
        rawRef.current = text
        setWorkspace(parsed)
      }
      setOffline(false)
      setLastSync(new Date())
    } catch {
      setOffline(true)
      setWorkspace(w => w ?? { entities: [] })
    }
  }, [])

  useEffect(() => {
    // Initial fetch — every setState inside reload happens after an await,
    // never synchronously, so cascading-render concerns don't apply here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
    const refresh = () => {
      if (document.visibilityState === 'visible') reload()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('mrmak-workspace-changed', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, POLL_MS)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('mrmak-workspace-changed', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(timer)
    }
  }, [reload])

  return { workspace, offline, lastSync, reload }
}
