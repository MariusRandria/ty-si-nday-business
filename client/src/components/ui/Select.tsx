import type { SelectHTMLAttributes } from 'react'
import './ui.css'

type Props = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }

export function Select({ id, label, error, children, className = '', ...props }: Props) {
  const inputId = id ?? props.name
  return <div className="ui-field"><label htmlFor={inputId}>{label}</label><select {...props} id={inputId} className={`ui-control ui-select ${className}`} aria-invalid={!!error}>{children}</select>{error && <span className="ui-field-error">{error}</span>}</div>
}
