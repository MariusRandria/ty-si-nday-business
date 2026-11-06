import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import './ui.css'

type Props = { title: string; description?: string; action?: ReactNode }
export function EmptyState({ title, description, action }: Props) {
  return <div className="ui-empty-state"><span className="ui-empty-state-icon"><Inbox size={26} /></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>
}
