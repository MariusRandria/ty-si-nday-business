import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './ui.css'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; children: ReactNode }

export function Button({ variant = 'primary', loading = false, children, disabled, className = '', ...props }: Props) {
  return (
    <button {...props} className={`ui-button ui-button-${variant} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading && <span className="ui-spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}
