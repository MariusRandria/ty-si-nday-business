import { useMemo, useState } from 'react'
import { CheckCircle2, Clock3, FileText, Plus, Search, WalletCards } from 'lucide-react'
import { useI18n } from '../i18n'
import type { Report } from '../types/report'
import ReportTable from '../components/reports/ReportTable'

const PENDING_REPORT_STATUSES = ['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER']
type ReportFilter = 'TOUS' | 'PENDING' | 'VALIDE' | 'PAYE' | 'REJETE'

export default function ReportsPage({ reports, onNewReport }: { reports: Report[]; onNewReport: () => void }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState<ReportFilter>('TOUS')
  const [query, setQuery] = useState('')

  const filtered = useMemo(
    () => reports.filter((report) =>
      (filter === 'TOUS' || (filter === 'PENDING' ? PENDING_REPORT_STATUSES.includes(report.status) : report.status === filter))
      && report.companyName.toLowerCase().includes(query.toLowerCase()),
    ),
    [filter, query, reports],
  )

  const count = (status: ReportFilter) => status === 'TOUS'
    ? reports.length
    : status === 'PENDING'
      ? reports.filter((report) => PENDING_REPORT_STATUSES.includes(report.status)).length
      : reports.filter((report) => report.status === status).length

  const summary = [
    { label: t('Rapports enregistrés'), value: reports.length, icon: FileText, tone: 'violet' },
    { label: t('En attente'), value: count('PENDING'), icon: Clock3, tone: 'amber' },
    { label: t('Validés à payer'), value: count('VALIDE'), icon: CheckCircle2, tone: 'blue' },
    { label: t('Payés'), value: count('PAYE'), icon: WalletCards, tone: 'green' },
  ]

  const filters: { value: ReportFilter; label: string }[] = [
    { value: 'TOUS', label: t('Tous') },
    { value: 'PENDING', label: t('En attente') },
    { value: 'VALIDE', label: t('Validés à payer') },
    { value: 'PAYE', label: t('Payés') },
    { value: 'REJETE', label: t('Rejetés') },
  ]

  return (
    <div className="agent-reports-page">
      <header className="page-heading reports-page-heading">
        <div>
          <p className="eyebrow">{t('SUIVI DE PROSPECTION')}</p>
          <h1>{t('Mes rapports')}</h1>
          <p className="intro">{t('Suivez le traitement et le versement de vos commissions. Les montants restent estimatifs jusqu’à la validation.')}</p>
        </div>
        <button className="primary-button" type="button" onClick={onNewReport}>
          <Plus size={18} aria-hidden="true" />
          {t('Nouveau rapport')}
        </button>
      </header>

      <section className="reports-summary-grid" aria-label={t('Indicateurs clés')}>
        {summary.map(({ label, value, icon: Icon, tone }) => (
          <article className={`reports-summary-card is-${tone}`} key={label}>
            <span className="reports-summary-icon"><Icon size={19} aria-hidden="true" /></span>
            <span className="reports-summary-label">{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="panel reports-panel full" aria-labelledby="reports-history-title">
        <div className="reports-workspace-heading">
          <div>
            <p className="section-kicker">{t('SUIVI DE PROSPECTION')}</p>
            <h2 id="reports-history-title">{t('Historique des rapports')}</h2>
          </div>
          <span className="reports-result-count" aria-label={`${t('Résultats affichés')} : ${filtered.length} / ${reports.length}`}>
            <strong>{filtered.length}</strong><span> / {reports.length}</span>
          </span>
        </div>

        <div className="reports-controls">
          <div className="reports-filter-group" role="group" aria-label={t('Filtres des rapports')}>
            {filters.map(({ value, label }) => (
              <button
                className={`filter${filter === value ? ' active' : ''}`}
                type="button"
                key={value}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}<b>{count(value)}</b>
              </button>
            ))}
          </div>
          <label className="reports-search-field">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">{t('Rechercher une entreprise')}</span>
            <input
              className="reports-search-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Rechercher une entreprise')}
            />
          </label>
        </div>

        {filtered.length > 0 ? (
          <ReportTable reports={filtered} />
        ) : (
          <div className="reports-empty-state">
            <span className="reports-empty-icon"><FileText size={23} aria-hidden="true" /></span>
            <h3>{reports.length === 0 ? t('Aucun rapport enregistré pour le moment.') : t('Aucun rapport trouvé pour ces critères.')}</h3>
            {reports.length > 0 && <p>{t('Modifiez le filtre ou votre recherche pour afficher des rapports.')}</p>}
            {reports.length === 0 && (
              <button className="primary-button" type="button" onClick={onNewReport}>
                <Plus size={17} aria-hidden="true" />{t('Créer mon premier rapport')}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
