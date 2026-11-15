import { visibleAccountHostId } from '@/lib/workspace/ownership/visible-account-surface'
import { selectExecutionHostDisplayLabel } from '@/runtime/hosts/display/execution-host-display-label'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { runtimeTargetEnvironmentId } from '@/runtime/rpc/targets/runtime-client-target'
import {
  watchProviderAccounts,
  type ProviderAccountsSnapshot
} from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { useActiveAccountOwner } from '@/runtime/provider-accounts/ownership/use-active-account-owner'
import type { RateLimitState } from '../../../../../shared/rate-limit-types'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { useAppStore } from '../../../store/index'
import {
  resolveOwnerUsageRateLimits,
  type OwnerUsageFailureReason,
  type OwnerUsageState
} from './owner-usage-rate-limits'

// Why: accounts.list({refreshUsage}) waits for the host's provider fetches.
const REMOTE_USAGE_REFRESH_TIMEOUT_MS = 30_000
// Matches the desktop's own usage poll cadence.
const REMOTE_USAGE_STALE_REOPEN_MS = 5 * 60_000
const REMOTE_USAGE_RECONNECT_DELAY_MS = 5_000
const LOCAL_TARGET: RuntimeClientTarget = { kind: 'local' }

/** A snapshot only counts under the owner it came from, so A's numbers never render as B's. */
type OwnedUsage = {
  ownerId: string
  rateLimits: RateLimitState | null
  failure: OwnerUsageFailureReason | null
}

/** A remote host (SSH-managed server or paired Orca) that owns the shown usage. */
export type RemoteUsageOwner = {
  environmentId: string | null
  label: string
}

/** The Settings host that owns the shown usage, so its accounts open beside the bar's numbers. */
export function getUsageOwnerHostScope(
  remoteOwner: RemoteUsageOwner | null
): RuntimeClientTarget | null {
  return remoteOwner
    ? remoteOwner.environmentId
      ? { kind: 'environment', environmentId: remoteOwner.environmentId }
      : null
    : LOCAL_TARGET
}

export type OwnerUsageRateLimits = {
  rateLimits: RateLimitState
  /** Null when this device owns the shown usage. */
  remoteOwner: RemoteUsageOwner | null
  /** Forces the owning host to re-read usage; null when this device owns it. */
  refreshRemote: (() => Promise<void>) | null
}

