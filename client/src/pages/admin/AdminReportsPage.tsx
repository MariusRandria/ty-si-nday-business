import { useEffect, useMemo, useState } from 'react'
import api, { type AdminReport, type Setting } from '../../api/client'
import './AdminReportsPage.css'

type DetailedReport = AdminReport & {
  city?: string
  address?: string
  contactName?: string
  contactRole?: string
  contactPhone?: string
  contactEmail?: string | null
  contactType?: string
  summary?: string
  nextStep?: string | null
  isDuplicateFlag?: boolean
  customServiceDescription?: string | null
}

const REPORT_TYPE_LABEL: Record<string, string> = {
  LEAD: 'Apport de contact (Lead)',
  PROVIDED_CONTACT: 'Vente d’un contact fourni',
  FULL_CYCLE: 'Prospection + vente',
}

const VALIDATION_LABEL: Record<string, string> = {
  VALIDE: 'Rapport validé · en attente de versement',
  PAYE: 'Commission versée sur le portefeuille',
  REJETE: 'Rapport rejeté',
  A_COMPLETER: 'Complément demandé',
  SOUMIS: 'En attente de validation',
  EN_VERIFICATION: 'Vérification en cours',
}

const REPORT_NATURE_LABEL: Record<string, string> = {
  CONTACT: 'Prise de contact',
  RENDEZ_VOUS: 'Rendez-vous',
  CONTRAT: 'Contrat',
}

function getCommissionMap(settings: Setting[]): Record<string, number> {
  const values = Object.fromEntries(settings.map((setting) => [setting.key, Number(setting.value || 0)]))
  const lead = values.report_lead_amount ?? 50000
  const sale = values.report_sale_amount ?? 100000
  return {
    LEAD: lead,
    PROVIDED_CONTACT: sale,
    FULL_CYCLE: lead + sale,
  }
}

function buildValidationHistory(report: DetailedReport) {
  const entries = [...(report.statusHistory ?? [])].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )

  if (entries.length === 0) {
    return [{
      label: VALIDATION_LABEL[report.status] ?? 'Statut du rapport',
      date: report.meetingAt,
      comment: 'Historique non renseigné.',
    }]
  }

  return entries.map((entry) => ({
    label: VALIDATION_LABEL[entry.toStatus] ?? entry.toStatus.replace('_', ' ').toLowerCase(),
    date: entry.createdAt,
    comment: entry.comment ?? 'Validation enregistrée.',
  }))
}

