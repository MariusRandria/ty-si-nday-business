import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import './ui.css'

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }

export function Input({ id, label, error, hint, className = '', ...props }: Props) {
  const inputId = id ?? props.name
  const [passwordVisible, setPasswordVisible] = useState(false)
  const isPassword = props.type === 'password'
  return (
    <div className="ui-field">
      <label htmlFor={inputId}>{label}</label>
      {isPassword ? (
        <span className="ui-password-control">
          <input {...props} id={inputId} type={passwordVisible ? 'text' : 'password'} className={`ui-control ui-input ${className}`} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined} />
          <button
            type="button"
            className="ui-password-toggle"
            aria-label={passwordVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            aria-pressed={passwordVisible}
            aria-controls={inputId}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </span>
      ) : (
        <input {...props} id={inputId} className={`ui-control ui-input ${className}`} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined} />
      )}
      {error ? <span id={`${inputId}-error`} className="ui-field-error">{error}</span> : hint ? <span id={`${inputId}-hint`} className="ui-field-hint">{hint}</span> : null}
    </div>
  )
}
