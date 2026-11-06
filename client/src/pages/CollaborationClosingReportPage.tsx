import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileUp, RefreshCw, Send } from 'lucide-react'
import api, {
  ApiRequestError,
  type CollaborationClosingDraft,
  type CollaborationClosingReport,
} from '../api/client'
import { StatusBadge } from '../components/collaboration/StatusBadge'
import { formatAntananarivoDate } from '../utils/collaboration-ui'
import {
  applyCollaborationClosingDraft,
  buildCollaborationClosingDraft,
  collaborationDraftFormValues,
  type CollaborationDraftFormValues,
} from '../utils/collaboration-draft'
import '../components/collaboration/collaboration.css'
import '../components/ui/ui.css'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

type Props = {
  dealId: number
  dealStatus: string
  onBack: () => void
  onDeclareLost: () => void
}

function friendlyError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return 'Connexion indisponible. Vérifiez le réseau puis réessayez.'
  if (error.status === 401) return 'Votre session a expiré. Reconnectez-vous pour continuer.'
  if (error.status === 403 || error.status === 404) return 'Cet accès n’est plus actif ou ne permet pas cette action.'
  if (error.status === 409) return error.message || 'Ce rapport a déjà été soumis et ne peut plus être modifié.'
  if (error.status === 429) return 'Trop de tentatives. Patientez avant de réessayer.'
  return error.message || fallback
}

