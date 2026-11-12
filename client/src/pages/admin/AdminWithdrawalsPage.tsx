import { useEffect, useId, useState, type FormEvent } from 'react'
import { BadgeCheck, ReceiptText, ShieldCheck, X } from 'lucide-react'
import api, { type AdminWithdrawal } from '../../api/client'
import { notify } from '../../utils/toast'
import './AdminWithdrawalsPage.css'

type Decision = { item: AdminWithdrawal; status: 'PAYE' | 'REFUSE' }

export default function AdminWithdrawalsPage() {
  const decisionInputId = useId()
  const totpInputId = useId()
  const [items, setItems] = useState<AdminWithdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [decisionValue, setDecisionValue] = useState('')
  const [adminTotpCode, setAdminTotpCode] = useState('')

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

  async function update(item: AdminWithdrawal, status: string, paymentReference?: string, rejectReason?: string, totp?: string) {
    setBusyId(item.id)
    setError('')
    try {
      const result = await api.updateWithdrawal(item.id, status, paymentReference, rejectReason, totp)
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
    } finally {
      setBusyId(null)
      if (status === 'PAYE') setAdminTotpCode('')
    }
  }

  function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!decision) return
    if (decision.status === 'PAYE' && !/^\d{6}$/.test(adminTotpCode)) {
      setError('Saisissez un code OTP administrateur valide à 6 chiffres.')
      return
    }
    void update(
      decision.item,
      decision.status,
      decision.status === 'PAYE' ? decisionValue.trim() : undefined,
      decision.status === 'REFUSE' ? decisionValue.trim() : undefined,
      decision.status === 'PAYE' ? adminTotpCode : undefined,
    )
  }

  function openDecision(item: AdminWithdrawal, status: Decision['status']) {
    setError('')
    setDecisionValue('')
    setAdminTotpCode('')
    setDecision({ item, status })
  }

  function closeDecision() {
    setDecision(null)
    setDecisionValue('')
    setAdminTotpCode('')
  }

  const openWithdrawals = items.filter((item) => ['DEMANDE', 'APPROUVE'].includes(item.status))
  const amountToProcess = openWithdrawals.reduce((total, item) => total + Number(item.amount), 0)

  return <>
    <section className="page-heading"><div><p className="eyebrow">PAIEMENTS MANUELS</p><h1>Retraits</h1><p className="intro">Contrôlez les demandes et confirmez les paiements effectués.</p></div><button className="outline-button" onClick={() => { setLoading(true); void loadWithdrawals() }}>Actualiser</button></section>
    {error && !decision && <div className="settings-error" role="alert">{error}</div>}
    <section className="metric-grid"><div className="metric"><span className="metric-label">Montant à traiter</span><div className="metric-value"><strong>{amountToProcess.toLocaleString('fr-FR')}</strong><small>Ar</small></div></div><div className="metric"><span className="metric-label">Demandes ouvertes</span><div className="metric-value"><strong>{openWithdrawals.length}</strong></div></div></section>
    {loading ? <section className="panel empty-state">Chargement des demandes...</section> : items.length === 0 ? <section className="panel empty-state">Aucune demande de retrait pour le moment.</section> : <section className="panel admin-table-panel"><table><thead><tr><th>AGENT</th><th>MONTANT</th><th>OPÉRATEUR</th><th>STATUT</th><th>ACTION</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><div className="company"><span>{item.agent.agentProfile?.firstName.slice(0, 1) ?? 'A'}</span><strong>{item.agent.agentProfile ? `${item.agent.agentProfile.firstName} ${item.agent.agentProfile.lastName}` : 'Agent'}</strong></div><small className="table-subtext">{item.phoneNumber}</small></td><td><strong>{Number(item.amount).toLocaleString('fr-FR')} Ar</strong></td><td>{item.operator}</td><td><span className={`status ${item.status.toLowerCase()}`}>{item.status.toLowerCase()}</span></td><td><div className="action-group">{item.status === 'DEMANDE' && <button className="approve-button" disabled={busyId === item.id} onClick={() => void update(item, 'APPROUVE')}>Approuver</button>}{item.status === 'APPROUVE' && <button className="approve-button" disabled={busyId === item.id} onClick={() => openDecision(item, 'PAYE')}>Marquer payé</button>}{item.status !== 'PAYE' && item.status !== 'REFUSE' && <button className="reject-button" disabled={busyId === item.id} onClick={() => openDecision(item, 'REFUSE')}>Refuser</button>}</div></td></tr>)}</tbody></table></section>}
    {decision && <div className="modal-backdrop admin-withdrawal-backdrop" role="presentation" onClick={closeDecision}>
      <form
        className={`modal admin-withdrawal-modal ${decision.status === 'PAYE' ? 'is-payment' : 'is-rejection'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="withdrawal-decision-title"
        onSubmit={submitDecision}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="modal-close" aria-label="Fermer la fenêtre" onClick={closeDecision}><X size={19} /></button>
        <div className="admin-withdrawal-modal-heading">
          <span className="admin-withdrawal-modal-icon"><BadgeCheck size={23} aria-hidden="true" /></span>
          <div>
            <p className="eyebrow">TRAITEMENT DU RETRAIT</p>
            <h2 id="withdrawal-decision-title">{decision.status === 'PAYE' ? 'Confirmer le paiement' : 'Refuser la demande'}</h2>
          </div>
        </div>
        <p className="admin-withdrawal-modal-description">
          {decision.status === 'PAYE'
            ? 'Vérifiez le bénéficiaire et le montant, puis saisissez la référence du transfert effectué.'
            : 'Indiquez clairement le motif du refus pour informer l’agent.'}
        </p>
        <div className="withdrawal-payment-summary">
          <div className="withdrawal-payment-recipient">
            <span className="withdrawal-payment-avatar">{decision.item.agent.agentProfile?.firstName.slice(0, 1) ?? 'A'}</span>
            <span className="withdrawal-payment-agent">
              <small>Bénéficiaire</small>
              <strong>{decision.item.agent.agentProfile ? `${decision.item.agent.agentProfile.firstName} ${decision.item.agent.agentProfile.lastName}` : 'Agent'}</strong>
              <small>{decision.item.operator} · {decision.item.phoneNumber}</small>
            </span>
          </div>
          <div className="withdrawal-payment-amount">
            <small>Montant du retrait</small>
            <strong>{Number(decision.item.amount).toLocaleString('fr-FR')} <span>Ar</span></strong>
          </div>
        </div>
        <label className="admin-withdrawal-field" htmlFor={decisionInputId}>
          <span>{decision.status === 'PAYE' ? 'Référence de paiement' : 'Motif du refus'} <em>Obligatoire</em></span>
          <span className="admin-withdrawal-input-wrap">
            {decision.status === 'PAYE' && <ReceiptText size={18} aria-hidden="true" />}
            <input
              id={decisionInputId}
              type="text"
              required
              minLength={5}
              maxLength={decision.status === 'PAYE' ? 100 : 500}
              autoFocus
              placeholder={decision.status === 'PAYE' ? 'Référence de transaction' : 'Saisissez le motif du refus'}
              value={decisionValue}
              onChange={(event) => setDecisionValue(event.target.value)}
            />
          </span>
        </label>
        <p className="admin-withdrawal-field-hint">
          {decision.status === 'PAYE'
            ? 'Cette référence sera conservée dans l’historique du retrait.'
            : 'Le motif sera transmis à l’agent avec la décision.'}
        </p>
        {decision.status === 'PAYE' && <section className="admin-withdrawal-security" aria-label="Vérification de sécurité">
          <div className="admin-withdrawal-security-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <strong>Vérification de sécurité</strong>
              <small>Requise pour confirmer le versement</small>
            </div>
          </div>
          <label className="admin-withdrawal-field admin-withdrawal-otp-field" htmlFor={totpInputId}>
            <span>Code OTP administrateur <em>6 chiffres</em></span>
            <span className="admin-withdrawal-otp-control">
              <span className="admin-withdrawal-otp-display" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <span
                    className={`admin-withdrawal-otp-cell ${index === adminTotpCode.length && index < 6 ? 'is-current' : ''}`}
                    key={index}
                  >
                    {adminTotpCode[index] ?? ''}
                  </span>
                ))}
              </span>
              <input
                id={totpInputId}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                aria-describedby={`${totpInputId}-hint`}
                value={adminTotpCode}
                onChange={(event) => setAdminTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </span>
          </label>
          <p className="admin-withdrawal-field-hint" id={`${totpInputId}-hint`}>Saisissez un nouveau code à 6 chiffres de votre application d’authentification.</p>
        </section>}
        {error && <p className="form-error admin-withdrawal-error" role="alert">{error}</p>}
        <div className="modal-actions admin-withdrawal-actions">
          <button type="button" className="outline-button" onClick={closeDecision}>Annuler</button>
          <button className="primary-button admin-withdrawal-submit" disabled={busyId === decision.item.id}>
            {busyId === decision.item.id ? 'Enregistrement...' : decision.status === 'PAYE' ? 'Confirmer le paiement' : 'Confirmer le refus'}
          </button>
        </div>
      </form>
    </div>}
  </>
}
