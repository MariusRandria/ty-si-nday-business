import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleOff, Eye, EyeOff, FileText, MapPinned, RefreshCw, ScrollText, UserRound } from 'lucide-react'
import api, {
  ApiRequestError,
  type CollaborationCloserAccess,
  type CollaborationDealContactDetails,
  type CollaborationTimeline,
} from '../api/client'
import { useI18n } from '../i18n'
import { Countdown } from '../components/collaboration/Countdown'
import { StatusBadge } from '../components/collaboration/StatusBadge'
import '../components/collaboration/collaboration.css'
import '../components/ui/ui.css'
import { formatAntananarivoDate } from '../utils/collaboration-ui'

type Props = {
  onOpenReport: (deal: CollaborationCloserAccess) => void
  onDeclareLost: (deal: CollaborationCloserAccess) => void
}

function friendlyError(error: unknown, context: 'list' | 'contacts'): string {
  if (!(error instanceof ApiRequestError)) return 'Connexion indisponible. Vérifiez le réseau puis réessayez.'
  if (error.status === 401) return 'Votre session a expiré. Reconnectez-vous pour continuer.'
  if (error.status === 403 || error.status === 404) return 'Cet accès n’est plus actif ou ne permet pas de consulter ce dossier.'
  if (error.status === 409) return error.message || 'Le statut de ce dossier a changé. Actualisez la liste.'
  if (error.status === 429) return context === 'contacts'
    ? 'Votre quota quotidien de consultations est atteint. Vous pourrez réessayer demain.'
    : 'La liste est temporairement limitée. Patientez avant de réessayer.'
  return error.message || 'Impossible de charger les coordonnées.'
}

function ContactDetails({
  details,
  onClose,
}: {
  details: CollaborationDealContactDetails
  onClose: () => void
}) {
  const { t } = useI18n()
  const prospect = details.prospect
  return (
    <section className="collaboration-contact-reveal" aria-label={t('Coordonnées du prospect')}>
      <div className="collaboration-contact-reveal-header">
        <div>
          <p className="collaboration-eyebrow">{t('CONSULTATION JOURNALISÉE')}</p>
          <h3>{t('Coordonnées du prospect')}</h3>
        </div>
        <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={onClose}>
          <EyeOff size={17} aria-hidden="true" /> {t('Masquer')}
        </button>
      </div>
      <p className="collaboration-watermark"><UserRound size={16} aria-hidden="true" /> {t('Consultation par')} {details.watermark.agentName}</p>
      {prospect ? (
        <dl className="collaboration-contact-details">
          <div><dt>{t('Entreprise')}</dt><dd>{prospect.companyName}</dd></div>
          <div><dt>{t('Contact')}</dt><dd>{prospect.contactName}</dd></div>
          <div><dt>{t('Téléphone')}</dt><dd>{prospect.phone}</dd></div>
          {prospect.email && <div><dt>{t('Email')}</dt><dd>{prospect.email}</dd></div>}
          {prospect.address && <div><dt>{t('Adresse')}</dt><dd>{prospect.address}</dd></div>}
        </dl>
      ) : <p className="collaboration-muted">{t('Aucune coordonnée n’est disponible pour ce dossier.')}</p>}
    </section>
  )
}

