import { BadgeCheck } from 'lucide-react'
import './subscriber-badge.css'

export function SubscriberBadge() {
  return <span className="subscriber-badge" title="Badge abonné actif" aria-label="Badge abonné actif">
    <BadgeCheck size={14} aria-hidden="true" />
    <span>Abonné</span>
  </span>
}
