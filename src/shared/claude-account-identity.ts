export type ClaudeAccountIdentity = {
  email?: string | null
  organizationUuid?: string | null
  managedAuthRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
}

export function claudeAccountIdentityKey(account: ClaudeAccountIdentity): string | null {
  const email = account.email?.trim().toLowerCase()
  if (!email) {
    return null
  }
  return JSON.stringify([
    email,
    account.organizationUuid?.trim() || null,
    account.managedAuthRuntime ?? 'host',
    account.managedAuthRuntime === 'wsl' ? account.wslDistro?.trim() || '__default__' : null
  ])
}
