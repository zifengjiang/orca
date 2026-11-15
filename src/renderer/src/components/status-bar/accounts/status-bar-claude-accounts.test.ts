import { describe, expect, it } from 'vitest'
import type {
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../../../../shared/managed-account-types'
import {
  buildClaudeStatusSwitchGroups,
  signedInClaudeAccountCount
} from './status-bar-claude-accounts'

const ORG = 'org-eng'
const HOST = { runtime: 'host', wslDistro: null } as const

function account(
  id: string,
  email: string,
  extra: Partial<ClaudeManagedAccountSummary> = {}
): ClaudeManagedAccountSummary {
  return {
    id,
    email,
    organizationUuid: `${ORG}-${email}`,
    managedAuthRuntime: 'host',
    wslDistro: null,
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...extra
  }
}

// Same identity (email + org + host scope) saved as three records, as on the reporter's machine.
function rosterWithDuplicates(activeId: string): ClaudeRateLimitAccountsState {
  const eng = { organizationUuid: ORG }
  return {
    accounts: [
      account('own-login', 'eng@example.com', { ...eng, updatedAt: 30 }),
      account('borrowed', 'eng@example.com', { ...eng, runsOnSystemDefault: true, updatedAt: 10 }),
      account('resigned', 'ENG@example.com', { ...eng, updatedAt: 40 }),
      account('other', 'other@example.com', { updatedAt: 20 }),
      account('gone', 'gone@example.com', { needsSignIn: true, updatedAt: 5 })
    ],
    activeAccountId: activeId,
    activeAccountIdsByRuntime: { host: activeId, wsl: {} },
    systemDefaultEmail: 'eng@example.com',
    systemDefaultOrganizationUuid: ORG
  }
}

function hostRows(state: ClaudeRateLimitAccountsState) {
  return buildClaudeStatusSwitchGroups(state, HOST)[0].targets.filter((t) => t.id !== null)
}

describe('Claude status switcher identities', () => {
  it('shows one row per account even when several records hold the same login', () => {
    const rows = hostRows(rosterWithDuplicates('borrowed'))
    const engRows = rows.filter((row) => row.label.toLowerCase() === 'eng@example.com')
    expect(engRows).toHaveLength(1)
    // The selected record stays the row, so the panel's sign-in state describes what launches use.
    expect(engRows[0]).toMatchObject({ id: 'borrowed', active: true })
    expect(rows.map((row) => row.id)).toEqual(['borrowed', 'other', 'gone'])
  })

  it('represents an unselected duplicated account by its own signed-in record', () => {
    const rows = hostRows(rosterWithDuplicates('other'))
    const engRows = rows.filter((row) => row.label.toLowerCase() === 'eng@example.com')
    expect(engRows).toEqual([expect.objectContaining({ id: 'resigned', active: false })])
  })

  it('hides a signed-out record whose account is signed in through another record', () => {
    const state = rosterWithDuplicates('other')
    state.accounts.push(
      account('stale', 'eng@example.com', { organizationUuid: ORG, needsSignIn: true })
    )
    const rows = hostRows(state)
    expect(rows.find((row) => row.id === 'stale')).toBeUndefined()
    expect(rows.find((row) => row.id === 'gone')).toMatchObject({ needsSignIn: true })
  })

  it('keeps same-email accounts in different organizations apart', () => {
    const state = rosterWithDuplicates('other')
    state.accounts.push(account('team', 'eng@example.com', { organizationUuid: 'org-team' }))
    expect(
      hostRows(state).filter((row) => row.label.toLowerCase() === 'eng@example.com')
    ).toHaveLength(2)
  })

  it('counts signed-in accounts, not saved records', () => {
    // eng (3 records + System default) and other; gone is signed out.
    expect(signedInClaudeAccountCount(rosterWithDuplicates('other'))).toBe(2)
  })
  it('preserves selected sign-out state while attributing usage to the usable identity record', () => {
    const state = rosterWithDuplicates('stale')
    state.accounts.push(
      account('stale', 'eng@example.com', { organizationUuid: ORG, needsSignIn: true })
    )
    expect(hostRows(state).filter((row) => row.label.toLowerCase() === 'eng@example.com')).toEqual([
      expect.objectContaining({
        id: 'stale',
        active: true,
        needsSignIn: true,
        usageAccountId: 'resigned',
        usableAccountId: 'resigned'
      })
    ])
  })

  it('keeps host and WSL identities separate and preserves system-default metadata', () => {
    const state = rosterWithDuplicates('other')
    state.accounts.push(
      account('ubuntu', 'eng@example.com', {
        organizationUuid: ORG,
        managedAuthRuntime: 'wsl',
        wslDistro: 'Ubuntu'
      })
    )
    const groups = buildClaudeStatusSwitchGroups(state, HOST)
    expect(groups[1].targets.find((row) => row.id === 'ubuntu')).toMatchObject({
      runtimeTarget: { runtime: 'wsl', wslDistro: 'Ubuntu' }
    })
    expect(signedInClaudeAccountCount(state)).toBe(2)
  })
})