function fileSize(size: number): string {
  return `${(size / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
}

export default function CollaborationClosingReportPage({ dealId, dealStatus, onBack, onDeclareLost }: Props) {
  const [report, setReport] = useState<CollaborationClosingReport | null>(null)
  const [newEvidence, setNewEvidence] = useState<CollaborationClosingReport['evidence']>([])
  const [amount, setAmount] = useState('')
  const [saleDate, setSaleDate] = useState('')
  const [details, setDetails] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [draftError, setDraftError] = useState('')
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [fileError, setFileError] = useState('')
  const draftTimer = useRef<number | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const savedDraft = useRef<CollaborationDraftFormValues>({ saleAmount: '', saleDate: '', details: '' })
  const lastDraftSaveAt = useRef(0)
  const idempotencyKey = useRef<string | null>(null)
  const submitLock = useRef(false)
  const loaded = useRef(false)
  const isLocked = dealStatus !== 'IN_PROGRESS' || (report !== null && report.status !== 'DRAFT')
  const validAmount = Number.isSafeInteger(Number(amount)) && Number(amount) > 0

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    loaded.current = false
    try {
      const saved = await api.collaborationClosingReport(dealId)
      const values = collaborationDraftFormValues(saved)
      setReport(saved)
      setNewEvidence([])
      setAmount(values.saleAmount)
      setSaleDate(values.saleDate)
      setDetails(values.details)
      savedDraft.current = values
      setDraftSavedAt(saved ? Date.now() : null)
      lastDraftSaveAt.current = Date.now()
      loaded.current = true
    } catch (error) {
      setLoadError(friendlyError(error, 'Impossible de charger le rapport.'))
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => {
      window.clearTimeout(timer)
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
    }
  }, [load])

  const persistDraft = useCallback(async (payload: CollaborationClosingDraft) => {
    if (Object.keys(payload).length === 0) return
    setDraftError('')
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const remaining = lastDraftSaveAt.current + 3_500 - Date.now()
        if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining))
        await api.saveCollaborationClosingDraft(dealId, payload)
        savedDraft.current = applyCollaborationClosingDraft(savedDraft.current, payload)
        lastDraftSaveAt.current = Date.now()
        setDraftSavedAt(lastDraftSaveAt.current)
      })
    await saveQueue.current
  }, [dealId])

  async function leaveAfterSaving(action: () => void) {
    if (isLocked) {
      action()
      return
    }
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
    try {
      await persistDraft(buildCollaborationClosingDraft({ saleAmount: amount, saleDate, details }, savedDraft.current))
      action()
    } catch (error) {
      setDraftError(friendlyError(error, 'Le brouillon n’a pas pu être enregistré.'))
    }
  }

  useEffect(() => {
    if (!loaded.current || loading || isLocked) return
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
    const payload = buildCollaborationClosingDraft({ saleAmount: amount, saleDate, details }, savedDraft.current)
    if (Object.keys(payload).length === 0) return
    draftTimer.current = window.setTimeout(() => {
      void persistDraft(payload).catch((error: unknown) => setDraftError(friendlyError(error, 'Le brouillon n’a pas pu être enregistré.')))
    }, 1_000)
    return () => {
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
    }
  }, [amount, saleDate, details, isLocked, loading, persistDraft, report])

  async function uploadFile(file?: File) {
    if (!file) return
    if (!ALLOWED_FILE_TYPES.has(file.type) || file.size > MAX_FILE_SIZE) {
      setFileError('Choisissez un PDF, JPG, PNG ou WebP de 10 Mo maximum.')
      return
    }
    setFileError('')
    setUploading(true)
    try {
      await persistDraft(buildCollaborationClosingDraft({ saleAmount: amount, saleDate, details }, savedDraft.current))
      const evidence = await api.uploadCollaborationClosingAttachment(dealId, file)
      setNewEvidence((current) => [...current, evidence])
    } catch (error) {
      setFileError(friendlyError(error, 'Le brouillon ou la pièce jointe n’a pas pu être enregistré.'))
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    if (submitLock.current || isLocked) return
    submitLock.current = true
    setSubmitting(true)
    setSubmitError('')
    try {
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
      await persistDraft(buildCollaborationClosingDraft({ saleAmount: amount, saleDate, details }, savedDraft.current))
      idempotencyKey.current ??= crypto.randomUUID()
      await api.submitCollaborationClosingReport(dealId, idempotencyKey.current)
      await load()
    } catch (error) {
      setSubmitError(friendlyError(error, 'Le rapport n’a pas pu être soumis. Vérifiez les informations et réessayez.'))
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  const evidence = [...(report?.evidence ?? []), ...newEvidence]
  const canSubmit = validAmount && saleDate !== '' && details.trim() !== ''

  return (
    <section className="collaboration-page" aria-labelledby="closing-report-title">
      <button className="collaboration-back-button" type="button" onClick={() => void leaveAfterSaving(onBack)} disabled={submitting || uploading}><ArrowLeft size={17} aria-hidden="true" /> Retour à Mes accès</button>
      <header className="collaboration-page-header">
        <p className="collaboration-eyebrow">RAPPORT DE CLÔTURE</p>
        <h1 id="closing-report-title">{isLocked ? 'Rapport de clôture' : 'Déclarer une vente conclue'}</h1>
        <p>Enregistrez votre rapport. Après soumission, il ne pourra plus être modifié.</p>
      </header>

      {loadError && (
        <div className="collaboration-panel" role="alert">
          <p className="collaboration-error">{loadError}</p>
          <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void load()}>
            <RefreshCw size={17} aria-hidden="true" /> Réessayer
          </button>
        </div>
      )}
      {loading && <div className="collaboration-panel" role="status">Chargement du brouillon…</div>}
      {!loading && !loadError && (
        <div className="collaboration-panel collaboration-report-form">
          {isLocked && (
            <div className="collaboration-report-locked" role="status">
              <StatusBadge status={dealStatus} />
              <p>{report?.status === 'SUBMITTED'
                ? `Rapport soumis le ${formatAntananarivoDate(report.submittedAt ?? report.reportedAt)}. Il est maintenant verrouillé.`
                : report?.status === 'REJECTED'
                  ? 'Ce rapport a été rejeté et ne peut pas être modifié ici.'
                  : dealStatus === 'CLOSING_REPORTED'
                    ? 'Rapport soumis. Cette étape est en lecture seule.'
                    : 'Le statut de ce dossier ne permet plus de modifier le rapport.'}</p>
            </div>
          )}
          <div className="collaboration-draft-field">
            <div className="collaboration-draft-field-label">
              <label htmlFor="closing-sale-amount">Montant de la vente (Ar)</label>
              {!isLocked && amount && <button className="collaboration-clear-field" type="button" onClick={() => setAmount('')}>Effacer</button>}
            </div>
            <input id="closing-sale-amount" className="ui-control" type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={isLocked || submitting} />
          </div>
          <div className="collaboration-draft-field">
            <div className="collaboration-draft-field-label">
              <label htmlFor="closing-sale-date">Date de la vente</label>
              {!isLocked && saleDate && <button className="collaboration-clear-field" type="button" onClick={() => setSaleDate('')}>Effacer</button>}
            </div>
            <input id="closing-sale-date" className="ui-control" type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} disabled={isLocked || submitting} />
          </div>
          <div className="collaboration-draft-field">
            <div className="collaboration-draft-field-label">
              <label htmlFor="closing-report-details">Description de la clôture</label>
              {!isLocked && details && <button className="collaboration-clear-field" type="button" onClick={() => setDetails('')}>Effacer</button>}
            </div>
            <textarea id="closing-report-details" className="ui-control collaboration-message-input" maxLength={10_000} value={details} onChange={(event) => setDetails(event.target.value)} disabled={isLocked || submitting} />
          </div>

          {!isLocked && (
            <div className="collaboration-report-autosave" aria-live="polite">
              {draftError ? <span className="collaboration-error">{draftError}</span>
                : draftSavedAt ? <span>Brouillon enregistré à {new Intl.DateTimeFormat('fr-FR', { timeZone: 'Indian/Antananarivo', hour: '2-digit', minute: '2-digit' }).format(draftSavedAt)}.</span>
                  : <span>Le brouillon est enregistré automatiquement.</span>}
            </div>
          )}

          <div className="collaboration-report-evidence">
            <h2>Pièces jointes</h2>
            <p className="collaboration-muted">PDF, JPG, PNG ou WebP · 10 Mo maximum par fichier.</p>
            {evidence.length ? (
              <ul className="collaboration-evidence-list">
                {evidence.map((item) => (
                  <li key={item.id}><span>{item.fileName}</span><small>{fileSize(item.fileSize)}</small></li>
                ))}
              </ul>
            ) : <p className="collaboration-muted">Aucune pièce jointe pour le moment.</p>}
            {!isLocked && (
              <label className="ui-button ui-button-secondary collaboration-action collaboration-file-picker">
                <FileUp size={18} aria-hidden="true" /> {uploading ? 'Téléversement…' : 'Ajouter une pièce'}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" capture="environment" disabled={uploading || submitting} onChange={(event) => { void uploadFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
              </label>
            )}
            {fileError && <p className="collaboration-error" role="alert">{fileError}</p>}
          </div>

          {!isLocked && (
            <>
              {submitError && <p className="collaboration-error" role="alert">{submitError}</p>}
              <div className="collaboration-report-actions">
                {dealStatus === 'IN_PROGRESS' && <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void leaveAfterSaving(onDeclareLost)} disabled={submitting || uploading}>Déclarer perdu</button>}
                {dealStatus === 'IN_PROGRESS' && <button className="ui-button ui-button-primary collaboration-action" type="button" onClick={() => void submit()} disabled={submitting || uploading || !canSubmit} aria-busy={submitting}>
                  <Send size={17} aria-hidden="true" /> {submitting ? 'Soumission…' : 'Soumettre le rapport'}
                </button>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
