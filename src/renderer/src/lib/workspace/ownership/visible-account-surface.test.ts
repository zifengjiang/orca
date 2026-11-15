import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { visibleAccountHostId, pendingChatAccountOwner } from './visible-account-surface'
import type { VisibleAccountSurfaceState } from './visible-account-surface'
import type { PendingWorktreeCreation } from '../creation/pending-worktree-creation'

const REMOTE_WORKTREE = 'remote-repo::/srv/app'
const LOCAL_WORKTREE = 'local-repo::/Users/me/app'

function state(overrides: Partial<VisibleAccountSurfaceState> = {}): VisibleAccountSurfaceState {
  return {
    runtimeEnvironments: [{ id: 'm4' }],
    runtimeEnvironmentCatalogHydrated: true,
    repos: [
      {
        id: 'remote-repo',
        path: '/srv/app',
        connectionId: null,
        executionHostId: 'runtime:m4'
      },
      {
        id: 'local-repo',
        path: '/Users/me/app',
        connectionId: null,
        executionHostId: 'local'
      }
    ],
    worktreesByRepo: {
      'remote-repo': [{ id: REMOTE_WORKTREE, repoId: 'remote-repo', hostId: 'runtime:m4' }],
      'local-repo': [{ id: LOCAL_WORKTREE, repoId: 'local-repo', hostId: 'local' }]
    },
    activeWorktreeId: REMOTE_WORKTREE,
    activeWorkspaceExecutionHostId: null,
    activeView: 'terminal',
    activePendingCreationId: null,
    pendingWorktreeCreations: {},
    ...overrides
  }
}

function pendingChat(repoId: string, hostId?: ExecutionHostId): PendingWorktreeCreation {
  return {
    creationId: 'c1',
    phase: 'creating',
    status: 'creating',
    startedAt: 1,
    indeterminate: false,
    loaderVisible: true,
    request: {
      agentLaunchRoute: 'structured-native-chat',
      agent: 'codex',
      repoId,
      name: 'Chat',
      setupDecision: 'skip',
      pendingFirstAgentMessageRename: false,
      note: '',
      startupPlan: null,
      quickPrompt: '',
      quickTelemetry: null,
      ...(hostId
        ? {
            workspaceRunContext: {
              kind: 'workspace-run',
              projectId: 'p',
              projectHostSetupId: 's',
              repoId,
              path: '/repo',
              hostId
            }
          }
        : {})
    }
  }
}

describe('visibleAccountHostId', () => {
  it('follows the selected workspace', () => {
    expect(visibleAccountHostId(state())).toBe('runtime:m4')
  })

  it('follows a new chat started on this computer over a selected remote workspace', () => {
    const shown = state({
      activePendingCreationId: 'c1',
      pendingWorktreeCreations: { c1: pendingChat('local-repo') }
    })
    expect(visibleAccountHostId(shown)).toBe('local')
  })

  it('follows a new chat started on a remote host over a selected local workspace', () => {
    const shown = state({
      activeWorktreeId: LOCAL_WORKTREE,
      activePendingCreationId: 'c1',
      pendingWorktreeCreations: { c1: pendingChat('local-repo', 'runtime:m4') }
    })
    expect(visibleAccountHostId(shown)).toBe('runtime:m4')
  })

  it('ignores a pending chat that is not on screen', () => {
    const hidden = state({
      activeView: 'settings',
      activePendingCreationId: 'c1',
      pendingWorktreeCreations: { c1: pendingChat('local-repo') }
    })
    expect(visibleAccountHostId(hidden)).toBe('runtime:m4')
  })
  it('does not infer local or the default remote for a visible missing owner', () => {
    const shown = state({
      settings: { activeRuntimeEnvironmentId: 'other-server' },
      activePendingCreationId: 'c1',
      pendingWorktreeCreations: { c1: pendingChat('missing') }
    })
    expect(visibleAccountHostId(shown)).toBeNull()
  })

  it('keeps direct SSH as a distinct owner without a paired RPC route', () => {
    const shown = state({
      activePendingCreationId: 'c1',
      pendingWorktreeCreations: { c1: pendingChat('local-repo', 'ssh:machine') }
    })
    expect(visibleAccountHostId(shown)).toBe('ssh:machine')
  })

  it('honors executionHostId before the source host and qualifies its checkout', () => {
    const pending = pendingChat('local-repo', 'runtime:m4')
    const shown = state({
      activePendingCreationId: 'c1',
      pendingWorktreeCreations: {
        c1: { ...pending, request: { ...pending.request, executionHostId: 'local' } }
      }
    })
    expect(pendingChatAccountOwner(shown, 'c1')).toEqual({
      hostId: 'local',
      sourceWorktreeId: 'local-repo::/Users/me/app'
    })
  })

  it('ignores a non-native pending creation and resumes the workspace on completion', () => {
    const pending = pendingChat('local-repo')
    expect(
      visibleAccountHostId(
        state({
          activePendingCreationId: 'c1',
          pendingWorktreeCreations: {
            c1: { ...pending, request: { ...pending.request, agentLaunchRoute: 'terminal-tui' } }
          }
        })
      )
    ).toBe('runtime:m4')
    expect(
      visibleAccountHostId(state({ activePendingCreationId: 'c1', pendingWorktreeCreations: {} }))
    ).toBe('runtime:m4')
  })

  it('routes by the focused split group instead of a sibling chat', () => {
    const shown = state({
      activeGroupIdByWorktree: { [REMOTE_WORKTREE]: 'right' },
      groupsByWorktree: {
        [REMOTE_WORKTREE]: [
          { id: 'left', activeTabId: 'a' },
          { id: 'right', activeTabId: 'b' }
        ]
      },
      unifiedTabsByWorktree: {
        [REMOTE_WORKTREE]: [
          { id: 'a', executionHostId: 'runtime:m4' },
          { id: 'b', executionHostId: 'local' }
        ]
      }
    })
    expect(visibleAccountHostId(shown)).toBe('local')
  })

  it('refuses ambiguous repo twins and resolves an explicit matching source', () => {
    const shown = state({
      activePendingCreationId: 'c1',
      pendingWorktreeCreations: { c1: pendingChat('twin') },
      repos: [
        { id: 'twin', path: '/local', executionHostId: 'local' },
        { id: 'twin', path: '/remote', executionHostId: 'runtime:m4' }
      ]
    })
    expect(visibleAccountHostId(shown)).toBeNull()
    shown.pendingWorktreeCreations.c1.request.executionHostId = 'runtime:m4'
    expect(pendingChatAccountOwner(shown, 'c1')).toEqual({
      hostId: 'runtime:m4',
      sourceWorktreeId: 'twin::/remote'
    })
  })
})
