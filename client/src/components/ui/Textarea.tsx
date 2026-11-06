import type { TextareaHTMLAttributes } from 'react'
import './ui.css'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }

export function Textarea({ id, label, error, className = '', ...props }: Props) {
  const inputId = id ?? props.name
  return <div className="ui-field"><label htmlFor={inputId}>{label}</label><textarea {...props} id={inputId} className={`ui-control ui-textarea ${className}`} aria-invalid={!!error} />{error && <span className="ui-field-error">{error}</span>}</div>
}