export default function AdminReportsPage() {
  const [items, setItems] = useState<DetailedReport[]>([])
  const [settings, setSettings] = useState<Setting[]>([])
  const [selected, setSelected] = useState<DetailedReport | null>(null)
  const [query, setQuery] = useState('')
  const [signatureConfirmed, setSignatureConfirmed] = useState(false)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api.adminReports(), api.settings()])
      .then(([reports, settingList]) => {
        setItems(reports as DetailedReport[])
        setSettings(settingList)
      })
      .catch((caught) => setActionError(caught instanceof Error ? caught.message : 'Impossible de charger les rapports et paramètres.'))
  }, [])

  const commissionMap = useMemo(() => getCommissionMap(settings), [settings])

  function selectReport(item: DetailedReport) {
    setSelected(item)
    setSignatureConfirmed(item.contractSigned ?? false)
    setActionError('')
  }

  async function decide(item: DetailedReport, status: 'VALIDE' | 'REJETE' | 'A_COMPLETER' | 'PAYE') {
    setBusy(true)
    setActionError('')
    try {
      await api.updateReport(item.id, status, {
        rejectionReason: status === 'REJETE' ? 'Informations insuffisantes.' : undefined,
        contractSigned: status === 'VALIDE' ? signatureConfirmed : undefined,
      })
      const historyEntry = {
        id: Date.now(),
        toStatus: status,
        comment: status === 'VALIDE'
          ? 'Rapport validé après confirmation de la signature. En attente de versement.'
          : status === 'PAYE'
            ? 'Commission versée sur le portefeuille.'
            : status === 'REJETE'
              ? 'Rapport rejeté.'
              : 'Complément demandé.',
        createdAt: new Date().toISOString(),
      }

      const updatedItem = {
        ...item,
        status,
        contractSigned: status === 'VALIDE' ? true : item.contractSigned,
        statusHistory: [historyEntry, ...(item.statusHistory ?? [])],
      }
      setItems((current) => current.map((entry) => entry.id === item.id ? updatedItem : entry))
      setSelected(status === 'VALIDE' ? updatedItem : null)
      setSignatureConfirmed(status === 'VALIDE')
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Impossible de mettre à jour le rapport.')
    } finally {
      setBusy(false)
    }
  }

  const visible = items.filter((item) => item.companyName.toLowerCase().includes(query.toLowerCase()))

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CONTRÔLE QUALITÉ</p>
          <h1>Rapports à traiter</h1>
          <p className="intro">Ouvrez chaque rapport pour vérifier l’intégralité des informations émises par l’agent.</p>
        </div>
        <button className="outline-button">↓ Exporter les rapports</button>
      </section>

      <div className="filter-row">
        <button className="filter active">À traiter <b>{items.filter((item) => ['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER'].includes(item.status)).length}</b></button>
        <button className="filter">Doublons signalés <b>{items.filter((item) => item.isDuplicateFlag).length}</b></button>
        <input className="filter search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="⌕ Rechercher une entreprise" />
      </div>
      {actionError && <p className="settings-error" role="alert">{actionError}</p>}

      <section className="panel admin-table-panel">
        <table>
          <thead>
            <tr>
              <th>ENTREPRISE</th>
              <th>AGENT</th>
              <th>PRODUIT</th>
              <th>TYPE</th>
              <th>MONTANT</th>
              <th>INTÉRÊT</th>
              <th>STATUT</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const type = item.reportType ?? 'LEAD'
              const amount = item.commissionAmount ?? commissionMap[type] ?? 0

              return (
                <tr key={item.id}>
                  <td>
                    <button className="table-link" onClick={() => selectReport(item)}>
                      <span className="company"><span>{item.companyName.slice(0, 1)}</span><strong>{item.companyName}</strong></span>
                    </button>
                    <small className="table-subtext">{new Date(item.meetingAt).toLocaleDateString('fr-FR')} · Cliquer pour ouvrir le détail</small>
                  </td>
                  <td>{item.agent.agentProfile ? `${item.agent.agentProfile.firstName} ${item.agent.agentProfile.lastName}` : item.agent.email}</td>
                  <td>{item.product?.title ?? item.customServiceDescription ?? 'Prestation sur mesure'}</td>
                  <td>{REPORT_TYPE_LABEL[type] ?? type}{item.promoCode && <small className="table-subtext">Code : {item.promoCode}</small>}</td>
                  <td><strong>{amount.toLocaleString('fr-FR')} Ar</strong></td>
                  <td><span className={`interest ${item.interestLevel.toLowerCase()}`}><i />{item.interestLevel.toLowerCase()}</span></td>
                  <td><span className={`status ${item.status.toLowerCase()}`}>{VALIDATION_LABEL[item.status] ?? item.status.replace('_', ' ').toLowerCase()}</span></td>
                  <td><button className="outline-button compact" onClick={() => selectReport(item)}>Détail / action</button></td>
                </tr>
              )
            })}
            {visible.length === 0 && <tr><td colSpan={8} className="empty-state">Aucun rapport ne correspond à cette recherche.</td></tr>}
          </tbody>
        </table>
      </section>

      {selected && <ReportDetail report={selected} commissionMap={commissionMap} signatureConfirmed={signatureConfirmed} onSignatureChange={setSignatureConfirmed} busy={busy} error={actionError} onClose={() => setSelected(null)} onDecide={(status) => void decide(selected, status)} />}
    </>
  )
}

