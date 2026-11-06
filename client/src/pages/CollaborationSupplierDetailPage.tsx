import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import api, { ApiRequestError, type CollaborationSuppliedDeal, type CollaborationTimeline } from '../api/client'
import { StatusBadge } from '../components/collaboration/StatusBadge'
import '../components/collaboration/collaboration.css'
import '../components/ui/ui.css'
import { formatAntananarivoDate } from '../utils/collaboration-ui'

function requestError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'La connexion est momentanément indisponible. Vérifiez le réseau puis réessayez.'
  if (error.status === 401) return 'Votre session a expiré. Reconnectez-vous pour consulter ce dossier.'
  if (error.status === 403 || error.status === 404) return 'Ce dossier est introuvable ou n’est pas accessible à votre compte.'
  if (error.status === 429) return 'Trop de consultations en peu de temps. Patientez puis réessayez.'
  return 'Impossible de charger la frise du prospect pour le moment.'
}

export default function CollaborationSupplierDetailPage({
  dealId,
  initialDeal,
  onBack,
}: {
  dealId: number
  initialDeal: CollaborationSuppliedDeal | null
  onBack: () => void
}) {
  const [deal, setDeal] = useState<CollaborationSuppliedDeal | null>(initialDeal)
  const [timeline, setTimeline] = useState<CollaborationTimeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextTimeline, suppliedDeals] = await Promise.all([
        api.collaborationTimeline(dealId),
        initialDeal?.dealId === dealId
          ? Promise.resolve(null)
          : api.collaborationSuppliedDeals(),
      ])
      setTimeline(nextTimeline)
      if (suppliedDeals) setDeal(suppliedDeals.find((item) => item.dealId === dealId) ?? null)
    } catch (caught) {
      setError(requestError(caught))
    } finally {
      setLoading(false)
    }
  }, [dealId, initialDeal])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const signed = timeline?.status === 'CONTRACT_SIGNED' || timeline?.status === 'COMMISSIONS_PAID'

  return (
    <section className="collaboration-page" aria-labelledby="supplier-detail-title">
      <button className="collaboration-back-button" type="button" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" /> Mes prospects
      </button>
      <header className="collaboration-page-header collaboration-detail-header">
        <div>
          <p className="collaboration-eyebrow">FICHE PROSPECT</p>
          <h1 id="supplier-detail-title">{deal?.prospectName ?? 'Prospect'}</h1>
          {deal?.city && <p>{deal.city}</p>}
        </div>
        {timeline && <StatusBadge status={timeline.status} />}
      </header>

      {error && (
        <div className="collaboration-panel" role="alert">
          <p className="collaboration-error">{error}</p>
          <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void load()}>
            <RefreshCw size={17} aria-hidden="true" /> Réessayer
          </button>
        </div>
      )}
      {loading && <div className="collaboration-panel" role="status">Chargement de la frise…</div>}
      {!loading && !error && timeline && (
        <>
          <section className="collaboration-panel collaboration-detail-summary" aria-label="Résumé du dossier">
            <div><span>Déclaré le</span><strong>{deal ? formatAntananarivoDate(deal.declaredAt) : 'Date indisponible'}</strong></div>
            <div><span>Dernière mise à jour</span><strong>{deal ? formatAntananarivoDate(deal.updatedAt) : 'Date indisponible'}</strong></div>
            {signed && timeline.saleNumber && <div><span>Numéro de vente</span><strong>{timeline.saleNumber}</strong></div>}
          </section>

          <section className="collaboration-panel collaboration-timeline-panel" aria-labelledby="supplier-timeline-title">
            <h2 id="supplier-timeline-title">Frise du dossier</h2>
            {timeline.steps.length === 0
              ? <p className="collaboration-muted">Aucune étape n’est encore enregistrée.</p>
              : (
                <ol className="collaboration-timeline">
                  {timeline.steps.map((step, index) => (
                    <li key={`${step.status}-${step.at}-${index}`}>
                      <span className="collaboration-timeline-marker" aria-hidden="true" />
                      <div className="collaboration-timeline-content">
                        <StatusBadge status={step.status} />
                        <time dateTime={step.at}>{formatAntananarivoDate(step.at)}</time>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
          </section>
          <p className="collaboration-detail-privacy">Cette frise affiche uniquement les étapes et leurs dates. Les coordonnées du client final et le contenu des pièces ne sont pas affichés.</p>
        </>
      )}
    </section>
  )
}
