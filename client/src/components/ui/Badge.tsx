import type { HTMLAttributes, ReactNode } from 'react'
import './ui.css'

type Props = HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info'; children: ReactNode }
export function Badge({ tone = 'neutral', children, className = '', ...props }: Props) {
  return <span {...props} className={`ui-badge ui-badge-${tone} ${className}`}>{children}</span>
}
