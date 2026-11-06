import { useEffect, useState } from 'react'
import api, { type CommissionAmounts } from '../api/client'

type CommissionState =
  | { status: 'loading' }
  | { status: 'ready'; amounts: CommissionAmounts; error?: string }
  | { status: 'error'; error: string }

export default function useCommissionAmounts() {
  const [state, setState] = useState<CommissionState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    let refreshing = false

    async function refresh() {
      if (refreshing) return
      refreshing = true
      try {
        const amounts = await api.commissionAmounts()
        if (active) setState({ status: 'ready', amounts })
      } catch (caught) {
        if (!active) return
        const error = caught instanceof Error ? caught.message : 'Impossible de charger les commissions configurées.'
        setState((current) => current.status === 'ready'
          ? { ...current, error }
          : { status: 'error', error })
      } finally {
        refreshing = false
      }
    }

    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 10_000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return state
}
