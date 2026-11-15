import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { formatCountdown } from '../../utils/collaboration-ui'
import './collaboration.css'

export function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  const { language } = useI18n()

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const label = formatCountdown(expiresAt, now, language)
  return <span className={label === 'Expirée' || label === 'Expired' ? 'collaboration-countdown expired' : 'collaboration-countdown'} aria-live="polite">{label}</span>
}
