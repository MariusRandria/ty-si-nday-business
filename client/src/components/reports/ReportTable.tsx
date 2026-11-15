import type { Report } from '../../types/report'
import { useI18n } from '../../i18n'

function formatDate(value: string, language: 'fr' | 'en') { return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'fr-FR', { day: '2-digit', month: 'short' }).format(new Date(value)) }

const REPORT_TYPE_LABEL: Record<string, string> = {
  LEAD: 'Apport de contact',
  PROVIDED_CONTACT: 'Vente · contact fourni',
  FULL_CYCLE: 'Prospection + vente',
}

const REPORT_STATUS_LABEL: Record<string, string> = {
  BROUILLON: 'Brouillon',
  SOUMIS: 'En attente',
  EN_VERIFICATION: 'En vérification',
  VALIDE: 'Validé · à payer',
  PAYE: 'Payé',
  REJETE: 'Rejeté',
  A_COMPLETER: 'À compléter',
}

export default function ReportTable({ reports }: { reports: Report[] }) {
  const { language, t } = useI18n()
  return <div className="table-wrap"><table><thead><tr><th>{t('ENTREPRISE')}</th><th>{t('PRODUIT / PRESTATION')}</th><th>{t('TYPE DE RAPPORT')}</th><th>{t('CODE PROMO')}</th><th title={t('Montant estimatif avant validation, définitif après validation')}>{t('COMMISSION')}</th><th>{t('DATE')}</th><th>{t('INTÉRÊT')}</th><th>{t('STATUT')}</th><th /></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><div className="company"><span>{report.companyName.slice(0, 1)}</span><strong>{report.companyName}</strong></div></td><td>{report.product?.title ?? report.customServiceDescription ?? t('Prestation sur mesure')}</td><td>{t(REPORT_TYPE_LABEL[report.reportType ?? 'LEAD'] ?? 'Apport de contact')}</td><td>{report.promoCode ?? '—'}</td><td>{report.commissionAmount == null ? '—' : <>{report.commissionAmount.toLocaleString(language === 'en' ? 'en-US' : 'fr-FR')} Ar{report.commissionEstimated && <small> {t('estimée')}</small>}</>}</td><td>{formatDate(report.meetingAt, language)}</td><td><span className={`interest ${report.interestLevel.toLowerCase()}`}><i />{t(report.interestLevel.toLowerCase())}</span></td><td><span className={`status ${report.status.toLowerCase()}`}>{t(REPORT_STATUS_LABEL[report.status] ?? report.status.replace('_', ' ').toLowerCase())}</span></td><td><button className="row-action" aria-label={`${t('Ouvrir')} ${report.companyName}`}>→</button></td></tr>)}</tbody></table></div>
}
