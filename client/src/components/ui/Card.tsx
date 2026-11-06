import type { HTMLAttributes, ReactNode } from 'react'
import './ui.css'

type Props = HTMLAttributes<HTMLDivElement> & { children: ReactNode; flat?: boolean }
export function Card({ children, flat = false, className = '', ...props }: Props) {
  return <div {...props} className={`ui-card ${flat ? 'ui-card-flat' : ''} ${className}`}>{children}</div>
}
