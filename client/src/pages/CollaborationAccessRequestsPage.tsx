import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clock3, RefreshCw, ShieldCheck, UsersRound, X } from 'lucide-react'
import api, { ApiRequestError, type CollaborationPendingAccessRequest } from '../api/client'
import { Countdown } from '../components/collaboration/Countdown'
import { StatusBadge } from '../components/collaboration/StatusBadge'
import '../components/collaboration/collaboration.css'
import '../components/ui/ui.css'
import { confirmAction } from '../utils/confirmation'
import { formatAntananarivoDate } from '../utils/collaboration-ui'

function requestError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'La connexion est momentanément indisponible. Vérifiez le réseau puis réessayez.'
  if (error.status === 401) return 'Votre session a expiré. Reconnectez-vous pour traiter cette demande.'
  if (error.status === 403) return 'Vous n’êtes pas autorisé à traiter cette demande.'
  if (error.status === 409) return 'Cette demande a expiré ou vient d’être traitée. La liste a été actualisée.'
  if (error.status === 429) return 'Trop de requêtes. Patientez avant de réessayer.'
  return 'Impossible de charger ou de traiter cette demande pour le moment.'
}

export default function CollaborationAccessRequestsPage({
  onOpenDeal,
  onPendingCountChange,
}: {
  onOpenDeal: (dealId: number) => void
  onPendingCountChange: (count: number) => void
}) {
  const [requests, setRequests] = useState<CollaborationPendingAccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [actingIds, setActingIds] = useState<Set<number>>(() => new Set())
  const [actingDealIds, setActingDealIds] = useState<Set<number>>(() => new Set())
  const actionLocks = useRef(new Set<number>())
  const dealLocks = useRef(new Set<number>())
  const requestsRef = useRef<CollaborationPendingAccessRequest[]>([])
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const data = await api.collaborationPendingAccessRequests()
      requestsRef.current = data
      setRequests(data)
      onPendingCountChange(data.length)
    } catch (caught) {
      setError(requestError(caught))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [onPendingCountChange])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const activeRequestCount = requests.filter((request) => new Date(request.expiresAt).getTime() > now).length
  const expiredRequestCount = requests.length - activeRequestCount

  async function decide(request: CollaborationPendingAccessRequest, decision: 'APPROVE' | 'REJECT') {
    if (actionLocks.current.has(request.id) || dealLocks.current.has(request.dealId)) return
    actionLocks.current.add(request.id)
    dealLocks.current.add(request.dealId)
    setActingIds(new Set(actionLocks.current))
    setActingDealIds(new Set(dealLocks.current))
    setError('')
    setNotice('')
    try {
      const accepted = await confirmAction({
        title: decision === 'APPROVE' ? 'Accepter cette demande ?' : 'Refuser cette demande ?',
        message: decision === 'APPROVE'
          ? 'L’agent recevra un accès temporaire à ce prospect.'
          : 'Cette demande sera refusée. Vous pourrez revoir les autres demandes encore en attente.',
        confirmLabel: decision === 'APPROVE' ? 'Accepter' : 'Refuser',
        destructive: decision === 'REJECT',
      })
      if (!accepted) return
      await api.decideCollaborationAccessRequest(request.id, decision)
      const next = requestsRef.current.filter((item) => decision === 'APPROVE'
        ? item.dealId !== request.dealId
        : item.id !== request.id)
      requestsRef.current = next
      setRequests(next)
      onPendingCountChange(next.length)
      setNotice(decision === 'APPROVE'
        ? 'Demande acceptée. Les autres demandes pour ce prospect ne sont plus disponibles.'
        : 'Demande refusée.')
      window.dispatchEvent(new CustomEvent('collaboration:requests-updated'))
    } catch (caught) {
      setError(requestError(caught))
      if (caught instanceof ApiRequestError && caught.status === 409) void load(false)
    } finally {
      actionLocks.current.delete(request.id)
      dealLocks.current.delete(request.dealId)
      setActingIds(new Set(actionLocks.current))
      setActingDealIds(new Set(dealLocks.current))
    }
  }

  return (
    <section className="collaboration-page collaboration-workspace-page" aria-labelledby="access-requests-title">
      <header className="collaboration-page-header collaboration-home-header collaboration-workspace-header">
        <div>
          <p className="collaboration-eyebrow">ESPACE FOURNISSEUR</p>
          <h1 id="access-requests-title">Demandes d’accès</h1>
          <p>Évaluez les demandes et choisissez l’agent qui accompagnera chaque dossier.</p>
        </div>
        <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void load()}>
          <RefreshCw size={17} aria-hidden="true" /> Actualiser
        </button>
      </header>

      {!loading && !error && (
        <div className="collaboration-overview" aria-label="Résumé des demandes">
          <article className="collaboration-overview-card">
            <span className="collaboration-overview-icon"><UsersRound size={18} aria-hidden="true" /></span>
            <span className="collaboration-overview-label">Demandes reçues</span>
            <strong>{requests.length}</strong>
          </article>
          <article className="collaboration-overview-card collaboration-overview-pending">
            <span className="collaboration-overview-icon"><Clock3 size={18} aria-hidden="true" /></span>
            <span className="collaboration-overview-label">À examiner</span>
            <strong>{activeRequestCount}</strong>
          </article>
          <article className="collaboration-overview-card collaboration-overview-closed">
            <span className="collaboration-overview-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
            <span className="collaboration-overview-label">Expirées</span>
            <strong>{expiredRequestCount}</strong>
          </article>
        </div>
      )}

      {notice && <p className="collaboration-success" role="status">{notice}</p>}
      {error && (
        <div className="collaboration-panel" role="alert">
          <p className="collaboration-error">{error}</p>
          <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void load()}>
            <RefreshCw size={17} aria-hidden="true" /> Réessayer
          </button>
        </div>
      )}
      {loading && <div className="collaboration-panel" role="status">Chargement des demandes…</div>}
      {!loading && !error && requests.length === 0 && (
        <div className="collaboration-panel collaboration-empty" role="status">
          <span className="collaboration-empty-icon"><Check size={24} aria-hidden="true" /></span>
          <h2>Aucune demande en attente</h2>
          <p>Les nouvelles demandes d’accès à vos prospects apparaîtront ici.</p>
        </div>
      )}
      {!loading && requests.length > 0 && (
        <div className="collaboration-list collaboration-request-list">
          {requests.map((request) => {
            const expiration = new Date(request.expiresAt).getTime()
            const expired = !Number.isFinite(expiration) || expiration <= now
            const acting = actingIds.has(request.id) || actingDealIds.has(request.dealId)
            return (
              <article className="collaboration-request-card" key={request.id}>
                <div className="collaboration-supplied-top">
                  <div className="collaboration-card-title">
                    <p className="collaboration-eyebrow">DEMANDEUR</p>
                    <h2>{request.requester.name}</h2>
                  </div>
                  <StatusBadge status={expired ? 'EXPIRED' : 'PENDING'} />
                </div>
                <dl className="collaboration-request-details">
                  <div className="collaboration-request-prospect"><dt>Prospect concerné</dt><dd>{request.prospectName}</dd></div>
                  <div className="collaboration-request-trust">
                    <dt>Score de confiance</dt>
                    <dd>
                      <span>{request.requester.trustScore ? `${request.requester.trustScore.score}/100` : 'Non calculé'}</span>
                      {request.requester.trustScore && (
                        <span className="collaboration-trust-meter" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, Math.max(0, request.requester.trustScore.score))}%` }} />
                        </span>
                      )}
                    </dd>
                  </div>
                  <div><dt>Ventes réussies</dt><dd>{request.requester.successfulSales}</dd></div>
                  <div><dt>Reçue le</dt><dd>{formatAntananarivoDate(request.requestedAt)}</dd></div>
                  <div className={expired ? 'collaboration-request-expired' : ''}><dt>Échéance</dt><dd>{expired ? 'Demande expirée' : <Countdown expiresAt={request.expiresAt} />}</dd></div>
                </dl>
                {!expired && <p className="collaboration-request-hint">L’accès est accordé temporairement après acceptation.</p>}
                <div className="collaboration-request-actions">
                  <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => onOpenDeal(request.dealId)} disabled={acting}>
                    Voir le dossier
                  </button>
                  <button className="ui-button ui-button-primary collaboration-action" type="button" onClick={() => void decide(request, 'APPROVE')} disabled={expired || acting} aria-busy={acting}>
                    <Check size={17} aria-hidden="true" /> Accepter
                  </button>
                  <button className="ui-button ui-button-danger collaboration-action" type="button" onClick={() => void decide(request, 'REJECT')} disabled={expired || acting} aria-busy={acting}>
                    <X size={17} aria-hidden="true" /> Refuser
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
