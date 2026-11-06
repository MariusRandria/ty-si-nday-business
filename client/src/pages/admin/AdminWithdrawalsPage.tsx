import { useEffect, useState, type FormEvent } from 'react'
import api, { type AdminWithdrawal } from '../../api/client'
import { notify } from '../../utils/toast'

type Decision = { item: AdminWithdrawal; status: 'PAYE' | 'REFUSE' }

export default function AdminWithdrawalsPage() {
  const [items, setItems] = useState<AdminWithdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [decisionValue, setDecisionValue] = useState('')

  async function loadWithdrawals() {
    setError('')
    try { setItems(await api.adminWithdrawals()) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de charger les demandes de retrait.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    let active = true
    api.adminWithdrawals()
      .then((data) => { if (active) setItems(data) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger les demandes de retrait.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function update(item: AdminWithdrawal, status: string, paymentReference?: string, rejectReason?: string) {
    setBusyId(item.id)
    setError('')
    try {
      const result = await api.updateWithdrawal(item.id, status, paymentReference, rejectReason)
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status } : entry))
      notify(
        result.warning
          ?? (status === 'PAYE' ? 'Paiement confirmé et email envoyé.' : status === 'REFUSE' ? 'Demande de retrait refusée.' : 'Demande approuvée et email envoyé.'),
        result.warning ? 'error' : 'success',
      )
      setDecision(null)
      setDecisionValue('')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Impossible de traiter cette demande.'
      setError(message)
      notify(message, 'error')
    } finally { setBusyId(null) }
  }

  function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!decision) return
    void update(
      decision.item,
      decision.status,
      decision.status === 'PAYE' ? decisionValue.trim() : undefined,
      decision.status === 'REFUSE' ? decisionValue.trim() : undefined,
    )
  }

  const openWithdrawals = items.filter((item) => ['DEMANDE', 'APPROUVE'].includes(item.status))
  const amountToProcess = openWithdrawals.reduce((total, item) => total + Number(item.amount), 0)

  return <>
    <section className="page-heading"><div><p className="eyebrow">PAIEMENTS MANUELS</p><h1>Retraits</h1><p className="intro">Contrôlez les demandes et confirmez les paiements effectués.</p></div><button className="outline-button" onClick={() => { setLoading(true); void loadWithdrawals() }}>Actualiser</button></section>
    {error && <div className="settings-error" role="alert">{error}</div>}
    <section className="metric-grid"><div className="metric"><span className="metric-label">Montant à traiter</span><div className="metric-value"><strong>{amountToProcess.toLocaleString('fr-FR')}</strong><small>Ar</small></div></div><div className="metric"><span className="metric-label">Demandes ouvertes</span><div className="metric-value"><strong>{openWithdrawals.length}</strong></div></div></section>
    {loading ? <section className="panel empty-state">Chargement des demandes...</section> : items.length === 0 ? <section className="panel empty-state">Aucune demande de retrait pour le moment.</section> : <section className="panel admin-table-panel"><table><thead><tr><th>AGENT</th><th>MONTANT</th><th>OPÉRATEUR</th><th>STATUT</th><th>ACTION</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><div className="company"><span>{item.agent.agentProfile?.firstName.slice(0, 1) ?? 'A'}</span><strong>{item.agent.agentProfile ? `${item.agent.agentProfile.firstName} ${item.agent.agentProfile.lastName}` : 'Agent'}</strong></div><small className="table-subtext">{item.phoneNumber}</small></td><td><strong>{Number(item.amount).toLocaleString('fr-FR')} Ar</strong></td><td>{item.operator}</td><td><span className={`status ${item.status.toLowerCase()}`}>{item.status.toLowerCase()}</span></td><td><div className="action-group">{item.status === 'DEMANDE' && <button className="approve-button" disabled={busyId === item.id} onClick={() => void update(item, 'APPROUVE')}>Approuver</button>}{item.status === 'APPROUVE' && <button className="approve-button" disabled={busyId === item.id} onClick={() => { setDecisionValue(''); setDecision({ item, status: 'PAYE' }) }}>Marquer payé</button>}{item.status !== 'PAYE' && item.status !== 'REFUSE' && <button className="reject-button" disabled={busyId === item.id} onClick={() => { setDecisionValue(''); setDecision({ item, status: 'REFUSE' }) }}>Refuser</button>}</div></td></tr>)}</tbody></table></section>}
    {decision && <div className="modal-backdrop" onClick={() => setDecision(null)}><form className="modal" onSubmit={submitDecision} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setDecision(null)}>×</button><p className="eyebrow">TRAITEMENT DU RETRAIT</p><h2>{decision.status === 'PAYE' ? 'Confirmer le paiement' : 'Refuser la demande'}</h2><p className="modal-intro">{decision.item.agent.agentProfile ? `${decision.item.agent.agentProfile.firstName} ${decision.item.agent.agentProfile.lastName}` : 'Agent'} · {Number(decision.item.amount).toLocaleString('fr-FR')} Ar</p><label>{decision.status === 'PAYE' ? 'Référence de paiement' : 'Motif du refus'}<input required minLength={5} maxLength={decision.status === 'PAYE' ? 100 : 500} value={decisionValue} onChange={(event) => setDecisionValue(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="outline-button" onClick={() => setDecision(null)}>Annuler</button><button className="primary-button" disabled={busyId === decision.item.id}>{busyId === decision.item.id ? 'Enregistrement...' : 'Confirmer'}</button></div></form></div>}
  </>
}
