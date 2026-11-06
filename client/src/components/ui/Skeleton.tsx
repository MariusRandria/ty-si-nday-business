import type { HTMLAttributes } from 'react'
import './ui.css'
export function Skeleton({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-skeleton ${className}`} aria-hidden="true" />
}
