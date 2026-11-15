import { useTranslate } from '@/i18n/use-translate'
import type React from 'react'
import { ProviderDetailsMenu } from '../usage/ProviderDetailsMenu'
import type { ProviderRateLimits } from '../../../../../shared/rate-limit-types'
import type { ChatAccountAction } from './ProviderAccountChatButton'
import { useActiveAccountOwner } from '@/runtime/provider-accounts/ownership/use-active-account-owner'
import { ClaudeSwitcherForOwner } from './ClaudeSwitcherForOwner'
import { getProviderAccountsOwnerKey } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'

export type ClaudeSwitcherMenuProps = {
  claude: ProviderRateLimits | null
  compact: boolean
  iconOnly: boolean
  asSubmenu?: boolean
  triggerContent?: React.ReactNode
  chatAction?: ChatAccountAction
}

export function ClaudeSwitcherMenu(props: ClaudeSwitcherMenuProps): React.JSX.Element | null {
  return props.chatAction ? (
    <ClaudeSwitcherForOwner
      {...props}
      key={getProviderAccountsOwnerKey(props.chatAction.target)}
      owner={{ target: props.chatAction.target, wslHostDistro: null }}
    />
  ) : (
    <FocusedClaudeSwitcher {...props} />
  )
}

function FocusedClaudeSwitcher(props: ClaudeSwitcherMenuProps): React.JSX.Element | null {
  const t = useTranslate()
  const owner = useActiveAccountOwner({ kind: 'local' })
  if (!owner) {
    return (
      <ProviderDetailsMenu
        provider={props.claude}
        compact={props.compact}
        iconOnly={props.iconOnly}
        asSubmenu={props.asSubmenu}
        triggerContent={props.triggerContent}
        ariaLabel={t(
          'auto.components.status.bar.StatusBar.3dd7ddfae1',
          'Open Claude details and account switcher'
        )}
      />
    )
  }
  return (
    <ClaudeSwitcherForOwner
      key={`${getProviderAccountsOwnerKey(owner.target)}:${owner.wslHostDistro ?? ''}`}
      {...props}
      owner={owner}
    />
  )
}
