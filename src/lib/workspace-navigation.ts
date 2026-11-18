import type { WorkspaceEntity } from '../types'

/** Keep report indices stable while organizing their navigation independently. */
export function workspaceNavigation(entity: WorkspaceEntity | null, stepIndex: number) {
  const sections = (entity?.steps ?? []).map((step, index) => ({ ...step, index, group: step.group?.trim() || 'Other' }))
  const grouped = sections.some(step => step.group !== 'Other')
  const groups = grouped
    ? [...new Set([...(entity?.stepGroups ?? []), ...sections.map(step => step.group)])].filter(group => sections.some(step => step.group === group))
    : []
  const activeGroup = sections[stepIndex]?.group
  const groupSections = grouped ? sections.filter(step => step.group === activeGroup) : sections
  const tabbed = groupSections.some(step => step.tab?.trim())
  const tabName = (step: typeof sections[number]) => step.tab?.trim() || 'Overview'
  const tabs = tabbed
    ? [...new Set([...(entity?.stepTabs?.[activeGroup] ?? []), ...groupSections.map(tabName)])].filter(tab => groupSections.some(step => tabName(step) === tab))
    : []
  const activeTab = tabbed && sections[stepIndex] ? tabName(sections[stepIndex]) : undefined
  const sidebarSections = tabbed ? groupSections.filter(step => tabName(step) === activeTab) : []
  return { sections, grouped, groups, activeGroup, groupSections, tabs, activeTab, sidebarSections, tabName }
}
