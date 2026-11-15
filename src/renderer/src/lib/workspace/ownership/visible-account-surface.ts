import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../../shared/execution-host'
import { getRepoMainWorktreeId } from '../../../../../shared/worktree/id'
import { pendingCreationOpensNativeChat } from '../creation/pending-worktree-creation'
import { selectWorktreeCreationSurfaceShown } from '../creation/worktree-creation-surface'
import {
  resolveIndexedRepoOwner,
  resolveQualifiedIndexedRepoOwnerForHost,
  findIndexedRepoOwnerForHost
} from './repo-owner-index'
import { getResolvedExecutionHostIdForWorktree } from './resolved-worktree-execution-host'
import type { AppState } from '@/store/types'
import type { Tab, TabGroup } from '../../../../../shared/tab-types'
import type { WorktreeRuntimeOwnerState } from './worktree-runtime-owner-state'

export type VisibleAccountSurfaceState = WorktreeRuntimeOwnerState &
  Pick<AppState, 'activeView' | 'activePendingCreationId' | 'pendingWorktreeCreations'> & {
    activeGroupIdByWorktree?: Record<string, string>
    groupsByWorktree?: Record<string, readonly Pick<TabGroup, 'id' | 'activeTabId'>[]>
    unifiedTabsByWorktree?: Record<string, readonly Pick<Tab, 'id' | 'executionHostId'>[]>
  }

export type AccountSurfaceOwner = {
  hostId: ExecutionHostId | null
  sourceWorktreeId?: string
}

export function pendingChatAccountOwner(
  state: VisibleAccountSurfaceState,
  creationId: string
): AccountSurfaceOwner {
  const entry = state.pendingWorktreeCreations[creationId]
  if (!entry) {
    return { hostId: null }
  }
  const request = entry.request
  const explicit = request.executionHostId ?? request.workspaceRunContext?.hostId
  const repo = explicit
    ? resolveQualifiedIndexedRepoOwnerForHost(state.repos, request.repoId, explicit)
    : resolveIndexedRepoOwner(state.repos, request.repoId)
  const hostId = explicit ?? (repo.kind === 'resolved' ? getRepoExecutionHostId(repo.owner) : null)
  const source =
    hostId && repo.kind === 'resolved'
      ? findIndexedRepoOwnerForHost(state.repos, request.repoId, hostId)
      : null
  return {
    hostId,
    ...(source?.path
      ? { sourceWorktreeId: getRepoMainWorktreeId({ id: source.id, path: source.path }) }
      : {})
  }
}

/** Undefined means no visible workspace; null means visible but ownership is unproven. */
export function visibleAccountHostId(
  state: VisibleAccountSurfaceState
): ExecutionHostId | null | undefined {
  const creationId = state.activePendingCreationId
  if (creationId && selectWorktreeCreationSurfaceShown(state)) {
    const entry = state.pendingWorktreeCreations[creationId]
    if (entry && pendingCreationOpensNativeChat(entry)) {
      return pendingChatAccountOwner(state, creationId).hostId
    }
  }
  const workspaceId = state.activeWorktreeId
  if (!workspaceId) {
    return undefined
  }
  if (state.activeView === 'terminal') {
    const groupId = state.activeGroupIdByWorktree?.[workspaceId]
    const group = state.groupsByWorktree?.[workspaceId]?.find((row) => row.id === groupId)
    const tab = state.unifiedTabsByWorktree?.[workspaceId]?.find(
      (row) => row.id === group?.activeTabId
    )
    if (tab?.executionHostId) {
      return tab.executionHostId
    }
  }
  return getResolvedExecutionHostIdForWorktree(state, workspaceId)
}
