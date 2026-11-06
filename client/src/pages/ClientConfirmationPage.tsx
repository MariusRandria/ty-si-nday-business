import { useEffect, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import api, { ApiRequestError, type ClientConfirmation } from '../api/client'
import '../components/collaboration/collaboration.css'
import '../components/ui/ui.css'
import { formatCountdown } from '../utils/collaboration-ui'

function confirmationError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) {
    return 'La connexion est momentanément indisponible. Vérifiez votre réseau puis réessayez.'
  }
  if (error.status === 400 && error.attemptsRemaining !== undefined) {
    return `Code incorrect. Il vous reste ${error.attemptsRemaining} tentative${error.attemptsRemaining === 1 ? '' : 's'}.`
  }
  if (error.status === 409) {
    if (/expir/i.test(error.message)) return 'Ce code a expiré. Demandez un nouveau message de confirmation.'
    if (/utilis|trait/i.test(error.message)) return 'Cette confirmation a déjà été utilisée.'
    if (/tentative|blocage/i.test(error.message)) return 'Trop de tentatives. Réessayez après le blocage temporaire.'
    return 'Cette confirmation a changé. Rechargez la page pour vérifier son état.'
  }
  if (error.status === 429) return 'Trop de tentatives. Réessayez dans quelques minutes.'
  if (error.status === 401 || error.status === 403) return 'Ce lien de confirmation n’est plus accessible.'
  if (error.status === 404) return 'Ce lien de confirmation n’est pas disponible ou a expiré.'
  return 'Le service de confirmation ne peut pas traiter la demande pour le moment. Réessayez.'
}

export default function ClientConfirmationPage({ confirmationToken }: { confirmationToken: string | null }) {
  const [confirmation, setConfirmation] = useState<ClientConfirmation | null>(null)
  const [loading, setLoading] = useState(confirmationToken !== null)
  const [submitting, setSubmitting] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<'CONFIRMED_BY_CLIENT' | 'DENIED' | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const submissionLock = useRef(false)
  const lastSubmissionAt = useRef(0)

  useEffect(() => {
    const previousTitle = document.title
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.appendChild(robots)
    document.title = 'Confirmation client | Ty sy Nday'
    return () => {
      robots.remove()
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (confirmationToken === null) return
    let active = true
    api.clientConfirmation(confirmationToken).then((data) => {
      if (active) setConfirmation(data)
    }).catch((caught: unknown) => {
      if (active) setError(confirmationError(caught))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [confirmationToken])

  const expired = confirmation?.status === 'PENDING' && new Date(confirmation.expiresAt).getTime() <= now
  const canRespond = confirmation?.status === 'PENDING' && !expired && !result
  const pageError = error || (confirmationToken === null ? 'Ce lien de confirmation est invalide.' : '')

  async function submit(answer: 'CONFIRMED' | 'DENIED') {
    const submittedAt = Date.now()
    if (!confirmationToken || !canRespond || submitting || submissionLock.current
      || submittedAt - lastSubmissionAt.current < 600 || !/^\d{8}$/.test(code)) return
    lastSubmissionAt.current = submittedAt
    submissionLock.current = true
    setSubmitting(true)
    setError('')
    try {
      const response = await api.respondToClientConfirmation(confirmationToken, { code, answer })
      setCode('')
      setResult(response.result)
      setConfirmation((current) => current ? { ...current, status: response.result } : current)
    } catch (caught) {
      setError(confirmationError(caught))
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="client-confirmation-shell">
      <section className="client-confirmation-card" aria-labelledby="client-confirmation-title">
        <p className="client-confirmation-brand">Ty sy Nday</p>
        <h1 id="client-confirmation-title">Confirmation de votre réponse</h1>
        <p className="client-confirmation-copy">Saisissez le code à 8 chiffres reçu par message, puis indiquez si vous confirmez la réalisation de la vente.</p>

        {loading && <p role="status">Vérification du lien…</p>}
        {!loading && confirmation?.status === 'PENDING' && !expired && (
          <>
            <p className="client-confirmation-copy">Ce code {formatCountdown(confirmation.expiresAt, now).toLowerCase()}.</p>
            <form className="client-confirmation-form" onSubmit={(event) => event.preventDefault()}>
              <label htmlFor="client-confirmation-code">Code de confirmation</label>
              <input
                id="client-confirmation-code"
                className="client-confirmation-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{8}"
                maxLength={8}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                disabled={submitting}
                aria-describedby={error ? 'client-confirmation-error' : undefined}
                required
              />
              {error && <p className="client-confirmation-error" id="client-confirmation-error" role="alert">{error}</p>}
              <div className="client-confirmation-actions">
                <button className="ui-button ui-button-primary" type="button" onClick={() => void submit('CONFIRMED')} disabled={!canRespond || submitting || code.length !== 8}>
                  {submitting ? 'Envoi…' : 'Confirmer'}
                </button>
                <button className="ui-button ui-button-secondary" type="button" onClick={() => void submit('DENIED')} disabled={!canRespond || submitting || code.length !== 8}>
                  Ce n’est pas moi
                </button>
              </div>
            </form>
          </>
        )}
        {!loading && expired && <p className="client-confirmation-error" role="status">Ce code a expiré. Demandez un nouveau message de confirmation.</p>}
        {!loading && confirmation && confirmation.status !== 'PENDING' && !result && (
          <p className={confirmation.status === 'CONFIRMED_BY_CLIENT' ? 'client-confirmation-success' : 'client-confirmation-error'} role="status">
            {confirmation.status === 'CONFIRMED_BY_CLIENT'
              ? 'Votre confirmation a déjà été enregistrée.'
              : confirmation.status === 'DENIED'
                ? 'Votre réponse a déjà été enregistrée.'
                : 'Ce code n’est plus utilisable.'}
          </p>
        )}
        {result && (
          <p className={result === 'CONFIRMED_BY_CLIENT' ? 'client-confirmation-success' : 'client-confirmation-error'} role="status">
            <CheckCircle2 size={18} aria-hidden="true" /> {result === 'CONFIRMED_BY_CLIENT' ? 'Merci. Votre confirmation a été enregistrée.' : 'Votre réponse a été enregistrée.'}
          </p>
        )}
        {!loading && pageError && !confirmation && (
          <div>
            <p className="client-confirmation-error" role="alert">{pageError}</p>
            {confirmationToken !== null && <button className="ui-button ui-button-secondary" type="button" onClick={() => window.location.reload()}>Réessayer</button>}
          </div>
        )}
        {!loading && error && confirmation && (
          <button className="ui-button ui-button-secondary" type="button" onClick={() => window.location.reload()}>Actualiser le statut</button>
        )}
      </section>
    </main>
  )
}