/** Read provider usage from the focused workspace’s account owner, including that host’s own remote snapshot. */
export function useOwnerUsageRateLimits(local: RateLimitState): OwnerUsageRateLimits {
  const t = useTranslate()
  const languageRevision = useUiLanguageRevision()
  // Why: route by the focused workspace's owner, never by the Active Server setting.
  const accountOwner = useActiveAccountOwner(LOCAL_TARGET)
  const unavailable = accountOwner === null
  const ownerId = accountOwner ? runtimeTargetEnvironmentId(accountOwner.target) : null
  const unavailableLabel = useAppStore((s) => {
    const host = visibleAccountHostId(s)
    return host ? selectExecutionHostDisplayLabel(s, host) : null
  })
  const ownerName = useAppStore(
    (s) => s.runtimeEnvironments.find((environment) => environment.id === ownerId)?.name ?? null
  )
  const [owned, setOwned] = useState<OwnedUsage | null>(null)
  const ownedRef = useRef<OwnedUsage | null>(null)

  const apply = useCallback((next: OwnedUsage) => {
    ownedRef.current = next
    setOwned(next)
  }, [])

  // Why: losing contact must not erase what the host already vouched for.
  const fail = useCallback(
    (owner: string, failure: OwnerUsageFailureReason) => {
      const current = ownedRef.current
      apply({
        ownerId: owner,
        rateLimits: current?.ownerId === owner ? current.rateLimits : null,
        failure
      })
    },
    [apply]
  )

  const applySnapshot = useCallback(
    (owner: string, snapshot: ProviderAccountsSnapshot) => {
      if (snapshot.rateLimits) {
        apply({ ownerId: owner, rateLimits: snapshot.rateLimits, failure: null })
      } else {
        // Why: a host that predates published usage answers without it; say so, never spin.
        fail(owner, 'usage-not-published')
      }
    },
    [apply, fail]
  )

  const ownerIdRef = useRef({ ownerId })
  useEffect(() => {
    ownerIdRef.current = { ownerId }
  }, [ownerId])
  // Why: bumping reopens the stream; each open makes the host refresh stale usage.
  const [streamGeneration, setStreamGeneration] = useState(0)

  useEffect(() => {
    if (!ownerId) {
      return
    }
    let active = true
    const reopen = (): void => setStreamGeneration((value) => value + 1)
    // Why: older hosts never poll for a paired stream, so a long-lived one would freeze the meters.
    const staleTimer = setTimeout(reopen, REMOTE_USAGE_STALE_REOPEN_MS)
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    const lost = (): void => {
      if (active) {
        fail(ownerId, 'unreachable')
        clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(reopen, REMOTE_USAGE_RECONNECT_DELAY_MS)
      }
    }
    const watcher = watchProviderAccounts(
      { kind: 'environment', environmentId: ownerId },
      {
        onSnapshot: (snapshot) => {
          if (active) {
            applySnapshot(ownerId, snapshot)
          }
        },
        // Why: timeout, closed stream and RPC failure all mean the owner's usage is unverifiable.
        onError: lost,
        onClosedAfterSnapshot: lost
      }
    )
    return () => {
      active = false
      clearTimeout(staleTimer)
      clearTimeout(reconnectTimer)
      watcher.close()
    }
  }, [ownerId, streamGeneration, applySnapshot, fail])

  const refreshRemote = useCallback(async () => {
    if (!ownerId) {
      return
    }
    const activation = ownerIdRef.current
    try {
      const snapshot = await callRuntimeRpc<ProviderAccountsSnapshot>(
        { kind: 'environment', environmentId: ownerId },
        'accounts.list',
        { refreshUsage: true },
        { timeoutMs: REMOTE_USAGE_REFRESH_TIMEOUT_MS }
      )
      // Why: a refresh that outlives an owner switch must not overwrite the new owner's usage.
      if (ownerIdRef.current === activation && activation.ownerId === ownerId) {
        applySnapshot(ownerId, snapshot)
      }
    } catch {
      // Why: a slow forced refresh is not loss of contact; the stream owns reachability.
    }
  }, [ownerId, applySnapshot])

  const remoteOwner = useMemo<RemoteUsageOwner | null>(
    () =>
      unavailable || ownerId
        ? {
            environmentId: ownerId,
            label:
              unavailableLabel ||
              ownerName?.trim() ||
              t('auto.components.status.bar.StatusBar.remoteServerLabel', 'Remote server')
          }
        : null,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- translate() reads the UI language implicitly.
    [ownerId, ownerName, unavailableLabel, unavailable, languageRevision, t]
  )

  const ownerState = useMemo<OwnerUsageState>(() => {
    if (!remoteOwner) {
      return { kind: 'local' }
    }
    if (unavailable) {
      return {
        kind: 'remote-unverifiable',
        ownerLabel: remoteOwner.label,
        reason: 'unsupported-owner',
        lastKnown: null
      }
    }
    if (!owned || owned.ownerId !== remoteOwner.environmentId) {
      return { kind: 'remote-pending' }
    }
    if (owned.failure) {
      return {
        kind: 'remote-unverifiable',
        ownerLabel: remoteOwner.label,
        reason: owned.failure,
        lastKnown: owned.rateLimits
      }
    }
    return owned.rateLimits
      ? { kind: 'remote', ownerLabel: remoteOwner.label, rateLimits: owned.rateLimits }
      : { kind: 'remote-pending' }
  }, [remoteOwner, owned, unavailable])

  const rateLimits = useMemo(
    () => resolveOwnerUsageRateLimits(local, ownerState, t),
    [local, ownerState, t]
  )
  return {
    rateLimits,
    remoteOwner,
    refreshRemote: ownerId || unavailable ? refreshRemote : null
  }
}
