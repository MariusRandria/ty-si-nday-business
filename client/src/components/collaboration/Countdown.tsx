import { useEffect, useState } from 'react'
import { formatCountdown } from '../../utils/collaboration-ui'
import './collaboration.css'

export function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const label = formatCountdown(expiresAt, now)
  return <span className={label === 'Expirée' ? 'collaboration-countdown expired' : 'collaboration-countdown'} aria-live="polite">{label}</span>
}
