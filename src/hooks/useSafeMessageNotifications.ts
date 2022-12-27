import { useEffect, useMemo } from 'react'
import { SafeMessageStatus } from '@gnosis.pm/safe-react-gateway-sdk'
import type { SafeMessageListItem } from '@gnosis.pm/safe-react-gateway-sdk'

import { SafeMsgEvent, safeMsgSubscribe } from '@/services/safe-messages/safeMsgEvents'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectNotifications, showNotification } from '@/store/notificationsSlice'
import { formatError } from '@/utils/formatters'
import { isSafeMessageListItem } from '@/utils/safe-message-guards'
import useSafeMessages from '@/hooks/useSafeMessages'
import { selectPendingSafeMessages } from '@/store/pendingSafeMessagesSlice'
import useIsGranted from '@/hooks/useIsGranted'
import { AppRoutes } from '@/config/routes'
import useWallet from '@/hooks/wallets/useWallet'
import { useCurrentChain } from '@/hooks/useChains'
import useSafeAddress from '@/hooks/useSafeAddress'
import type { PendingSafeMessagesState } from '@/store/pendingSafeMessagesSlice'

const SafeMessageNotifications: Partial<Record<SafeMsgEvent, string>> = {
  [SafeMsgEvent.PROPOSE]: 'You successfully signed the message.',
  [SafeMsgEvent.PROPOSE_FAILED]: 'Signing the message failed. Please try again.',
  [SafeMsgEvent.CONFIRM_PROPOSE]: 'You successfully confirmed the message.',
  [SafeMsgEvent.CONFIRM_PROPOSE_FAILED]: 'Confirming the message failed. Please try again.',
  [SafeMsgEvent.SIGNATURE_PREPARED]: 'The message was successfully confirmed.',
}

export const _getSafeMessagesAwaitingConfirmations = (
  items: SafeMessageListItem[],
  pendingMsgs: PendingSafeMessagesState,
  walletAddress: string,
) => {
  return items.filter(isSafeMessageListItem).filter((message) => {
    const needsConfirmation = message.status === SafeMessageStatus.NEEDS_CONFIRMATION
    const isPending = !!pendingMsgs[message.messageHash]
    const canSign = message.confirmations.every(({ owner }) => owner.value !== walletAddress)
    return needsConfirmation && !isPending && canSign
  })
}

const useSafeMessageNotifications = () => {
  const dispatch = useAppDispatch()

  /**
   * Show notifications of a messages's lifecycle
   */

  useEffect(() => {
    const entries = Object.entries(SafeMessageNotifications) as [keyof typeof SafeMessageNotifications, string][]

    const unsubFns = entries.map(([event, baseMessage]) =>
      safeMsgSubscribe(event, (detail) => {
        const isError = 'error' in detail
        const isSuccess = event === SafeMsgEvent.PROPOSE || event === SafeMsgEvent.SIGNATURE_PREPARED
        const message = isError ? `${baseMessage}${formatError(detail.error)}` : baseMessage

        dispatch(
          showNotification({
            message,
            detailedMessage: isError ? detail.error.message : undefined,
            groupKey: detail.messageHash,
            variant: isError ? 'error' : isSuccess ? 'success' : 'info',
          }),
        )
      }),
    )

    return () => {
      unsubFns.forEach((unsub) => unsub())
    }
  }, [dispatch])

  /**
   * If there's at least one message awaiting confirmations, show a notification for it
   */

  const { page } = useSafeMessages()
  const pendingMsgs = useAppSelector(selectPendingSafeMessages)
  const wallet = useWallet()
  const isGranted = useIsGranted()
  const notifications = useAppSelector(selectNotifications)
  const chain = useCurrentChain()
  const safeAddress = useSafeAddress()

  const msgsNeedingConfirmation = useMemo(() => {
    if (!page?.results) {
      return []
    }

    return _getSafeMessagesAwaitingConfirmations(page.results, pendingMsgs, wallet?.address || '')
  }, [page?.results, pendingMsgs, wallet?.address])

  useEffect(() => {
    if (!isGranted || msgsNeedingConfirmation.length === 0) {
      return
    }

    const messageHash = msgsNeedingConfirmation[0].messageHash
    const hasNotified = notifications.some(({ groupKey }) => groupKey === messageHash)

    if (!hasNotified) {
      dispatch(
        showNotification({
          variant: 'info',
          message: 'A message requires your confirmation.',
          link: {
            href: `${AppRoutes.transactions.messages}?safe=${chain?.shortName}:${safeAddress}`,
            title: 'View messages',
          },
          groupKey: messageHash,
        }),
      )
    }
  }, [dispatch, isGranted, notifications, msgsNeedingConfirmation, chain?.shortName, safeAddress])
}

export default useSafeMessageNotifications