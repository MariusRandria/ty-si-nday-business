import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Check, Clock3, FileText, Image, X } from 'lucide-react'
import api, { type AdminSubscriptionRequest } from '../../api/client'
import { LoadingState } from '../../components/ui/LoadingState'
import { notify } from '../../utils/toast'
import { confirmAction } from '../../utils/confirmation'
import './AdminSubscriptionsPage.css'

function dateLabel(value: string) {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AdminSubscriptionsPage() {
  const [requests, setRequests] = useState<AdminSubscriptionRequest[]>([])
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [proof, setProof] = useState<{ url: string; mimeType: string; requestId: number } | null>(null)

  async function loadRequests() {
    setRequests(await api.adminSubscriptions())
  }

  useEffect(() => {
    let active = true
    api.adminSubscriptions()
      .then((data) => { if (active) setRequests(data) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger les demandes.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => () => { if (proof) URL.revokeObjectURL(proof.url) }, [proof])

  const orderedRequests = useMemo(() => [...requests].sort((a, b) => {
    if (a.status === 'PENDING' && b.status !== 'PENDING') return -1
    if (b.status === 'PENDING' && a.status !== 'PENDING') return 1
    return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
  }), [requests])

  async function openProof(request: AdminSubscriptionRequest) {
    try {
      const blob = await api.subscriptionProof(request.id)
      setProof({ url: URL.createObjectURL(blob), mimeType: request.proofMimeType, requestId: request.id })
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Impossible d’ouvrir le justificatif.', 'error')
    }
  }

  async function review(request: AdminSubscriptionRequest, decision: 'APPROVED' | 'REJECTED') {
    const reason = reasons[request.id]?.trim()
    if (decision === 'REJECTED' && !reason) {
      notify('Saisissez un motif avant de refuser cette demande.', 'error')
      return
    }
    if (decision === 'APPROVED') {
      const confirmed = await confirmAction({
        title: 'Valider le paiement et activer le badge ?',
        message: `Confirmez que le paiement de ${request.amount.toLocaleString('fr-FR')} Ar reçu avec la référence ${request.transactionRef} a bien été vérifié.`,
        confirmLabel: 'Valider et activer',
      })
      if (!confirmed) return
    }
    setBusyId(request.id)
    setError('')
    try {
      await api.reviewSubscription(request.id, decision, reason)
      await loadRequests()
      notify(decision === 'APPROVED' ? 'Paiement vérifié, badge activé et agent notifié.' : 'Demande refusée et agent notifié.', 'success')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Impossible de traiter la demande.'
      setError(message)
      notify(message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  return <div className="admin-subscriptions-page">
    <header className="page-heading admin-subscriptions-heading"><div><p className="eyebrow">ABONNEMENTS TY SY NDAY</p><h1>Demandes de badge</h1><p className="intro">Vérifiez les paiements Mobile Money et activez les badges après confirmation.</p></div><span className="admin-subscription-count"><Clock3 size={15} /> {requests.filter((request) => request.status === 'PENDING').length} en attente</span></header>
    {error && <div className="settings-error" role="alert">{error}</div>}
    {loading ? <LoadingState label="Chargement des demandes de badge…" /> : orderedRequests.length === 0
      ? <section className="panel badge-admin-empty"><BadgeCheck size={26} /><strong>Aucune demande pour le moment</strong><p>Les nouvelles demandes d’abonnement apparaîtront ici.</p></section>
      : <section className="admin-subscription-list">{orderedRequests.map((request) => {
        const name = request.user.agentProfile ? `${request.user.agentProfile.firstName} ${request.user.agentProfile.lastName}` : request.user.email
        const pending = request.status === 'PENDING'
        return <article className="panel admin-subscription-card" key={request.id}>
          <div className="admin-subscription-main">
            <div className="admin-subscription-person"><span className={`admin-subscription-icon ${pending ? 'pending' : ''}`}><BadgeCheck size={19} /></span><div><strong>{name}</strong><small>{request.user.email}{request.user.agentProfile?.phone ? ` · ${request.user.agentProfile.phone}` : ''}</small></div><span className={`admin-subscription-state ${request.status.toLowerCase()}`}>{pending ? 'À vérifier' : request.status === 'APPROVED' ? 'Validée' : 'Refusée'}</span></div>
            <div className="admin-subscription-details"><span><small>Montant · durée</small><strong>{request.amount.toLocaleString('fr-FR')} Ar · {request.durationDays} j</strong></span><span><small>Référence transaction</small><strong>{request.transactionRef}</strong></span><span><small>Reçue le</small><strong>{dateLabel(request.requestedAt)}</strong></span></div>
            {request.status === 'APPROVED' && request.expiresAt && <p className="admin-subscription-expiry">Badge actif du {dateLabel(request.startsAt ?? request.reviewedAt ?? request.requestedAt)} au {dateLabel(request.expiresAt)}.</p>}
            {request.status === 'REJECTED' && request.rejectionReason && <p className="admin-subscription-rejection">Motif : {request.rejectionReason}</p>}
          </div>
          <div className="admin-subscription-actions">
            <button type="button" className="outline-button admin-proof-button" onClick={() => void openProof(request)}><FileText size={15} /> Voir le justificatif</button>
            {pending && <>
              <button type="button" className="primary-button admin-approve-button" disabled={busyId !== null} onClick={() => void review(request, 'APPROVED')}><Check size={15} /> {busyId === request.id ? 'Traitement…' : 'Valider le paiement'}</button>
              <div className="admin-reject-row"><input aria-label={`Motif de refus pour ${name}`} value={reasons[request.id] ?? ''} maxLength={1000} placeholder="Motif de refus requis" onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))} /><button type="button" className="admin-reject-button" disabled={busyId !== null} onClick={() => void review(request, 'REJECTED')}><X size={15} /> Refuser</button></div>
            </>}
          </div>
        </article>
      })}</section>}
    {proof && <div className="admin-proof-backdrop" role="presentation" onClick={() => setProof(null)}>
      <section className="panel admin-proof-dialog" role="dialog" aria-modal="true" aria-label={`Justificatif de la demande ${proof.requestId}`} onClick={(event) => event.stopPropagation()}>
        <div className="admin-proof-heading"><strong><Image size={17} /> Justificatif #{proof.requestId}</strong><button type="button" aria-label="Fermer le justificatif" onClick={() => setProof(null)}><X size={19} /></button></div>
        {proof.mimeType === 'application/pdf' ? <iframe title={`Justificatif PDF ${proof.requestId}`} src={proof.url} /> : <img src={proof.url} alt={`Justificatif de paiement de la demande ${proof.requestId}`} />}
      </section>
    </div>}
  </div>
}
