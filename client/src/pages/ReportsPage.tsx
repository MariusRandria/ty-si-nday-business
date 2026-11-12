import type { Report } from '../types/report'
import ReportTable from '../components/reports/ReportTable'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'

const PENDING_REPORT_STATUSES = ['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER']

export default function ReportsPage({ reports, onNewReport }: { reports: Report[]; onNewReport: () => void }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState('TOUS')
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => reports.filter((report) => (filter === 'TOUS' || (filter === 'PENDING' ? PENDING_REPORT_STATUSES.includes(report.status) : report.status === filter)) && report.companyName.toLowerCase().includes(query.toLowerCase())), [filter, query, reports])
  const count = (status: string) => status === 'TOUS' ? reports.length : status === 'PENDING' ? reports.filter((report) => PENDING_REPORT_STATUSES.includes(report.status)).length : reports.filter((report) => report.status === status).length
  return <><section className="page-heading"><div><p className="eyebrow">{t('SUIVI DE PROSPECTION')}</p><h1>{t('Mes rapports')}</h1><p className="intro">{t('Suivez le traitement et le versement de vos commissions. Les montants restent estimatifs jusqu’à la validation.')}</p></div><button className="primary-button" onClick={onNewReport}>＋ {t('Nouveau rapport')}</button></section><div className="filter-row"><button className={`filter ${filter === 'TOUS' ? 'active' : ''}`} onClick={() => setFilter('TOUS')}>{t('Tous')} <b>{count('TOUS')}</b></button><button className={`filter ${filter === 'PENDING' ? 'active' : ''}`} onClick={() => setFilter('PENDING')}>{t('En attente')} <b>{count('PENDING')}</b></button><button className={`filter ${filter === 'VALIDE' ? 'active' : ''}`} onClick={() => setFilter('VALIDE')}>{t('Validés à payer')} <b>{count('VALIDE')}</b></button><button className={`filter ${filter === 'PAYE' ? 'active' : ''}`} onClick={() => setFilter('PAYE')}>{t('Payés')} <b>{count('PAYE')}</b></button><button className={`filter ${filter === 'REJETE' ? 'active' : ''}`} onClick={() => setFilter('REJETE')}>{t('Rejetés')} <b>{count('REJETE')}</b></button><input className="filter search-input" aria-label={t('Rechercher une entreprise')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`⌕ ${t('Rechercher une entreprise')}`} /></div><section className="panel reports-panel full"><ReportTable reports={filtered} /></section></>
}
