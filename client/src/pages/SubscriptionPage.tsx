import { useEffect, useState, type FormEvent } from 'react'
import { BadgeCheck, Clock3, CreditCard, ExternalLink, ShieldCheck, Upload } from 'lucide-react'
import api, { type SubscriptionOverview } from '../api/client'
import { LoadingState } from '../components/ui/LoadingState'
import { notify } from '../utils/toast'
import { useI18n } from '../i18n'
import './SubscriptionPage.css'

function dateLabel(value: string | null | undefined, language: 'fr' | 'en') {
  return value ? new Date(value).toLocaleDateString(language === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}

export default function SubscriptionPage({ onOpenProspects }: { onOpenProspects: () => void }) {
  const { language, t } = useI18n()
  const [overview, setOverview] = useState<SubscriptionOverview | null>(null)
  const [reference, setReference] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    setOverview(await api.subscriptionOverview())
  }

  useEffect(() => {
    let active = true
    api.subscriptionOverview()
      .then((data) => { if (active) setOverview(data) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? t(caught.message) : t('Impossible de charger votre abonnement.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [t])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!proof) {
      setError(t('Joignez le reçu ou la capture du paiement.'))
      return
    }
    if (proof.size > 5 * 1024 * 1024) {
      setError(t('Le justificatif ne doit pas dépasser 5 Mo.'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const emailSent = await api.submitSubscription(reference, proof)
      setReference('')
      setProof(null)
      const input = document.getElementById('badge-payment-proof') as HTMLInputElement | null
      if (input) input.value = ''
      await refresh()
      notify(
        emailSent
          ? t('Demande envoyée. Un email de confirmation vous a été transmis.')
          : t('Demande enregistrée et en attente de vérification, mais l’email de confirmation n’a pas pu être envoyé.'),
        emailSent ? 'success' : 'info',
      )
    } catch (caught) {
      const message = caught instanceof Error ? t(caught.message) : t('Impossible d’envoyer la demande.')
      setError(message)
      notify(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState label={t('Chargement de votre badge abonné…')} />

  const config = overview?.config
  const current = overview?.current
  const latest = overview?.latestRequest
  const pending = latest?.status === 'PENDING'

  return <div className="badge-subscription-page">
    <header className="page-heading badge-subscription-heading">
      <div><p className="eyebrow">{t('AVANTAGES TY SY NDAY')}</p><h1>{t('Badge abonné')}</h1><p className="intro">{t('Activez votre badge pour accéder aux contacts prospects partagés par l’administration.')}</p></div>
      <span className={`badge-subscription-status ${current ? 'active' : ''}`}>{current ? <><BadgeCheck size={18} /> {t('BADGE ACTIF')}</> : <><ShieldCheck size={18} /> {t('BADGE NON ACTIF')}</>}</span>
    </header>

    {error && <div className="settings-error" role="alert">{error}</div>}

    {current && <section className="panel badge-active-panel">
      <span className="badge-status-icon"><BadgeCheck size={24} /></span>
      <div><span className="section-kicker">{t('ABONNEMENT EN COURS')}</span><h2>{t('Votre accès aux prospects est actif')}</h2><p>{t('Valide jusqu’au')} <strong>{dateLabel(current.expiresAt, language)}</strong>. {t('Vous pouvez consulter les coordonnées et itinéraires des contacts partagés.')}</p></div>
      <button className="primary-button" type="button" onClick={onOpenProspects}>{t('Voir les prospects')} <ExternalLink size={16} /></button>
    </section>}

    {pending && <section className="panel badge-pending-panel" role="status"><Clock3 size={21} /><div><strong>{t('Demande en cours de vérification')}</strong><p>{t('Votre paiement de')} {latest.amount.toLocaleString(language === 'en' ? 'en-US' : 'fr-FR')} Ar ({t('référence')} {latest.transactionRef}) {t('a été transmis. L’accès sera activé après confirmation par l’administration.')}</p></div></section>}

    {latest?.status === 'REJECTED' && <section className="panel badge-rejected-panel" role="alert"><strong>{t('La demande précédente n’a pas été validée.')}</strong><p>{latest.rejectionReason || t('Veuillez vérifier le paiement et transmettre une nouvelle demande.')}</p></section>}

    <section className="badge-subscription-grid">
      <article className="panel badge-benefits-panel">
        <span className="section-kicker">{t('VOTRE AVANTAGE')}</span>
        <h2><BadgeCheck size={22} /> {t('Accès aux contacts prospects')}</h2>
        <p>{t('Consultez les entreprises partagées par l’administration, leurs coordonnées détaillées et leur localisation sur la carte.')}</p>
        <div className="badge-subscription-price">{config?.configured ? config.price.toLocaleString(language === 'en' ? 'en-US' : 'fr-FR') : t('À définir')} <small>{config?.configured ? 'Ar' : ''}</small></div>
        <p className="badge-duration">{t('Durée')} : {config?.configured ? t(config.durationDays > 1 ? '{days} jours' : '{days} jour').replace('{days}', String(config.durationDays)) : t('en attente de configuration')}</p>
        <div className="badge-future-benefit"><ShieldCheck size={17} /><span><strong>{t('D’autres avantages arrivent')}</strong><small>{t('Les bénéfices du badge pourront être enrichis ultérieurement.')}</small></span></div>
      </article>

      <article className="panel badge-payment-panel">
        <span className="section-kicker">{t('PAIEMENT MOBILE MONEY')}</span>
        <h2><CreditCard size={21} /> {t(current ? 'Prolonger mon badge' : 'Obtenir mon badge')}</h2>
        {!config?.configured
          ? <p className="badge-config-notice">{t('Le tarif et les coordonnées de paiement ne sont pas encore configurés. L’administration pourra activer les demandes depuis les paramètres.')}</p>
          : <>
            <p className="badge-payment-intro">{t('Effectuez le paiement, puis transmettez la référence de transaction et le reçu. L’accès est activé uniquement après vérification par l’administration.')}</p>
            <div className="badge-payment-destination"><span>{config.paymentOperator}</span><strong>{config.paymentNumber}</strong><small>{t('Au nom de')} {config.paymentName}</small><b>{config.price.toLocaleString(language === 'en' ? 'en-US' : 'fr-FR')} Ar · {t(config.durationDays > 1 ? '{days} jours' : '{days} jour').replace('{days}', String(config.durationDays))}</b></div>
            {!pending && <form className="badge-payment-form" onSubmit={(event) => void submit(event)}>
              <label>{t('Référence de transaction')}<input required minLength={4} maxLength={150} value={reference} onChange={(event) => setReference(event.target.value)} placeholder={t('Ex. numéro de transaction')} /></label>
              <label className="badge-proof-field">{t('Reçu ou capture du paiement')} <small>{t('PDF, JPEG, PNG ou WebP · 5 Mo maximum')}</small>
                <span><Upload size={17} />{proof?.name ?? t('Choisir un justificatif')}</span>
                <input id="badge-payment-proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={(event) => setProof(event.target.files?.[0] ?? null)} />
              </label>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? t('Envoi en cours…') : t('Envoyer pour vérification')}</button>
            </form>}
          </>}
        <p className="badge-manual-review">{t('Le renouvellement est manuel. Le badge expiré ne donne plus accès aux prospects.')}</p>
      </article>
    </section>
  </div>
}
