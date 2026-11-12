import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock3, EyeOff, LockKeyhole, MapPinned, RefreshCw, Send, Sparkles } from 'lucide-react'
import api, { ApiRequestError, type CollaborationProspect } from '../api/client'
import { useI18n } from '../i18n'
import { Countdown } from '../components/collaboration/Countdown'
import { StatusBadge } from '../components/collaboration/StatusBadge'
import '../components/collaboration/collaboration.css'
import '../components/ui/ui.css'
import { formatAntananarivoDate } from '../utils/collaboration-ui'

const defaultMessage = 'Bonjour, je souhaite accompagner ce prospect et assurer un suivi professionnel.'

const requestLabels: Record<string, string> = {
  PENDING: 'Demande en attente',
  APPROVED: 'Accès approuvé',
  REJECTED: 'Demande refusée',
  EXPIRED: 'Demande expirée',
  NOT_SELECTED: 'Un autre agent a été retenu',
}

function requestError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'Connexion indisponible. Vérifiez le réseau puis réessayez.'
  if (error.status === 401) return 'Votre session a expiré. Reconnectez-vous pour continuer.'
  if (error.status === 403) return 'Un compte agent actif est nécessaire pour demander un accès.'
  if (error.status === 409) return error.message || 'Cette demande n’est pas disponible pour le moment.'
  if (error.status === 429) return 'Trop de demandes effectuées récemment. Réessayez plus tard.'
  return 'Impossible de traiter cette demande pour le moment.'
}

