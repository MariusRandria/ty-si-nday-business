import { useId } from 'react'
import { ShieldCheck } from 'lucide-react'
import './admin-totp-code-field.css'

type AdminTotpCodeFieldProps = {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: 'off' | 'one-time-code'
  className?: string
  required?: boolean
}

export function AdminTotpCodeField({
  id,
  label,
  value,
  onChange,
  autoComplete = 'off',
  className = '',
  required = false,
}: AdminTotpCodeFieldProps) {
  const generatedId = useId()
  const inputId = id ?? `admin-totp-${generatedId.replace(/:/g, '')}`
  const hintId = `${inputId}-hint`

  return (
    <label className={`admin-totp-code-field ${className}`.trim()} htmlFor={inputId}>
      <span className="admin-totp-code-heading">
        <span className="admin-totp-code-label">{label}</span>
        <span className="admin-totp-code-badge"><ShieldCheck size={14} aria-hidden="true" /> TOTP · 6 chiffres</span>
      </span>
      <span className="admin-totp-code-control">
        <span className="admin-totp-code-display" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span
              className={`admin-totp-code-cell ${index < value.length ? 'is-filled' : ''} ${index === value.length && index < 6 ? 'is-current' : ''}`}
              key={index}
            >
              {value[index] ?? ''}
            </span>
          ))}
        </span>
        <input
          id={inputId}
          className="admin-totp-code-input"
          type="text"
          inputMode="numeric"
          autoComplete={autoComplete}
          pattern="[0-9]{6}"
          maxLength={6}
          required={required}
          aria-describedby={hintId}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </span>
      <small className="admin-totp-code-hint" id={hintId}>Saisissez le code temporaire de votre application d’authentification.</small>
    </label>
  )
}
