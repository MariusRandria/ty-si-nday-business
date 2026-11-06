import { AlertTriangle, CheckCircle2, Circle, Clock3, XCircle } from 'lucide-react'
import { collaborationStatuses, type CollaborationStatus } from '../../utils/collaboration-ui'
import './collaboration.css'

const icons = {
  circle: Circle,
  clock: Clock3,
  alert: AlertTriangle,
  check: CheckCircle2,
  x: XCircle,
}

export function StatusBadge({ status }: { status: CollaborationStatus | string }) {
  const presentation = status in collaborationStatuses
    ? collaborationStatuses[status as CollaborationStatus]
    : { label: status.replaceAll('_', ' '), tone: 'neutral' as const, icon: 'circle' as const }
  const Icon = icons[presentation.icon]
  return (
    <span className={`collaboration-status collaboration-status-${presentation.tone}`}>
      <Icon aria-hidden="true" size={16} />
      <span>{presentation.label}</span>
    </span>
  )
}
