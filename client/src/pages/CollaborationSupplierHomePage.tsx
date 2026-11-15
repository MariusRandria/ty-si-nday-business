import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, BriefcaseBusiness, CheckCircle2, Clock3, Inbox, RefreshCw } from 'lucide-react'
import api, { ApiRequestError, type CollaborationSuppliedDeal } from '../api/client'
import { useI18n } from '../i18n'
import { StatusBadge } from '../components/collaboration/StatusBadge'
import '../components/collaboration/collaboration.css'
import '../components/ui/ui.css'
import { formatAntananarivoDate } from '../utils/collaboration-ui'

function requestError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'La connexion est momentanément indisponible. Vérifiez le réseau puis réessayez.'
  if (error.status === 401) return 'Votre session a expiré. Reconnectez-vous pour consulter vos prospects.'
  if (error.status === 403) return 'Vous n’êtes pas autorisé à consulter ces dossiers.'
  if (error.status === 429) return 'Trop de consultations en peu de temps. Patientez puis réessayez.'
  return 'Impossible de charger vos prospects pour le moment.'
}

export default function CollaborationSupplierHomePage({
  onOpenDeal,
  onOpenRequests,
  pendingRequestCount = 0,
}: {
  onOpenDeal: (deal: CollaborationSuppliedDeal) => void
  onOpenRequests: () => void
  pendingRequestCount?: number
}) {
  const { t, language } = useI18n()
  const [deals, setDeals] = useState<CollaborationSuppliedDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setDeals(await api.collaborationSuppliedDeals())
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

  return (
    <section className="collaboration-page collaboration-workspace-page collaboration-supplier-home" aria-labelledby="supplier-home-title">
      <header className="collaboration-page-header collaboration-home-header collaboration-workspace-header">
        <div>
          <p className="collaboration-eyebrow">{t('ESPACE FOURNISSEUR')}</p>
          <h1 id="supplier-home-title">{t('Mes prospects')}</h1>
          <p>{t('Gardez un œil sur vos dossiers et répondez aux demandes des agents.')}</p>
        </div>
        <button className="ui-button ui-button-primary collaboration-action" type="button" onClick={onOpenRequests}>
          <Inbox size={18} aria-hidden="true" />
          {t('Voir les demandes')}
          {pendingRequestCount > 0 && (
            <span className="collaboration-pending-badge" aria-label={`${pendingRequestCount >= 200 ? t('Au moins 200') : pendingRequestCount} ${t('demandes en attente')}`}>
              {pendingRequestCount >= 200 ? '200+' : pendingRequestCount}
            </span>
          )}
        </button>
      </header>

      {!loading && !error && (
        <div className="collaboration-overview" aria-label={t('Résumé de vos prospects')}>
          <article className="collaboration-overview-card">
            <span className="collaboration-overview-icon"><BriefcaseBusiness size={18} aria-hidden="true" /></span>
            <span className="collaboration-overview-label">{t('Dossiers partagés')}</span>
            <strong>{deals.length}</strong>
          </article>
          <article className="collaboration-overview-card collaboration-overview-pending">
            <span className="collaboration-overview-icon"><Clock3 size={18} aria-hidden="true" /></span>
            <span className="collaboration-overview-label">{t('Demandes à traiter')}</span>
            <strong>{pendingRequestCount}</strong>
          </article>
          <article className="collaboration-overview-card">
            <span className="collaboration-overview-icon"><CheckCircle2 size={18} aria-hidden="true" /></span>
            <span className="collaboration-overview-label">{t('Contrats signés')}</span>
            <strong>{deals.filter((deal) => ['CONTRACT_SIGNED', 'COMMISSIONS_PAID'].includes(deal.status)).length}</strong>
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
      {loading && <div className="collaboration-panel" role="status">{t('Chargement de vos prospects…')}</div>}
      {!loading && !error && deals.length === 0 && (
        <div className="collaboration-panel collaboration-empty" role="status">
          <span className="collaboration-empty-icon"><Inbox size={24} aria-hidden="true" /></span>
          <h2>{t('Aucun prospect partagé pour le moment')}</h2>
          <p>{t('Vos dossiers de collaboration apparaîtront ici après leur déclaration.')}</p>
        </div>
      )}
      {!loading && !error && deals.length > 0 && (
        <div className="collaboration-list collaboration-supplied-list">
          {deals.map((deal) => (
            <article className="collaboration-supplied-card" key={deal.dealId}>
              <div className="collaboration-supplied-top">
                <div className="collaboration-card-heading">
                  <span className="collaboration-card-icon"><BriefcaseBusiness size={17} aria-hidden="true" /></span>
                  <h2>{deal.prospectName}</h2>
                </div>
                <StatusBadge status={deal.status} />
              </div>
              <dl className="collaboration-supplied-details">
                {deal.city && <div><dt>{t('Ville')}</dt><dd>{deal.city}</dd></div>}
                <div><dt>{t('Déclaré le')}</dt><dd>{formatAntananarivoDate(deal.declaredAt, language)}</dd></div>
                {deal.pendingRequestsCount > 0 && (
                  <div className="collaboration-request-count">
                    <dt>{t('Demandes en attente')}</dt>
                    <dd><span aria-label={`${deal.pendingRequestsCount} ${t('demandes en attente')}`}>{deal.pendingRequestsCount}</span></dd>
                  </div>
                )}
              </dl>
              <button
                className="ui-button ui-button-secondary collaboration-action collaboration-supplied-open"
                type="button"
                onClick={() => onOpenDeal(deal)}
                aria-label={`${t('Ouvrir la frise du dossier')} ${deal.prospectName}`}
              >
                {t('Voir la frise')} <ArrowRight size={17} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
