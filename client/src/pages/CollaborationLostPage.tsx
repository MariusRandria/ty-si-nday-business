import { useRef, useState } from 'react'
import { ArrowLeft, CircleOff } from 'lucide-react'
import { confirmAction } from '../utils/confirmation'
import api, { ApiRequestError, type CollaborationLostReason } from '../api/client'
import '../components/collaboration/collaboration.css'
import '../components/ui/ui.css'

const reasons: { value: CollaborationLostReason; label: string }[] = [
  { value: 'NO_INTEREST', label: 'Le prospect n’est plus intéressé' },
  { value: 'UNREACHABLE', label: 'Le prospect est injoignable' },
  { value: 'NO_BUDGET', label: 'Le budget ne convient pas' },
  { value: 'COMPETITOR_SELECTED', label: 'Un concurrent a été choisi' },
  { value: 'CLIENT_CANCELLED', label: 'Le prospect a annulé son projet' },
  { value: 'DUPLICATE', label: 'Le dossier est un doublon' },
  { value: 'OTHER', label: 'Autre motif' },
]

type Props = { dealId: number; onBack: () => void; onComplete: () => void }

function messageFor(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'Connexion indisponible. Vérifiez le réseau puis réessayez.'
  if (error.status === 401) return 'Votre session a expiré. Reconnectez-vous pour continuer.'
  if (error.status === 403 || error.status === 404) return 'Cet accès n’est plus actif ou ne permet pas cette action.'
  if (error.status === 409) return error.message || 'Le statut de ce dossier a changé. Actualisez-le avant de continuer.'
  if (error.status === 429) return 'Trop de tentatives. Patientez avant de réessayer.'
  return 'Impossible de déclarer ce prospect perdu pour le moment.'
}

export default function CollaborationLostPage({ dealId, onBack, onComplete }: Props) {
  const [reason, setReason] = useState<CollaborationLostReason | ''>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const actionLock = useRef(false)

  async function submit() {
    if (!reason || actionLock.current) return
    const confirmed = await confirmAction({
      title: 'Déclarer ce prospect perdu ?',
      message: 'Cette déclaration sera enregistrée dans le suivi du dossier.',
      confirmLabel: 'Confirmer la perte',
    })
    if (!confirmed) return
    actionLock.current = true
    setSaving(true)
    setError('')
    try {
      await api.declareCollaborationLost(dealId, reason)
      onComplete()
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      actionLock.current = false
      setSaving(false)
    }
  }

  return (
    <section className="collaboration-page" aria-labelledby="lost-title">
      <button className="collaboration-back-button" type="button" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" /> Retour au rapport</button>
      <header className="collaboration-page-header">
        <p className="collaboration-eyebrow">SUIVI DU PROSPECT</p>
        <h1 id="lost-title">Déclarer perdu</h1>
        <p>Choisissez le motif correspondant à la situation. Il sera enregistré avec le dossier.</p>
      </header>
      <div className="collaboration-panel collaboration-lost-panel">
        <label className="ui-field">
          <span>Motif de la perte</span>
          <select className="ui-control" value={reason} onChange={(event) => setReason(event.target.value as CollaborationLostReason | '')} disabled={saving}>
            <option value="">Choisir un motif</option>
            {reasons.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        {error && <p className="collaboration-error" role="alert">{error}</p>}
        <button className="ui-button ui-button-primary collaboration-action" type="button" onClick={() => void submit()} disabled={!reason || saving} aria-busy={saving}>
          <CircleOff size={17} aria-hidden="true" /> {saving ? 'Enregistrement…' : 'Confirmer la perte'}
        </button>
      </div>
    </section>
  )
}
