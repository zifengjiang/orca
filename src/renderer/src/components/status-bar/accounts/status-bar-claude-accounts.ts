import { claudeAccountIdentityKey } from '../../../../../shared/claude-account-identity'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../../../shared/managed-account-types'
import { translate } from '@/i18n/i18n'
import {
  getCodexStatusRuntimeKey,
  getCodexStatusRuntimeLabel,
  getCodexStatusWslKey,
  type ClaudeStatusSwitchGroup,
  type CodexStatusRuntimeTarget,
  type StatusSwitchGroupOptions
} from './status-bar-runtime-targets'

type ClaudeStatusAccount = ClaudeRateLimitAccountsState['accounts'][number]

function accountIdentities(accounts: ClaudeStatusAccount[], activeId: string | null) {
  const identities = new Map<
    string,
    {
      selected?: ClaudeStatusAccount
      representative: ClaudeStatusAccount
      usable?: ClaudeStatusAccount
    }
  >()
  const prefer = (left: ClaudeStatusAccount, right: ClaudeStatusAccount) =>
    Number(!!left.runsOnSystemDefault) - Number(!!right.runsOnSystemDefault) ||
    right.updatedAt - left.updatedAt ||
    left.id.localeCompare(right.id)
  for (const account of accounts) {
    const key = claudeAccountIdentityKey(account) ?? `record:${account.id}`
    const current = identities.get(key) ?? { representative: account }
    if (account.id === activeId) {
      current.selected = account
    }
    if (!account.needsSignIn && (!current.usable || prefer(account, current.usable) < 0)) {
      current.usable = account
    }
    if (prefer(account, current.representative) < 0) {
      current.representative = account
    }
    identities.set(key, current)
  }
  return [...identities.values()]
}

function getSingleConcreteClaudeWslDistro(state: ClaudeRateLimitAccountsState): string | null {
  const keys = new Set<string>()
  for (const [key, accountId] of Object.entries(state.activeAccountIdsByRuntime?.wsl ?? {})) {
    if (accountId && key !== '__default__') {
      keys.add(key)
    }
  }
  for (const account of state.accounts) {
    const key = getCodexStatusWslKey(account.wslDistro)
    if (account.managedAuthRuntime === 'wsl' && key !== '__default__') {
      keys.add(key)
    }
  }
  return keys.size === 1 ? Array.from(keys)[0] : null
}

export function normalizeClaudeStatusRuntimeTarget(
  state: ClaudeRateLimitAccountsState,
  target: CodexStatusRuntimeTarget
): CodexStatusRuntimeTarget {
  if (target.runtime !== 'wsl' || target.wslDistro) {
    return target
  }
  const concreteDistro = getSingleConcreteClaudeWslDistro(state)
  return concreteDistro ? { runtime: 'wsl', wslDistro: concreteDistro } : target
}

export function getClaudeStatusActiveId(
  state: ClaudeRateLimitAccountsState,
  target: CodexStatusRuntimeTarget
): string | null {
  const selection = state.activeAccountIdsByRuntime
  if (target.runtime === 'host') {
    return selection?.host ?? state.activeAccountId ?? null
  }
  const distroSelection = selection?.wsl?.[getCodexStatusWslKey(target.wslDistro)]
  if (target.wslDistro || distroSelection) {
    return distroSelection ?? null
  }
  const selectedIds = Array.from(new Set(Object.values(selection?.wsl ?? {}).filter(Boolean)))
  return selectedIds.length === 1 ? selectedIds[0] : null
}

function getClaudeStatusAccountsForTarget(
  state: ClaudeRateLimitAccountsState,
  target: CodexStatusRuntimeTarget
): ClaudeStatusAccount[] {
  if (target.runtime === 'host') {
    return state.accounts.filter((account) => account.managedAuthRuntime !== 'wsl')
  }
  return state.accounts.filter(
    (account) =>
      account.managedAuthRuntime === 'wsl' &&
      getCodexStatusWslKey(account.wslDistro) === getCodexStatusWslKey(target.wslDistro)
  )
}

