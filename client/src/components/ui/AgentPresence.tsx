import { useEffect, useState } from 'react'
import { useAgentPresence } from './AgentPresenceContext'
import { useI18n } from '../../i18n'

export function AgentPresenceDot({ userId, lastActiveAt, className = '' }: { userId: number; lastActiveAt?: string | null; className?: string }) {
  const { t } = useI18n()
  const presence = useAgentPresence(userId, lastActiveAt)
  if (!presence.isOnline) return null
  return <i className={`agent-presence-dot ${className}`.trim()} title={t('En ligne')} aria-hidden="true" />
}

export function AgentPresenceStatus({ userId, lastActiveAt }: { userId: number; lastActiveAt?: string | null }) {
  const { t, language } = useI18n()
  const presence = useAgentPresence(userId, lastActiveAt)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (presence.isOnline || !presence.lastActiveAt) return
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [presence.isOnline, presence.lastActiveAt])

  if (presence.isOnline) {
    return <span className="agent-presence-status is-online"><i aria-hidden="true" />{t('En ligne')}</span>
  }

  if (!presence.lastActiveAt) {
    return <span className="agent-presence-status"><i aria-hidden="true" />{t('Dernière activité inconnue')}</span>
  }

  const elapsed = Math.max(0, now - Date.parse(presence.lastActiveAt))
  if (!Number.isFinite(elapsed)) {
    return <span className="agent-presence-status"><i aria-hidden="true" />{t('Dernière activité inconnue')}</span>
  }
  if (elapsed < 60_000) {
    return <span className="agent-presence-status"><i aria-hidden="true" />{language === 'en' ? 'Active just now' : 'Actif à l’instant'}</span>
  }

  const minutes = Math.floor(elapsed / 60_000)
  const value = minutes < 60
    ? `${minutes} min`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)} h`
      : `${Math.floor(minutes / 1440)} d`
  return <span className="agent-presence-status"><i aria-hidden="true" />{language === 'en' ? `Active ${value} ago` : `Actif il y a ${value}`}</span>
}
