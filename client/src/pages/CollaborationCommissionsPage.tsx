import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import api, { type CollaborationCommission, type CollaborationCommissionSummary } from '../api/client'
import { useI18n } from '../i18n'
import { StatusBadge } from '../components/collaboration/StatusBadge'
import '../components/collaboration/collaboration.css'
import '../components/ui/ui.css'
import { formatAntananarivoDate, formatAr } from '../utils/collaboration-ui'

type CommissionTab = 'pending' | 'paid' | 'cancelled'

const paymentModes: Record<NonNullable<CollaborationCommission['paymentMode']>, string> = {
  MVOLA: 'MVola',
  ORANGE_MONEY: 'Orange Money',
  AIRTEL_MONEY: 'Airtel Money',
  BANK_TRANSFER: 'Virement',
  CASH: 'Espèces',
}

function CommissionCard({ commission, t, language }: { commission: CollaborationCommission; t: (text: string) => string; language: 'fr' | 'en' }) {
  const amount = commission.netAmount ?? commission.amount
  return (
    <article className="collaboration-commission">
      <div className="collaboration-commission-top">
        <p className="collaboration-commission-amount">{formatAr(amount, language)}</p>
        <StatusBadge status={commission.status} />
      </div>
      <dl className="collaboration-commission-details">
        <div><dt>{t('Vente :')}</dt><dd>{commission.saleNumber ?? t('En attente de numéro')}</dd></div>
        <div><dt>{t('Générée le :')}</dt><dd>{formatAntananarivoDate(commission.generatedAt, language)}</dd></div>
        {commission.status === 'PENDING' && <div><dt>{t('Créditée le :')}</dt><dd>{formatAntananarivoDate(commission.generatedAt, language)}</dd></div>}
        {commission.paidAt && <div><dt>{t('Payée le :')}</dt><dd>{formatAntananarivoDate(commission.paidAt, language)}</dd></div>}
        {commission.paymentMode && <div><dt>{t('Mode :')}</dt><dd>{t(paymentModes[commission.paymentMode])}</dd></div>}
        {commission.paymentReference && <div><dt>{t('Référence :')}</dt><dd>{commission.paymentReference}</dd></div>}
      </dl>
    </article>
  )
}

export default function CollaborationCommissionsPage() {
  const { t, language } = useI18n()
  const [tab, setTab] = useState<CommissionTab>('pending')
  const [commissions, setCommissions] = useState<CollaborationCommission[]>([])
  const [summary, setSummary] = useState<CollaborationCommissionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [commissionRows, commissionSummary] = await Promise.all([
        api.collaborationCommissions(),
        api.collaborationCommissionSummary(),
      ])
      setCommissions(commissionRows)
      setSummary(commissionSummary)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de charger vos commissions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const visibleCommissions = useMemo(() => commissions.filter((commission) => (
    tab === 'paid'
      ? commission.status === 'PAID'
      : tab === 'cancelled'
        ? commission.status === 'CANCELLED'
        : commission.status === 'PENDING' || commission.status === 'ON_HOLD'
  )), [commissions, tab])

  const totals = summary?.totalsByCurrency.find(({ currency }) => currency === 'Ar')
  const pendingTotal = totals?.pending ?? '0'
  const paidTotal = totals?.paid ?? '0'
  const onHoldTotal = totals?.onHold ?? '0'

  return (
    <section className="collaboration-page" aria-labelledby="commissions-title">
      <header className="collaboration-page-header">
        <h1 id="commissions-title">{t('Mes commissions')}</h1>
        <p>{t('Vos commissions validées sont créditées à votre portefeuille. Demandez un retrait quand vous le souhaitez.')}</p>
      </header>

      <div className="collaboration-summary">
        <div className="collaboration-summary-card"><span>{t('Créditées au portefeuille')}</span><strong>{formatAr(pendingTotal, language)}</strong></div>
        <div className="collaboration-summary-card"><span>{t('En attente de décision')}</span><strong>{formatAr(onHoldTotal, language)}</strong></div>
        <div className="collaboration-summary-card"><span>{t('Total payé')}</span><strong>{formatAr(paidTotal, language)}</strong></div>
      </div>

      <div className="collaboration-tabs" role="tablist" aria-label={t('Filtrer les commissions')}>
        <button type="button" className="collaboration-tab" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>{t('Disponibles')}</button>
        <button type="button" className="collaboration-tab" role="tab" aria-selected={tab === 'paid'} onClick={() => setTab('paid')}>{t('Payées')}</button>
        <button type="button" className="collaboration-tab" role="tab" aria-selected={tab === 'cancelled'} onClick={() => setTab('cancelled')}>{t('Annulées')}</button>
      </div>

      {error && <div className="collaboration-panel" role="alert"><p className="collaboration-error">{t(error)}</p><button className="ui-button ui-button-secondary collaboration-action" type="button" onClick={() => void load()}><RefreshCw size={17} /> {t('Réessayer')}</button></div>}
      {loading && <div className="collaboration-panel" role="status">{t('Chargement de vos commissions…')}</div>}
      {!loading && !error && visibleCommissions.length === 0 && (
        <div className="collaboration-panel" role="status">
          <h2>{t(tab === 'paid' ? 'Aucun ancien paiement direct' : tab === 'cancelled' ? 'Aucune commission annulée' : 'Aucune commission disponible')}</h2>
          <p>{t('Les commissions liées à vos ventes apparaîtront ici.')}</p>
        </div>
      )}
      {!loading && !error && visibleCommissions.length > 0 && (
        <div className="collaboration-list">{visibleCommissions.map((commission) => <CommissionCard key={commission.id} commission={commission} t={t} language={language} />)}</div>
      )}
    </section>
  )
}