export function buildClaudeStatusSwitchGroups(
  state: ClaudeRateLimitAccountsState,
  currentTarget: CodexStatusRuntimeTarget,
  options: StatusSwitchGroupOptions = {}
): ClaudeStatusSwitchGroup[] {
  const groups: ClaudeStatusSwitchGroup[] = []
  const normalizedCurrentTarget = normalizeClaudeStatusRuntimeTarget(state, currentTarget)
  const makeGroup = (target: CodexStatusRuntimeTarget): ClaudeStatusSwitchGroup => {
    const activeId = getClaudeStatusActiveId(state, target)
    const accountsForTarget = getClaudeStatusAccountsForTarget(state, target)
    const identities = accountIdentities(accountsForTarget, activeId)
    return {
      key: getCodexStatusRuntimeKey(target),
      label: getCodexStatusRuntimeLabel(target, options.hostLabel),
      runtimeTarget: target,
      targets: [
        {
          id: null,
          label: translate('auto.components.status.bar.StatusBar.c676918adc', 'System default'),
          active: activeId === null,
          runtimeTarget: target
        },
        ...identities.map(({ selected, representative, usable }) => {
          const account = selected ?? usable ?? representative
          const signedOut = !!account.needsSignIn
          const organization =
            account.organizationName?.trim() ||
            (account.organizationUuid?.trim()
              ? translate('accounts.claude.organizationSuffix', 'Organization ···{{suffix}}', {
                  suffix: account.organizationUuid.trim().slice(-4)
                })
              : translate('accounts.claude.personalOrganization', 'Personal'))
          return {
            id: account.id,
            usageAccountId: usable?.id ?? account.id,
            usableAccountId: usable?.id ?? null,
            label: account.email,
            active: selected !== undefined,
            runtimeTarget: target,
            detail: [
              signedOut
                ? translate('auto.components.status.bar.StatusBar.signedOutAccounts', 'Signed out')
                : null,
              organization,
              target.runtime === 'wsl' ? getCodexStatusRuntimeLabel(target) : null
            ]
              .filter(Boolean)
              .join(' · '),
            ...(signedOut
              ? {
                  disabled: true,
                  needsSignIn: true,
                  hint: translate(
                    'accounts.claude.signInRequired',
                    'Sign in again to use this account'
                  )
                }
              : {})
          }
        })
      ]
    }
  }

  groups.push(makeGroup({ runtime: 'host', wslDistro: null }))

  const wslKeys = new Set<string>(Object.keys(state.activeAccountIdsByRuntime?.wsl ?? {}))
  if (normalizedCurrentTarget.runtime === 'wsl') {
    wslKeys.add(getCodexStatusWslKey(normalizedCurrentTarget.wslDistro))
  }
  for (const account of state.accounts) {
    if (account.managedAuthRuntime === 'wsl') {
      wslKeys.add(getCodexStatusWslKey(account.wslDistro))
    }
  }
  if (options.includeFallbackWsl) {
    wslKeys.add(getCodexStatusWslKey(options.fallbackWslDistro))
  }
  if (currentTarget.runtime === 'wsl' && currentTarget.wslDistro === null) {
    const concreteDistro = getSingleConcreteClaudeWslDistro(state)
    if (concreteDistro) {
      wslKeys.delete('__default__')
    }
  }

  for (const key of Array.from(wslKeys).sort((a, b) => {
    if (a === '__default__') {
      return -1
    }
    if (b === '__default__') {
      return 1
    }
    return a.localeCompare(b)
  })) {
    groups.push(makeGroup({ runtime: 'wsl', wslDistro: key === '__default__' ? null : key }))
  }

  return groups
}

export type ClaudeAccountSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountIdsByRuntime'
  | 'activeClaudeManagedAccountId'
>

function getClaudeStatusAccountsFromSettings(
  settings: ClaudeAccountSettings | null | undefined,
  runtimeState: ClaudeRateLimitAccountsState
): ClaudeRateLimitAccountsState | null {
  if (!settings) {
    return null
  }
  // Why: settings carry the fresh selection; host rows own what only the host reads (login, cover).
  const hostRows = new Map(runtimeState.accounts.map((account) => [account.id, account]))
  return {
    ...runtimeState,
    accounts: settings.claudeManagedAccounts
      .map(
        (account): ClaudeStatusAccount =>
          hostRows.get(account.id) ?? {
            id: account.id,
            email: account.email,
            managedAuthRuntime: account.managedAuthRuntime ?? 'host',
            wslDistro: account.wslDistro ?? null,
            authMethod: account.authMethod ?? 'unknown',
            organizationUuid: account.organizationUuid ?? null,
            organizationName: account.organizationName ?? null,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            lastAuthenticatedAt: account.lastAuthenticatedAt
          }
      )
      .sort((a, b) => b.updatedAt - a.updatedAt),
    activeAccountId:
      settings.activeClaudeManagedAccountIdsByRuntime?.host ??
      settings.activeClaudeManagedAccountId ??
      null,
    activeAccountIdsByRuntime: {
      host:
        settings.activeClaudeManagedAccountIdsByRuntime?.host ??
        settings.activeClaudeManagedAccountId ??
        null,
      wsl: { ...settings.activeClaudeManagedAccountIdsByRuntime?.wsl }
    }
  }
}

// For remote ownership, desktop settings cannot override the owner’s account snapshot.

/** `ownerEnvironmentId` is the server owning the shown accounts; `null` is this desktop. */
export function resolveClaudeStatusAccountState(
  settings: ClaudeAccountSettings | null | undefined,
  runtimeState: ClaudeRateLimitAccountsState,
  ownerEnvironmentId: string | null
): ClaudeRateLimitAccountsState {
  if (ownerEnvironmentId) {
    return runtimeState
  }
  return getClaudeStatusAccountsFromSettings(settings, runtimeState) ?? runtimeState
}

export function signedInClaudeAccountCount(state: ClaudeRateLimitAccountsState): number {
  const identities = new Set(
    state.accounts
      .filter(
        (account) =>
          account.managedAuthRuntime !== 'wsl' &&
          !account.needsSignIn &&
          !account.runsOnSystemDefault
      )
      .map((account) => claudeAccountIdentityKey(account) ?? `record:${account.id}`)
  )
  const systemDefault = claudeAccountIdentityKey({
    email: state.systemDefaultEmail,
    organizationUuid: state.systemDefaultOrganizationUuid
  })
  if (systemDefault) {
    identities.add(systemDefault)
  }
  return identities.size
}