function ReportDetail({
  report,
  commissionMap,
  signatureConfirmed,
  onSignatureChange,
  busy,
  error,
  onClose,
  onDecide,
}: {
  report: DetailedReport
  commissionMap: Record<string, number>
  signatureConfirmed: boolean
  onSignatureChange: (confirmed: boolean) => void
  busy: boolean
  error: string
  onClose: () => void
  onDecide: (status: 'VALIDE' | 'REJETE' | 'A_COMPLETER' | 'PAYE') => void
}) {
  const type = report.reportType ?? 'LEAD'
  const amount = report.commissionAmount ?? commissionMap[type] ?? 0
  const history = buildValidationHistory(report)

  return (
    <div className="modal-backdrop admin-report-detail-backdrop" onClick={onClose}>
      <section
        className="modal report-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-report-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="modal-close" aria-label="Fermer le détail du rapport" onClick={onClose}>×</button>

        <div className="detail-header">
          <div>
            <p className="eyebrow">RAPPORT #{report.id} · DOSSIER COMPLET</p>
            <h2 id="admin-report-detail-title">{report.companyName}</h2>
            <p>{report.product?.title ?? report.customServiceDescription ?? 'Prestation sur mesure'} · {new Date(report.meetingAt).toLocaleString('fr-FR')}</p>
          </div>
          <span className={`status ${report.status.toLowerCase()}`}>{report.status.replace('_', ' ').toLowerCase()}</span>
        </div>

        {report.isDuplicateFlag && <div className="duplicate-alert">⚠ Doublon potentiel détecté. Vérification manuelle recommandée.</div>}

        <div className="detail-grid">
          <Detail label="Agent" value={report.agent.agentProfile ? `${report.agent.agentProfile.firstName} ${report.agent.agentProfile.lastName}` : report.agent.email} />
          <Detail label="Type de collaboration" value={REPORT_TYPE_LABEL[type] ?? type} />
          <Detail label="Nature du rapport" value={REPORT_NATURE_LABEL[report.reportNature ?? ''] ?? 'Non renseignée'} />
          <Detail label="Montant" value={`${amount.toLocaleString('fr-FR')} Ar`} />
          {report.promoCode && <Detail label="Code promo utilisé" value={report.promoCode} />}
          <Detail label="Contrat signé" value={report.contractSigned ? 'Oui' : 'À confirmer par l’administration'} />
          <Detail label="Type de contact" value={report.contactType ?? 'Non renseigné'} />
          <Detail label="Ville" value={report.city ?? 'Non renseignée'} />
          <Detail label="Adresse" value={report.address ?? 'Non renseignée'} />
          <Detail label="Contact" value={report.contactName ?? 'Non renseigné'} />
          <Detail label="Fonction" value={report.contactRole ?? 'Non renseignée'} />
          <Detail label="Téléphone" value={report.contactPhone ?? 'Non renseigné'} />
          <Detail label="Email" value={report.contactEmail ?? 'Non renseigné'} />
          <Detail label="Niveau d’intérêt" value={report.interestLevel} />
        </div>

        <div className="detail-block"><span>Compte rendu</span><p>{report.summary ?? 'Aucun compte rendu renseigné.'}</p></div>
        <div className="detail-block"><span>Prochaine étape</span><p>{report.nextStep ?? 'Aucune prochaine étape renseignée.'}</p></div>

        <div className="detail-block">
          <span>Historique de validation</span>
          <ul className="validation-history">
            {history.map((entry) => (
              <li key={`${entry.label}-${entry.date}`}>
                <strong>{entry.label}</strong>
                <small>{new Date(entry.date).toLocaleString('fr-FR')}</small>
                <p>{entry.comment}</p>
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="outline-button" onClick={onClose} disabled={busy}>Fermer</button>
          {['BROUILLON', 'SOUMIS', 'EN_VERIFICATION', 'A_COMPLETER'].includes(report.status) && (
            <>
              <label className="contract-signature-confirm"><input type="checkbox" checked={signatureConfirmed} onChange={(event) => onSignatureChange(event.target.checked)} /> Contrat signé, vérifié par l’administration</label>
              <button className="reject-button" disabled={busy} onClick={() => onDecide('REJETE')}>Rejeter</button>
              <button className="outline-button" disabled={busy} onClick={() => onDecide('A_COMPLETER')}>Demander un complément</button>
              <button className="primary-button" disabled={busy || !signatureConfirmed} onClick={() => onDecide('VALIDE')}>{busy ? 'Enregistrement...' : 'Valider le rapport'}</button>
            </>
          )}
          {report.status === 'VALIDE' && <button className="primary-button" disabled={busy} onClick={() => onDecide('PAYE')}>{busy ? 'Versement...' : `Verser ${amount.toLocaleString('fr-FR')} Ar au portefeuille`}</button>}
        </div>
      </section>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail-item"><span>{label}</span><strong>{value}</strong></div>
}