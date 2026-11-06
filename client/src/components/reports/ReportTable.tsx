import type { Report } from '../../types/report'

function formatDate(value: string) { return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(value)) }

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
  return <div className="table-wrap"><table><thead><tr><th>ENTREPRISE</th><th>PRODUIT / PRESTATION</th><th>TYPE DE RAPPORT</th><th>CODE PROMO</th><th title="Montant estimatif avant validation, définitif après validation">COMMISSION</th><th>DATE</th><th>INTÉRÊT</th><th>STATUT</th><th /></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><div className="company"><span>{report.companyName.slice(0, 1)}</span><strong>{report.companyName}</strong></div></td><td>{report.product?.title ?? report.customServiceDescription ?? 'Prestation sur mesure'}</td><td>{REPORT_TYPE_LABEL[report.reportType ?? 'LEAD'] ?? 'Apport de contact'}</td><td>{report.promoCode ?? '—'}</td><td>{report.commissionAmount == null ? '—' : <>{report.commissionAmount.toLocaleString('fr-FR')} Ar{report.commissionEstimated && <small> estimée</small>}</>}</td><td>{formatDate(report.meetingAt)}</td><td><span className={`interest ${report.interestLevel.toLowerCase()}`}><i />{report.interestLevel.toLowerCase()}</span></td><td><span className={`status ${report.status.toLowerCase()}`}>{REPORT_STATUS_LABEL[report.status] ?? report.status.replace('_', ' ').toLowerCase()}</span></td><td><button className="row-action" aria-label={`Ouvrir ${report.companyName}`}>→</button></td></tr>)}</tbody></table></div>
}
