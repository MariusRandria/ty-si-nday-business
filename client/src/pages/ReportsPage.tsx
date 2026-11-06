import type { Report } from '../types/report'
import ReportTable from '../components/reports/ReportTable'
import { useMemo, useState } from 'react'

const PENDING_REPORT_STATUSES = ['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER']

export default function ReportsPage({ reports, onNewReport }: { reports: Report[]; onNewReport: () => void }) {
  const [filter, setFilter] = useState('TOUS')
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => reports.filter((report) => (filter === 'TOUS' || (filter === 'PENDING' ? PENDING_REPORT_STATUSES.includes(report.status) : report.status === filter)) && report.companyName.toLowerCase().includes(query.toLowerCase())), [filter, query, reports])
  const count = (status: string) => status === 'TOUS' ? reports.length : status === 'PENDING' ? reports.filter((report) => PENDING_REPORT_STATUSES.includes(report.status)).length : reports.filter((report) => report.status === status).length
  return <><section className="page-heading"><div><p className="eyebrow">SUIVI DE PROSPECTION</p><h1>Mes rapports</h1><p className="intro">Suivez le traitement et le versement de vos commissions. Les montants restent estimatifs jusqu’à la validation.</p></div><button className="primary-button" onClick={onNewReport}>＋ Nouveau rapport</button></section><div className="filter-row"><button className={`filter ${filter === 'TOUS' ? 'active' : ''}`} onClick={() => setFilter('TOUS')}>Tous <b>{count('TOUS')}</b></button><button className={`filter ${filter === 'PENDING' ? 'active' : ''}`} onClick={() => setFilter('PENDING')}>En attente <b>{count('PENDING')}</b></button><button className={`filter ${filter === 'VALIDE' ? 'active' : ''}`} onClick={() => setFilter('VALIDE')}>Validés à payer <b>{count('VALIDE')}</b></button><button className={`filter ${filter === 'PAYE' ? 'active' : ''}`} onClick={() => setFilter('PAYE')}>Payés <b>{count('PAYE')}</b></button><button className={`filter ${filter === 'REJETE' ? 'active' : ''}`} onClick={() => setFilter('REJETE')}>Rejetés <b>{count('REJETE')}</b></button><input className="filter search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="⌕ Rechercher une entreprise" /></div><section className="panel reports-panel full"><ReportTable reports={filtered} /></section></>
}