export default function CollaborationProspectsPage() {
  const { t, language } = useI18n()
  const [prospects, setProspects] = useState<CollaborationProspect[]>([])
  const [messages, setMessages] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actingIds, setActingIds] = useState<Set<number>>(() => new Set())
  const actionLocks = useRef(new Set<number>())
  const [now, setNow] = useState(() => Date.now())
  const signedCount = prospects.filter((prospect) => prospect.dealStatus === 'CLOSED_SIGNED').length
  const pendingCount = prospects.filter((prospect) => prospect.myRequest?.status === 'PENDING'
    && new Date(prospect.myRequest.expiresAt).getTime() > now).length
  const availableCount = prospects.length - signedCount

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setProspects(await api.collaborationProspects())
    } catch (caught) {
      setError(requestError(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  async function requestAccess(prospect: CollaborationProspect) {
    if (actionLocks.current.has(prospect.dealId)) return
    actionLocks.current.add(prospect.dealId)
    setActingIds(new Set(actionLocks.current))
    setError('')
    try {
      const request = await api.requestCollaborationAccess(prospect.dealId, messages[prospect.dealId] ?? t(defaultMessage))
      setProspects((current) => current.map((item) => item.dealId === prospect.dealId
        ? { ...item, myRequest: request }
        : item))
    } catch (caught) {
      const message = requestError(caught)
      if (caught instanceof ApiRequestError && caught.status === 409) {
        void load().finally(() => setError(message))
      } else {
        setError(message)
      }
    } finally {
      actionLocks.current.delete(prospect.dealId)
      setActingIds(new Set(actionLocks.current))
    }
  }

  async function hideSignedProspect(prospect: CollaborationProspect) {
    if (actionLocks.current.has(prospect.dealId)) return
    actionLocks.current.add(prospect.dealId)
    setActingIds(new Set(actionLocks.current))
    setError('')
    try {
      await api.hideSignedCollaborationProspect(prospect.dealId)
      setProspects((current) => current.filter((item) => item.dealId !== prospect.dealId))
    } catch (caught) {
      setError(requestError(caught))
    } finally {
      actionLocks.current.delete(prospect.dealId)
      setActingIds(new Set(actionLocks.current))
    }
  }

  return (
    <section className="collaboration-page collaboration-workspace-page" aria-labelledby="closer-prospects-title">
      <header className="collaboration-page-header collaboration-home-header collaboration-workspace-header">
        <div>
          <p className="collaboration-eyebrow">{t('ESPACE CLOSEUR')}</p>
          <h1 id="closer-prospects-title">{t('Prospects disponibles')}</h1>
          <p>{t('Repérez une opportunité, envoyez votre demande et suivez son statut.')}</p>
        </div>
        <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void load()}>
          <RefreshCw size={17} aria-hidden="true" /> {t('Actualiser')}
        </button>
      </header>

      {!loading && !error && (
        <div className="collaboration-overview" aria-label={t('Résumé des opportunités')}>
          <article className="collaboration-overview-card">
            <span className="collaboration-overview-icon"><Sparkles size={18} aria-hidden="true" /></span>
            <span className="collaboration-overview-label">{t('Opportunités')}</span>
            <strong>{availableCount}</strong>
          </article>
          <article className="collaboration-overview-card collaboration-overview-pending">
            <span className="collaboration-overview-icon"><Clock3 size={18} aria-hidden="true" /></span>
            <span className="collaboration-overview-label">{t('En attente')}</span>
            <strong>{pendingCount}</strong>
          </article>
          <article className="collaboration-overview-card collaboration-overview-closed">
            <span className="collaboration-overview-icon"><LockKeyhole size={18} aria-hidden="true" /></span>
            <span className="collaboration-overview-label">{t('Déjà clôturés')}</span>
            <strong>{signedCount}</strong>
          </article>
        </div>
      )}

      {error && (
        <div className="collaboration-panel" role="alert">
          <p className="collaboration-error">{t(error)}</p>
          <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void load()}>
            <RefreshCw size={17} aria-hidden="true" /> {t('Réessayer')}
          </button>
        </div>
      )}
      {loading && <div className="collaboration-panel" role="status">{t('Chargement des prospects masqués…')}</div>}
      {!loading && !error && prospects.length === 0 && (
        <div className="collaboration-panel collaboration-empty" role="status">
          <span className="collaboration-empty-icon"><MapPinned size={24} aria-hidden="true" /></span>
          <h2>{t('Aucun prospect disponible')}</h2>
          <p>{t('Les nouvelles opportunités apparaîtront ici.')}</p>
        </div>
      )}
      {!loading && !error && prospects.length > 0 && (
        <div className="collaboration-list collaboration-prospect-list">
          {prospects.map((prospect) => {
            const isSigned = prospect.dealStatus === 'CLOSED_SIGNED'
            if (isSigned) {
              const busy = actingIds.has(prospect.dealId)
              return (
                <article className="collaboration-prospect-card collaboration-prospect-card-signed" key={prospect.dealId}>
                  <div className="collaboration-supplied-top">
                    <div className="collaboration-card-heading">
                      <span className="collaboration-card-icon collaboration-card-icon-closed"><LockKeyhole size={17} aria-hidden="true" /></span>
                      <h2>{t('Prospect clôturé')}</h2>
                    </div>
                    <StatusBadge status="CLOSED_SIGNED" />
                  </div>
                  <p className="collaboration-muted collaboration-signed-explanation" id={`signed-prospect-${prospect.dealId}`}>
                    {t('Ce prospect est fermé aux autres agents. Aucune demande ni action n’est possible.')}
                  </p>
                  <div className="collaboration-access-actions">
                    <button className="ui-button ui-button-secondary collaboration-action collaboration-signed-disabled" type="button" disabled aria-describedby={`signed-prospect-${prospect.dealId}`}>
                      <LockKeyhole size={16} aria-hidden="true" /> {t('Demande d’accès indisponible')}
                    </button>
                    <button
                      className="ui-button ui-button-secondary collaboration-action collaboration-signed-remove"
                      type="button"
                      onClick={() => void hideSignedProspect(prospect)}
                      disabled={busy}
                    >
                      <EyeOff size={17} aria-hidden="true" />
                      {busy ? t('Retrait…') : t('Retirer de ma liste')}
                    </button>
                  </div>
                </article>
              )
            }
            const request = prospect.myRequest
            const requestExpired = request?.status === 'PENDING'
              && new Date(request.expiresAt).getTime() <= now
            const retryAt = request?.nextRequestAt ?? prospect.nextRequestAt ?? null
            const retryTime = retryAt ? new Date(retryAt).getTime() : null
            const waitingForRetry = Boolean(request && (requestExpired || ['REJECTED', 'EXPIRED', 'NOT_SELECTED'].includes(request.status))
              && (!retryTime || retryTime > now))
            const blocked = actingIds.has(prospect.dealId)
              || request?.status === 'PENDING' && !requestExpired
              || request?.status === 'APPROVED'
              || waitingForRetry
            return (
              <article className="collaboration-prospect-card" key={prospect.dealId}>
                <div className="collaboration-supplied-top">
                  <div className="collaboration-card-title">
                    <p className="collaboration-eyebrow">{t('OPPORTUNITÉ MASQUÉE')}</p>
                    <h2>{prospect.prospectName}</h2>
                  </div>
                  <StatusBadge status={prospect.dealStatus} />
                </div>
                <dl className="collaboration-prospect-details">
                  <div><dt>{t('Zone')}</dt><dd><MapPinned size={14} aria-hidden="true" />{prospect.city || t('Zone non précisée')}</dd></div>
                  <div><dt>{t('Besoin')}</dt><dd>{t(prospect.reportNature.replaceAll('_', ' '))}</dd></div>
                  <div><dt>{t('Date')}</dt><dd><Clock3 size={14} aria-hidden="true" />{formatAntananarivoDate(prospect.meetingAt || prospect.createdAt, language)}</dd></div>
                  <div><dt>{t('Fournisseur')}</dt><dd>{prospect.supplier.name}</dd></div>
                  <div>
                    <dt>{t('Score fournisseur')}</dt>
                    <dd>{prospect.supplierTrustScore
                      ? `${prospect.supplierTrustScore.score}/100 · ${formatAntananarivoDate(prospect.supplierTrustScore.calculatedAt, language)}`
                      : t('Indisponible pour le moment')}</dd>
                  </div>
                </dl>

                {request && (
                  <div className={`collaboration-prospect-request-state${requestExpired || request.status === 'REJECTED' ? ' is-warning' : ''}`} role="status">
                    <StatusBadge status={requestExpired ? 'EXPIRED' : request.status} />
                    <span>{t(requestExpired ? requestLabels.EXPIRED : requestLabels[request.status] ?? request.status)}</span>
                    {request.status === 'PENDING' && !requestExpired && <Countdown expiresAt={request.expiresAt} />}
                    {(requestExpired || ['REJECTED', 'EXPIRED', 'NOT_SELECTED'].includes(request.status)) && retryAt && retryTime !== null && retryTime > now && (
                      <span>{t('Nouvelle demande possible')} {formatAntananarivoDate(retryAt, language)}.</span>
                    )}
                    {waitingForRetry && (!retryAt || retryTime === null) && (
                      <span>{t('Le délai avant une nouvelle demande sera indiqué par le serveur.')}</span>
                    )}
                  </div>
                )}

                {!request || requestExpired || (request.status !== 'PENDING' && request.status !== 'APPROVED' && !waitingForRetry) ? (
                  <div className="collaboration-prospect-request">
                    <label className="ui-field">
                      <span>{t('Message facultatif au fournisseur')}</span>
                      <textarea
                        className="ui-control collaboration-message-input"
                        maxLength={500}
                        value={messages[prospect.dealId] ?? t(defaultMessage)}
                        onChange={(event) => setMessages((current) => ({ ...current, [prospect.dealId]: event.target.value }))}
                        disabled={blocked}
                      />
                    </label>
                    <button className="ui-button ui-button-primary collaboration-action" type="button" onClick={() => void requestAccess(prospect)} disabled={blocked} aria-busy={actingIds.has(prospect.dealId)}>
                      <Send size={17} aria-hidden="true" /> {t('Demander l’accès')}
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