export default function CollaborationCloserAccessesPage({ onOpenReport, onDeclareLost }: Props) {
  const { t, language } = useI18n()
  const [accesses, setAccesses] = useState<CollaborationCloserAccess[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [contactDetails, setContactDetails] = useState<CollaborationDealContactDetails | null>(null)
  const [revealingDealId, setRevealingDealId] = useState<number | null>(null)
  const [contactError, setContactError] = useState('')
  const [contactErrorDealId, setContactErrorDealId] = useState<number | null>(null)
  const [timelines, setTimelines] = useState<Record<number, CollaborationTimeline>>({})
  const [openTimelineId, setOpenTimelineId] = useState<number | null>(null)
  const [timelineLoadingId, setTimelineLoadingId] = useState<number | null>(null)
  const [timelineError, setTimelineError] = useState('')
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setContactError('')
    setContactErrorDealId(null)
    setContactDetails(null)
    requestSequence.current += 1
    setRevealingDealId(null)
    try {
      setAccesses(await api.collaborationCloserAccesses())
    } catch (caught) {
      setError(friendlyError(caught, 'list'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => {
      window.clearTimeout(timer)
      requestSequence.current += 1
    }
  }, [load])

  async function revealContacts(dealId: number) {
    if (revealingDealId !== null) return
    const sequence = ++requestSequence.current
    setContactDetails(null)
    setContactError('')
    setContactErrorDealId(null)
    setRevealingDealId(dealId)
    try {
      const details = await api.collaborationDealContactDetails(dealId)
      if (requestSequence.current === sequence) setContactDetails(details)
    } catch (caught) {
      if (requestSequence.current === sequence) {
        setContactError(friendlyError(caught, 'contacts'))
        setContactErrorDealId(dealId)
      }
    } finally {
      if (requestSequence.current === sequence) setRevealingDealId(null)
    }
  }

  function hideContacts() {
    requestSequence.current += 1
    setContactDetails(null)
    setContactError('')
    setContactErrorDealId(null)
    setRevealingDealId(null)
  }

  async function toggleTimeline(dealId: number) {
    if (openTimelineId === dealId) {
      setOpenTimelineId(null)
      return
    }
    setTimelineError('')
    if (!timelines[dealId]) {
      setTimelineLoadingId(dealId)
      try {
        const timeline = await api.collaborationTimeline(dealId)
        setTimelines((current) => ({ ...current, [dealId]: timeline }))
      } catch (caught) {
        setTimelineError(friendlyError(caught, 'list'))
        setTimelineLoadingId(null)
        return
      }
      setTimelineLoadingId(null)
    }
    setOpenTimelineId(dealId)
  }

  return (
    <section className="collaboration-page" aria-labelledby="closer-accesses-title">
      <header className="collaboration-page-header collaboration-home-header">
        <div>
          <p className="collaboration-eyebrow">{t('ESPACE CLOSEUR')}</p>
          <h1 id="closer-accesses-title">{t('Mes accès')}</h1>
          <p>{t('Vos dossiers approuvés, actifs et signés. Les coordonnées ne sont chargées qu’à votre demande.')}</p>
        </div>
        <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={17} aria-hidden="true" /> {t('Actualiser')}
        </button>
      </header>

      {error && (
        <div className="collaboration-panel" role="alert">
          <p className="collaboration-error">{t(error)}</p>
          <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void load()}>
            <RefreshCw size={17} aria-hidden="true" /> {t('Réessayer')}
          </button>
        </div>
      )}
      {loading && <div className="collaboration-panel" role="status">{t('Chargement de vos accès masqués…')}</div>}
      {!loading && !error && accesses.length === 0 && (
        <div className="collaboration-panel collaboration-empty" role="status">
          <span className="collaboration-empty-icon"><MapPinned size={24} aria-hidden="true" /></span>
          <h2>{t('Aucun accès actif')}</h2>
          <p>{t('Les dossiers approuvés apparaîtront ici pendant la période d’accès.')}</p>
        </div>
      )}
      {!loading && !error && accesses.length > 0 && (
        <div className="collaboration-list collaboration-supplied-list">
          {accesses.map((deal) => {
            const canWork = deal.dealStatus === 'IN_PROGRESS'
            const isSigned = deal.dealStatus === 'CONTRACT_SIGNED' || deal.dealStatus === 'COMMISSIONS_PAID'
            const canOpenReport = !isSigned && (canWork || deal.closingReportStatus === 'SUBMITTED')
            const isRevealed = contactDetails?.dealId === deal.dealId
            return (
              <article className="collaboration-supplied-card" key={deal.dealId}>
                <div className="collaboration-supplied-top">
                  <div>
                    <p className="collaboration-eyebrow">{t(isSigned ? 'DOSSIER SIGNÉ' : 'DOSSIER MASQUÉ')}</p>
                    <h2>{deal.prospectName}</h2>
                  </div>
                  <StatusBadge status={deal.dealStatus} />
                </div>
                <dl className="collaboration-supplied-details">
                  <div><dt>{t('Zone')}</dt><dd>{deal.city || t('Zone non précisée')}</dd></div>
                  <div><dt>{t('Besoin')}</dt><dd>{t(deal.reportNature.replaceAll('_', ' '))}</dd></div>
                  {!isSigned && <div><dt>{t('Accès actif jusqu’au')}</dt><dd>{formatAntananarivoDate(deal.accessExpiresAt, language)}</dd></div>}
                  {!isSigned && <div><dt>{t('Temps restant')}</dt><dd><Countdown expiresAt={deal.accessExpiresAt} /></dd></div>}
                  <div><dt>{t('Rapport')}</dt><dd>{t(deal.closingReportStatus === 'SUBMITTED'
                    ? 'Soumis · lecture seule'
                    : deal.closingReportStatus === 'DRAFT' ? 'Brouillon' : 'Aucun')}</dd></div>
                </dl>

                {isSigned && <p className="collaboration-muted">{t('Déjà signé par l’admin. Vos commissions restent accessibles dans votre espace commissions.')}</p>}
                {!isSigned && contactDetails?.dealId === deal.dealId && (
                  <ContactDetails details={contactDetails} onClose={hideContacts} />
                )}
                {!isSigned && contactError && contactErrorDealId === deal.dealId && revealingDealId === null && (
                  <p className="collaboration-error" role="alert">{contactError}</p>
                )}
                {timelineError && isSigned && <p className="collaboration-error" role="alert">{timelineError}</p>}
                <div className="collaboration-access-actions">
                  {isSigned ? (
                    <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void toggleTimeline(deal.dealId)} disabled={timelineLoadingId === deal.dealId}>
                      <ScrollText size={17} aria-hidden="true" />
                      {t(timelineLoadingId === deal.dealId ? 'Chargement de la frise…' : openTimelineId === deal.dealId ? 'Masquer la frise' : 'Voir la frise et le numéro de vente')}
                    </button>
                  ) : <button
                    className="ui-button ui-button-secondary collaboration-action"
                    type="button"
                    onClick={() => isRevealed ? hideContacts() : void revealContacts(deal.dealId)}
                    disabled={revealingDealId !== null}
                    aria-busy={revealingDealId === deal.dealId}
                  >
                    {isRevealed ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                    {t(revealingDealId === deal.dealId ? 'Chargement des coordonnées…' : isRevealed ? 'Masquer les coordonnées' : 'Afficher les coordonnées')}
                  </button>}
                  {canOpenReport && (
                    <button className="ui-button ui-button-primary collaboration-action" type="button" onClick={() => { hideContacts(); onOpenReport(deal) }}>
                      <FileText size={17} aria-hidden="true" />
                      {t(deal.closingReportStatus === 'SUBMITTED' ? 'Consulter le rapport' : 'Rapport de clôture')}
                    </button>
                  )}
                  {canWork && (
                    <button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => { hideContacts(); onDeclareLost(deal) }}>
                      <CircleOff size={17} aria-hidden="true" /> {t('Déclarer perdu')}
                    </button>
                  )}
                </div>
                {isSigned && openTimelineId === deal.dealId && timelines[deal.dealId] && (
                  <section className="collaboration-panel collaboration-timeline-panel" aria-label={t('Frise du dossier signé')}>
                    <h3>{t('Frise du dossier')}</h3>
                    {timelines[deal.dealId].saleNumber && <p><strong>{t('Numéro de vente :')}</strong> {timelines[deal.dealId].saleNumber}</p>}
                    <ol className="collaboration-timeline">
                      {timelines[deal.dealId].steps.map((step, index) => (
                        <li key={`${step.status}-${step.at}-${index}`}>
                          <span className="collaboration-timeline-marker" aria-hidden="true" />
                          <div className="collaboration-timeline-content">
                            <StatusBadge status={step.status} />
                            <time dateTime={step.at}>{formatAntananarivoDate(step.at, language)}</time>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
