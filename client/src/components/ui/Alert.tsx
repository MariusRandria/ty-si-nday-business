import type { HTMLAttributes, ReactNode } from 'react'
import './ui.css'

type Props = HTMLAttributes<HTMLDivElement> & { tone?: 'success' | 'error' | 'warning' | 'info'; children: ReactNode }
export function Alert({ tone = 'info', children, className = '', ...props }: Props) {
  return <div {...props} role={tone === 'error' ? 'alert' : 'status'} className={`ui-alert ui-alert-${tone} ${className}`}>{children}</div>
}
