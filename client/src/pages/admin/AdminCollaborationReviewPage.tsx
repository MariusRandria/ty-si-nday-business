import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDot, Clock3, Download, FileText, LoaderCircle, RefreshCw, ShieldCheck, XCircle, Users, ScrollText } from 'lucide-react'
import api, {
  ApiRequestError,
  type AdminAuditFilters,
  type AdminAuditVerification,
  type AdminCollaborationAuditEntry,
  type AdminCollaborationAlert,
  type AdminCollaborationCommission,
  type AdminCollaborationDashboard,
  type AdminCollaborationDealDetail,
  type AdminCollaborationAssignmentOption,
  type AdminCollaborationQueueFilters,
  type AdminCollaborationSignatureResult,
  type AdminCollaborationDealSummary,
  type AdminCollaborationOverrideSummary,
  type AdminCollaborationReadyDeal,
  type AdminCollaborationTrustAgent,
  type SessionUser,
} from '../../api/client'
import { AdminTotpCodeField } from '../../components/admin/AdminTotpCodeField'
import { confirmAction } from '../../utils/confirmation'
import { sortAdminCollaborationDeals } from '../../utils/admin-collaboration-queue'
import { antananarivoDateToIso, antananarivoDayBoundaryToIso, auditChainTone, canResolveAdminDispute, isAllowedCollaborationUpload } from '../../utils/admin-collaboration-workflows'
import './AdminCollaborationReviewPage.css'

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Indian/Antananarivo',
})

const STATUS_LABELS: Record<string, string> = {
  CLOSING_REPORTED: 'Rapport soumis',
  CONFIRMED_BY_CLIENT: 'Confirmation client reçue',
  CLIENT_CONFIRMED: 'Confirmation client reçue',
  NO_RESPONSE: 'Sans réponse client',
  DISPUTED: 'Litige',
  CONFIRMED: 'Vente confirmée',
  REJECTED: 'Rejetée',
}
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Non renseignée'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date invalide' : DATE_FORMATTER.format(date)
}

function validContractAmount(value: string): boolean {
  return /^\d{1,19}$/.test(value) && BigInt(value) > 0n && BigInt(value) <= MAX_SIGNED_BIGINT
}

function formatAriaryAmount(value: string): string {
  return `${BigInt(value).toLocaleString('fr-FR')} Ar`
}

function agentName(agent: { email: string; profile: { firstName: string; lastName: string } | null } | null): string {
  if (!agent) return 'Non attribué'
  return [agent.profile?.firstName, agent.profile?.lastName].filter(Boolean).join(' ') || agent.email
}

function scoreLabel(score: AdminCollaborationDealDetail['supplier']['score']): string {
  return score.score === null ? 'Pas encore calculé' : `${score.score} % · ${score.confirmed} ventes positives`
}

function confirmationLabel(detail: AdminCollaborationDealDetail): string {
  if (detail.clientConfirmation?.status === 'CONFIRMED_BY_CLIENT' || detail.clientConfirmation?.status === 'CONFIRMED') {
    return 'Client confirmé'
  }
  if (detail.clientConfirmation?.status === 'DENIED') return 'Client dément la vente'
  if (detail.clientConfirmation?.status === 'NO_RESPONSE') return 'Aucune réponse du client'
  if (detail.clientConfirmation?.status === 'PENDING') return 'Confirmation en attente'
  return 'Aucune confirmation enregistrée'
}

function DealStatus({ status }: { status: string }) {
  const Icon = status === 'DISPUTED'
    ? AlertTriangle
    : status === 'CONFIRMED' || status === 'CONTRACT_SIGNED' || status === 'COMMISSIONS_PAID' || status === 'CONFIRMED_BY_CLIENT' || status === 'CLIENT_CONFIRMED'
      ? CheckCircle2
      : status === 'REJECTED' || status === 'EXPIRED'
        ? XCircle
        : status === 'CLOSING_REPORTED' || status === 'NO_RESPONSE'
          ? Clock3
          : CircleDot
  return <span className={`admin-collab-status status-${status.toLowerCase()}`}><Icon size={15} aria-hidden="true" />{STATUS_LABELS[status] ?? status}</span>
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof TypeError) return 'Erreur réseau. Vérifiez la connexion puis rechargez l’état avant de réessayer.'
  return error instanceof Error ? error.message : 'Une erreur est survenue. Réessayez.'
}

type QueueKind = 'review' | 'ready' | 'disputes' | 'overrides' | 'commissions' | 'bypass' | 'extraction' | 'expirations' | 'audit' | 'agents'
type QueueRow =
  | { kind: 'deal'; value: AdminCollaborationDealSummary | AdminCollaborationReadyDeal | AdminCollaborationOverrideSummary }
  | { kind: 'alert'; value: AdminCollaborationAlert }
  | { kind: 'commission'; value: AdminCollaborationCommission }

const QUEUE_LABELS: Record<QueueKind, string> = {
  review: 'Vérification des ventes',
  ready: 'Signature des contrats',
  disputes: 'Litiges à arbitrer',
  overrides: 'Dérogations',
  commissions: 'Commissions créditées aux agents',
  bypass: 'Alertes de contournement',
  extraction: 'Alertes d’extraction',
  expirations: 'Expirations répétées',
  audit: 'Journal d’audit',
  agents: 'Confiance des agents',
}

const QUEUE_GUIDANCE: Record<QueueKind, string> = {
  review: 'Vérifiez les informations et les pièces du rapport, puis confirmez la vente ou rejetez-la avec un motif.',
  ready: 'Consultez les prérequis, puis enregistrez la référence, la date et le contrat signé.',
  disputes: 'Examinez le désaccord client et décidez du traitement des commissions associées.',
  overrides: 'Consultez les décisions prises avec dérogation à la confirmation client.',
  commissions: 'Suivez les montants crédités aux agents après validation de la vente.',
  bypass: 'Examinez les tentatives de contournement du processus de collaboration.',
  extraction: 'Examinez les alertes d’extraction et les dossiers concernés.',
  expirations: 'Repérez les expirations répétées qui peuvent nécessiter un suivi.',
  audit: 'Consultez les événements enregistrés et vérifiez la chaîne d’audit.',
  agents: 'Consultez les scores de confiance, les alertes et les statuts des agents.',
}

type QueueFilterState = {
  from: string
  to: string
  assignment: 'ALL' | 'ASSIGNED' | 'UNASSIGNED'
  reviewStage: 'ALL' | 'WAITING_CLIENT' | 'CLIENT_CONFIRMED' | 'NO_RESPONSE' | 'DISPUTED'
  sla: 'ALL' | 'OVERDUE'
}

const EMPTY_QUEUE_FILTERS: QueueFilterState = {
  from: '',
  to: '',
  assignment: 'ALL',
  reviewStage: 'ALL',
  sla: 'ALL',
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours === 0) return `${remainingMinutes} min`
  return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`
}

function slaLabel(startAt: string | null | undefined, targetHours: number | undefined): { text: string; overdue: boolean } | null {
  if (!startAt || !targetHours) return null
  const deadline = new Date(startAt).getTime() + targetHours * 60 * 60_000
  if (!Number.isFinite(deadline)) return null
  const minutes = Math.ceil(Math.abs(deadline - Date.now()) / 60_000)
  return deadline < Date.now()
    ? { text: `Hors délai de ${formatDuration(minutes)}`, overdue: true }
    : { text: `Échéance dans ${formatDuration(minutes)}`, overdue: false }
}

const DASHBOARD_CARDS: Array<{ key: Exclude<keyof AdminCollaborationDashboard, 'sla'>; label: string; queue: QueueKind; icon: typeof ShieldCheck }> = [
  { key: 'salesToVerify', label: '1 · Vérifier les ventes', queue: 'review', icon: FileText },
  { key: 'contractsToSign', label: '2 · Signer les contrats', queue: 'ready', icon: CheckCircle2 },
  { key: 'commissionsToPay', label: 'Commissions créditées', queue: 'commissions', icon: CircleDot },
  { key: 'disputes', label: 'Litiges', queue: 'disputes', icon: AlertTriangle },
  { key: 'bypassAlerts', label: 'Contournements', queue: 'bypass', icon: AlertTriangle },
  { key: 'extractionAlerts', label: 'Alertes d’extraction', queue: 'extraction', icon: AlertTriangle },
  { key: 'repeatedExpirations', label: 'Expirations répétées', queue: 'expirations', icon: Clock3 },
  { key: 'overrides', label: 'Dérogations', queue: 'overrides', icon: ShieldCheck },
]

function isDealRow(row: QueueRow): row is Extract<QueueRow, { kind: 'deal' }> {
  return row.kind === 'deal'
}

export default function AdminCollaborationReviewPage({ userRole }: { userRole: SessionUser['role'] }) {
  const isSalesReviewer = userRole === 'SALES_REVIEWER'
  const isSalesSigner = userRole === 'SALES_SIGNER'
  const isScopedSalesRole = isSalesReviewer || isSalesSigner
  const dashboardCards = isSalesReviewer
    ? DASHBOARD_CARDS.filter(({ key }) => key === 'salesToVerify')
    : isSalesSigner
      ? DASHBOARD_CARDS.filter(({ key }) => key === 'contractsToSign')
      : DASHBOARD_CARDS
  const [dashboard, setDashboard] = useState<AdminCollaborationDashboard | null>(null)
  const [chainStatus, setChainStatus] = useState<AdminAuditVerification | null>(null)
  const [queue, setQueue] = useState<QueueKind | null>(null)
  const [queueFilters, setQueueFilters] = useState<QueueFilterState>(EMPTY_QUEUE_FILTERS)
  const [appliedQueueFilters, setAppliedQueueFilters] = useState<QueueFilterState | null>(null)
  const [, setSlaClock] = useState(0)
  const [rows, setRows] = useState<QueueRow[]>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [queueLoading, setQueueLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [dealId, setDealId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AdminCollaborationDealDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [totp, setTotp] = useState('')
  const [reason, setReason] = useState('')
  const [overrideConfirmation, setOverrideConfirmation] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<{ decision: 'CONFIRM' | 'REJECT'; reason?: string; overrideConfirmation?: boolean } | null>(null)
  const [summaryDisplayed, setSummaryDisplayed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestLock = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => setSlaClock(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  async function loadDashboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requestLock.current) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez le code administrateur à 6 chiffres.')
      return
    }
    requestLock.current = true
    setTotp('')
    setQueueLoading(true)
    setError('')
    try {
      setDashboard(await api.adminCollaborationDashboard(code))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      requestLock.current = false
      setQueueLoading(false)
    }
  }

  async function loadQueue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!queue || requestLock.current) return
    if (queueFilters.from && queueFilters.to && queueFilters.from > queueFilters.to) {
      setError('La date « Du » doit précéder ou être égale à la date « Au ».')
      return
    }
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez le code administrateur à 6 chiffres.')
      return
    }
    requestLock.current = true
    setTotp('')
    setQueueLoading(true)
    setError('')
    try {
      const dateFilters: Pick<AdminCollaborationQueueFilters, 'from' | 'to'> = {
        ...(queueFilters.from ? { from: antananarivoDayBoundaryToIso(queueFilters.from, false) } : {}),
        ...(queueFilters.to ? { to: antananarivoDayBoundaryToIso(queueFilters.to, true) } : {}),
      }
      const assignmentFilter = !isScopedSalesRole && queueFilters.assignment !== 'ALL'
        ? { assignment: queueFilters.assignment }
        : {}
      const queryFilters: AdminCollaborationQueueFilters = {
        ...dateFilters,
        ...assignmentFilter,
        ...(queue === 'review' && !isSalesReviewer && queueFilters.reviewStage !== 'ALL'
          ? { reviewStage: queueFilters.reviewStage }
          : {}),
        ...((queue === 'review' || queue === 'ready') && queueFilters.sla === 'OVERDUE'
          ? { sla: 'OVERDUE' }
          : {}),
      }
      if (queue === 'ready') {
        const result = await api.adminCollaborationReadyToSign(code, page, 50, queryFilters)
        setRows(result.data.map((value) => ({ kind: 'deal', value })))
        setTotal(result.pagination.total)
      } else if (queue === 'commissions') {
        const result = await api.adminCollaborationPendingCommissions(code, page, 50, dateFilters)
        setRows(result.data.map((value) => ({ kind: 'commission', value })))
        setTotal(result.pagination.total)
      } else if (queue === 'bypass' || queue === 'extraction' || queue === 'expirations') {
        const type: AdminCollaborationAlert['type'] = queue === 'bypass'
          ? 'BYPASS'
          : queue === 'extraction'
            ? 'EXTRACTION'
            : 'REPEATED_EXPIRATIONS'
        const result = await api.adminCollaborationAlerts(code, type, page, 50, dateFilters)
        setRows(result.data.map((value) => ({ kind: 'alert', value })))
        setTotal(result.pagination.total)
      } else if (queue === 'overrides') {
        const result = await api.adminCollaborationOverrides(code, page, 50, dateFilters)
        setRows(result.data.map((value) => ({ kind: 'deal', value })))
        setTotal(result.pagination.total)
      } else if (queue === 'disputes' || queue === 'review') {
        const result = await api.adminCollaborationDeals(code, page, 50, queue === 'disputes' ? 'DISPUTED' : undefined, queryFilters)
        const sorted = sortAdminCollaborationDeals(result.data)
        setRows(sorted.map((value) => ({ kind: 'deal', value })))
        setTotal(result.pagination.total)
      } else {
        return
      }
      setAppliedQueueFilters({ ...queueFilters })
      setHasLoaded(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      requestLock.current = false
      setQueueLoading(false)
    }
  }

  async function loadDetail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (dealId === null || requestLock.current) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez le code administrateur à 6 chiffres.')
      return
    }
    requestLock.current = true
    setTotp('')
    setDetailLoading(true)
    setError('')
    try {
      setDetail(await api.adminCollaborationDeal(dealId, code))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      requestLock.current = false
      setDetailLoading(false)
    }
  }

  function openDeal(id: number) {
    setDealId(id)
    setDetail(null)
    setTotp('')
    setError('')
    setReason('')
    setOverrideConfirmation(false)
    setPendingDecision(null)
    setSummaryDisplayed(false)
  }

  function closeDeal() {
    setDealId(null)
    setDetail(null)
    setTotp('')
    setReason('')
    setOverrideConfirmation(false)
    setPendingDecision(null)
    setSummaryDisplayed(false)
    setError('')
  }

  function openQueue(nextQueue: QueueKind) {
    setQueue(nextQueue)
    setQueueFilters(EMPTY_QUEUE_FILTERS)
    setAppliedQueueFilters(null)
    setPage(1)
    setRows([])
    setHasLoaded(false)
    setTotp('')
    setError('')
  }

  function updateQueueFilters(update: (current: QueueFilterState) => QueueFilterState) {
    setQueueFilters(update)
    setPage(1)
    setError('')
  }

  async function prepareDecision(decision: 'CONFIRM' | 'REJECT') {
    if (!detail || requestLock.current) return
    const cleanReason = reason.trim()
    if (decision === 'REJECT' && cleanReason.length < 10) {
      setError('Un motif de rejet d’au moins 10 caractères est obligatoire.')
      return
    }
    if (decision === 'CONFIRM' && overrideConfirmation && cleanReason.length < 10) {
      setError('Un motif d’au moins 10 caractères est obligatoire pour la dérogation.')
      return
    }

    const confirmed = await confirmAction({
      title: decision === 'CONFIRM' ? 'Récapitulatif de confirmation' : 'Récapitulatif de rejet',
      message: [
        `Dossier #${detail.id} · ${agentName(detail.supplier)} → ${agentName(detail.closer)}.`,
        decision === 'CONFIRM' ? 'La vente sera confirmée et cette décision ne pourra pas être annulée ici.' : `Motif : ${cleanReason}`,
        overrideConfirmation ? `Dérogation à la confirmation client : ${cleanReason}` : '',
      ].filter(Boolean).join('\n'),
      confirmLabel: 'Afficher ce récapitulatif',
      destructive: decision === 'REJECT',
    })
    if (!confirmed) return
    setSummaryDisplayed(true)
    setPendingDecision({
      decision,
      ...(cleanReason ? { reason: cleanReason } : {}),
      ...(decision === 'CONFIRM' && overrideConfirmation ? { overrideConfirmation: true } : {}),
    })
    setTotp('')
    setError('')
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail || !pendingDecision || requestLock.current) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez le code administrateur à 6 chiffres.')
      return
    }
    requestLock.current = true
    setTotp('')
    setBusy(true)
    setError('')
    try {
      await api.decideAdminCollaborationDeal(detail.id, code, pendingDecision)
      setRows((current) => current.filter((row) => !(row.kind === 'deal' && row.value.id === detail.id)))
      setTotal((current) => Math.max(0, current - 1))
      setDashboard(null)
      closeDeal()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      requestLock.current = false
      setBusy(false)
    }
  }

  const selectedSummary = rows.find((row) => row.kind === 'deal' && row.value.id === dealId)
  const maxPage = Math.max(1, Math.ceil(total / 50))
  const renderDashboardCards = (data: AdminCollaborationDashboard, cards: typeof DASHBOARD_CARDS) => (
    <div className="admin-collab-dashboard">
      {cards.map(({ key, label, queue: targetQueue, icon: Icon }) => {
        const sla = key === 'salesToVerify'
          ? data.sla.review
          : key === 'contractsToSign'
            ? data.sla.signature
            : null
        return (
          <button className="admin-collab-dashboard-card" type="button" key={key} onClick={() => openQueue(targetQueue)}>
            <span><Icon size={20} aria-hidden="true" />{label}</span>
            <strong>{data[key]}</strong>
            {sla && <small className={`admin-collab-dashboard-sla${sla.overdue > 0 ? ' is-overdue' : ''}`}>
              {sla.overdue} hors délai · objectif {sla.targetHours} h{!isScopedSalesRole ? ` · ${sla.unassigned} sans affectation` : ''}
            </small>}
            <small>Consulter les dossiers →</small>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="admin-collaboration">
      {dealId !== null ? (
        <>
          <button type="button" className="admin-collab-back" onClick={closeDeal}><ArrowLeft size={18} /> Retour à la file</button>
          {error && !detail && <p className="admin-collab-error" role="alert">{error}</p>}
          {!detail ? (
            <section className="admin-collab-panel">
              <div className="admin-collab-panel-heading">
                <div><ShieldCheck size={20} /><h2>Ouvrir le dossier #{dealId}</h2></div>
                {selectedSummary && isDealRow(selectedSummary) && <DealStatus status={selectedSummary.value.status} />}
              </div>
              <form className="admin-collab-totp-form" onSubmit={(event) => void loadDetail(event)}>
                <p>Un nouveau code administrateur est requis pour accéder au détail.</p>
                <div className="admin-collab-inline-form">
                  <AdminTotpCodeField id="admin-collab-detail-totp" label="Code administrateur" value={totp} onChange={setTotp} />
                  <button className="primary-button" type="submit" disabled={detailLoading}>{detailLoading ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}Afficher le dossier</button>
                </div>
              </form>
            </section>
          ) : (
            <DealReview
              key={detail.id}
              detail={detail}
              reason={reason}
              onReasonChange={setReason}
              overrideConfirmation={overrideConfirmation}
              onOverrideChange={setOverrideConfirmation}
              pendingDecision={pendingDecision}
              summaryDisplayed={summaryDisplayed}
              totp={totp}
              onTotpChange={(value) => setTotp(value.replace(/\D/g, '').slice(0, 6))}
              busy={busy}
              error={error}
              onPrepareDecision={(decision) => void prepareDecision(decision)}
              onSubmitDecision={(event) => void submitDecision(event)}
              onCancelDecision={() => { setPendingDecision(null); setSummaryDisplayed(false); setTotp(''); setError('') }}
              canReview={userRole !== 'SALES_SIGNER'}
              canOverrideConfirmation={userRole === 'ADMIN' || userRole === 'SUPER_ADMIN'}
              canRestoreHiddenAgent={userRole === 'ADMIN' || userRole === 'SUPER_ADMIN'}
              canManageAssignments={userRole === 'ADMIN' || userRole === 'SUPER_ADMIN'}
              onAssignmentChange={(assignment) => setDetail((current) => {
                if (!current) return current
                const reviewer = current.assignmentTeam?.reviewers.find(({ id }) => id === assignment.reviewAssignedToId) ?? null
                const signer = current.assignmentTeam?.signers.find(({ id }) => id === assignment.signAssignedToId) ?? null
                return {
                  ...current,
                  reviewAssignedToId: assignment.reviewAssignedToId,
                  signAssignedToId: assignment.signAssignedToId,
                  reviewAssignedTo: reviewer,
                  signAssignedTo: signer,
                }
              })}
              onRestoreHiddenAgent={(agentId) => setDetail((current) => current
                ? { ...current, hiddenAgents: current.hiddenAgents.filter((agent) => agent.id !== agentId) }
                : current)}
            />
          )}
        </>
      ) : queue ? (
        <>
          <button type="button" className="admin-collab-back" onClick={() => { setQueue(null); setRows([]); setHasLoaded(false); setTotp(''); setError('') }}><ArrowLeft size={18} /> Tableau de bord</button>
          <header className="page-heading">
            <div>
              <p className="eyebrow">{isScopedSalesRole ? 'ÉQUIPE VENTES · TRAITEMENT' : 'COLLABORATION · ADMINISTRATION'}</p>
              <h1>{QUEUE_LABELS[queue]}</h1>
              <p className="intro">{QUEUE_GUIDANCE[queue]}</p>
              {hasLoaded && <p className="intro">{total} élément{total === 1 ? '' : 's'} · Page {page} sur {maxPage}</p>}
            </div>
          </header>
          {queue === 'audit' ? (
            <AuditPanel />
          ) : queue === 'agents' ? (
            <AgentTrustPanel />
          ) : (
          <>
          <section className="admin-collab-panel">
            <div className="admin-collab-panel-heading">
              <div><RefreshCw size={19} /><h2>Filtres de la file</h2></div>
              <span>{hasLoaded ? `${total} résultat${total === 1 ? '' : 's'} · Page ${page}/${maxPage}` : 'Affinez avant de charger'}</span>
            </div>
            <form className="admin-collab-queue-filters" onSubmit={(event) => void loadQueue(event)}>
              <label>Du
                <input type="date" value={queueFilters.from} onChange={(event) => updateQueueFilters((current) => ({ ...current, from: event.target.value }))} />
              </label>
              <label>Au
                <input type="date" value={queueFilters.to} onChange={(event) => updateQueueFilters((current) => ({ ...current, to: event.target.value }))} />
              </label>
              {queue === 'review' && !isSalesReviewer && (
                <label>Étape
                  <select value={queueFilters.reviewStage} onChange={(event) => updateQueueFilters((current) => ({ ...current, reviewStage: event.target.value as QueueFilterState['reviewStage'] }))}>
                    <option value="ALL">Toutes les étapes</option>
                    <option value="WAITING_CLIENT">Confirmation client attendue</option>
                    <option value="CLIENT_CONFIRMED">Client confirmé · à vérifier</option>
                    <option value="NO_RESPONSE">Sans réponse client</option>
                    <option value="DISPUTED">Litiges</option>
                  </select>
                </label>
              )}
              {(queue === 'review' || queue === 'ready') && !isScopedSalesRole && (
                <label>Affectation
                  <select value={queueFilters.assignment} onChange={(event) => updateQueueFilters((current) => ({ ...current, assignment: event.target.value as QueueFilterState['assignment'] }))}>
                    <option value="ALL">Toutes</option>
                    <option value="ASSIGNED">Attribués</option>
                    <option value="UNASSIGNED">À attribuer</option>
                  </select>
                </label>
              )}
              {(queue === 'review' || queue === 'ready') && (
                <label>Priorité SLA
                  <select value={queueFilters.sla} onChange={(event) => updateQueueFilters((current) => ({ ...current, sla: event.target.value as QueueFilterState['sla'] }))}>
                    <option value="ALL">Tous les délais</option>
                    <option value="OVERDUE">Hors délai uniquement</option>
                  </select>
                </label>
              )}
              {isScopedSalesRole && (queue === 'review' || queue === 'ready') && (
                <p className="admin-collab-filter-scope">Cette file ne contient que les dossiers qui vous sont attribués.</p>
              )}
              <AdminTotpCodeField className="admin-collab-filter-totp" label="Code administrateur" value={totp} onChange={setTotp} />
              <button className="primary-button" type="submit" disabled={queueLoading}>
                {queueLoading ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}
                {hasLoaded ? 'Appliquer et actualiser' : 'Afficher les dossiers'}
              </button>
              <button className="outline-button" type="button" onClick={() => updateQueueFilters(() => EMPTY_QUEUE_FILTERS)} disabled={queueLoading}>
                Effacer les filtres
              </button>
            </form>
            {appliedQueueFilters && JSON.stringify(queueFilters) !== JSON.stringify(appliedQueueFilters) && (
              <p className="admin-collab-filter-pending">Les filtres ont changé. Appliquez-les avec un nouveau code TOTP pour actualiser les résultats.</p>
            )}
          </section>
          {hasLoaded && (rows.length === 0 ? (
            <section className="admin-collab-panel admin-collab-empty admin-collab-empty-panel">
              <CheckCircle2 size={26} />
              <div><strong>Aucun dossier ne correspond aux filtres.</strong><p>Modifiez la période ou les critères, ou revenez plus tard.</p></div>
            </section>
          ) : (
            <section className="admin-collab-panel">
              <div className="admin-collab-deal-list">
                {rows.map((row) => row.kind === 'deal'
                  ? queue === 'ready' && 'prerequisites' in row.value
                    ? <SignatureQueueCard key={`deal-${row.value.id}`} deal={row.value} slaTargetHours={dashboard?.sla.signature.targetHours} onOpen={() => openDeal(row.value.id)} onSuccess={() => setDashboard(null)} onReload={() => { setHasLoaded(false); setRows([]); setTotp(''); setError('') }} />
                    : <DealQueueCard key={`deal-${row.value.id}`} deal={row.value} queue={queue} reviewSlaTargetHours={dashboard?.sla.review.targetHours} onOpen={openDeal} />
                  : row.kind === 'alert'
                    ? <AlertQueueCard key={row.value.id} alert={row.value} onOpen={openDeal} />
                    : <CommissionWalletCard key={`commission-${row.value.id}`} commission={row.value} />)}
              </div>
            </section>
          ))}
          {queue === 'commissions' && hasLoaded && <CommissionCsvExport onError={setError} />}
          {error && <p className="admin-collab-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Fermer le message">×</button></p>}
          {hasLoaded && (
            <>
              <div className="admin-collab-pagination">
                <button type="button" className="outline-button" disabled={page <= 1 || queueLoading} onClick={() => { setPage((value) => value - 1); setHasLoaded(false); setRows([]); setTotp(''); setError('') }}>Précédent</button>
                <span>Page {page} / {maxPage}</span>
                <button type="button" className="outline-button" disabled={page >= maxPage || queueLoading} onClick={() => { setPage((value) => value + 1); setHasLoaded(false); setRows([]); setTotp(''); setError('') }}>Suivant</button>
              </div>
              <button className="admin-collab-refresh" type="button" onClick={() => { setHasLoaded(false); setRows([]); setTotp(''); setError('') }}>
                <RefreshCw size={17} /> Recharger avec un nouveau code
              </button>
            </>
          )}
          {queue === 'disputes' && hasLoaded && (
            <DisputeCommissionsPanel
              deals={rows.flatMap((row) => row.kind === 'deal' && row.value.status === 'DISPUTED' ? [row.value as AdminCollaborationDealSummary] : [])}
              onSuccess={() => { setHasLoaded(false); setRows([]); setTotp(''); setError(''); setDashboard(null) }}
            />
          )}
          </>
          )}
        </>
      ) : (
        <>
          <header className="page-heading">
            <div>
              <p className="eyebrow">{isScopedSalesRole ? 'ÉQUIPE VENTES · TRAITEMENT' : 'COLLABORATION · ADMINISTRATION'}</p>
              <h1>Suivi des ventes collaboratives</h1>
              <p className="intro">Parcourez chaque étape, repérez les retards et ouvrez directement les dossiers à traiter. Les équipes voient uniquement les dossiers qui leur sont attribués.</p>
            </div>
          </header>
          {!dashboard ? (
            <section className="admin-collab-panel">
              <form className="admin-collab-totp-form" onSubmit={(event) => void loadDashboard(event)}>
                <p>Un code à usage unique est requis pour charger les compteurs. Il ne sera utilisé que pour cette requête.</p>
                <div className="admin-collab-inline-form">
                  <AdminTotpCodeField id="admin-collab-dashboard-totp" label="Code administrateur" value={totp} onChange={setTotp} />
                  <button className="primary-button" type="submit" disabled={queueLoading}>{queueLoading ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}Afficher les compteurs</button>
                </div>
              </form>
            </section>
          ) : (
            <div className="admin-collab-dashboard-groups">
              {dashboardCards.some(({ queue: targetQueue }) => targetQueue === 'review' || targetQueue === 'ready') && (
                <section className="admin-collab-dashboard-group">
                  <header><h2>Traitement de la vente</h2><p>Suivez le dossier de la vérification jusqu’à la signature.</p></header>
                  {renderDashboardCards(dashboard, dashboardCards.filter(({ queue: targetQueue }) => targetQueue === 'review' || targetQueue === 'ready'))}
                </section>
              )}
              {dashboardCards.some(({ queue: targetQueue }) => targetQueue === 'commissions') && (
                <section className="admin-collab-dashboard-group">
                  <header><h2>Après signature</h2><p>Consultez les commissions créditées aux agents.</p></header>
                  {renderDashboardCards(dashboard, dashboardCards.filter(({ queue: targetQueue }) => targetQueue === 'commissions'))}
                </section>
              )}
              {dashboardCards.some(({ queue: targetQueue }) => !['review', 'ready', 'commissions'].includes(targetQueue)) && (
                <section className="admin-collab-dashboard-group">
                  <header><h2>Exceptions et contrôles</h2><p>Traitez les litiges, dérogations et alertes nécessitant une vérification.</p></header>
                  {renderDashboardCards(dashboard, dashboardCards.filter(({ queue: targetQueue }) => !['review', 'ready', 'commissions'].includes(targetQueue)))}
                </section>
              )}
              {!isScopedSalesRole && <section className="admin-collab-dashboard-group">
                <header><h2>Outils de suivi</h2><p>Consultez les décisions, l’activité et les alertes générales.</p></header>
                <div className="admin-collab-dashboard">
                  <button className="admin-collab-dashboard-card" type="button" onClick={() => openQueue('audit')}>
                    <span><ScrollText size={20} aria-hidden="true" />Journal d’audit</span>
                    <small>Consulter et exporter</small>
                  </button>
                  <button className="admin-collab-dashboard-card" type="button" onClick={() => openQueue('agents')}>
                    <span><Users size={20} aria-hidden="true" />Agents</span>
                    <small>Scores, alertes et statuts</small>
                  </button>
                </div>
              </section>}
            </div>
          )}
          {dashboard && !isScopedSalesRole && <AuditChainStatusCard status={chainStatus} onChange={setChainStatus} />}
        </>
      )}
      {error && dealId === null && !queue && <p className="admin-collab-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Fermer le message">×</button></p>}
      {dashboard && dealId === null && !queue && <button className="admin-collab-refresh" type="button" onClick={() => { setDashboard(null); setTotp(''); setError('') }}><RefreshCw size={17} /> Recharger avec un nouveau code</button>}
    </div>
  )
}

function DealQueueCard({
  deal,
  queue,
  reviewSlaTargetHours,
  onOpen,
}: {
  deal: AdminCollaborationDealSummary | AdminCollaborationReadyDeal | AdminCollaborationOverrideSummary
  queue: QueueKind
  reviewSlaTargetHours: number | undefined
  onOpen: (id: number) => void
}) {
  const summary = 'closingReportedAt' in deal
  const override = 'overrideReason' in deal
  const reason = override ? deal.overrideReason : summary ? deal.disputeReason || deal.clientConfirmationOverrideReason : undefined
  const highlighted = queue === 'disputes' ? deal.status === 'DISPUTED' : queue === 'overrides' ? Boolean(reason) : summary && (deal.status === 'DISPUTED' || Boolean(reason))
  const prerequisites = 'prerequisites' in deal ? deal.prerequisites : null
  const reviewer = 'reviewAssignedTo' in deal ? deal.reviewAssignedTo : null
  const reviewSla = queue === 'review' && 'reviewSlaStartedAt' in deal
    ? slaLabel(deal.reviewSlaStartedAt, reviewSlaTargetHours)
    : null
  return (
    <article className={`admin-collab-deal-card ${highlighted ? 'is-priority' : ''}`}>
      <div className="admin-collab-deal-card-main">
        <strong>Dossier #{deal.id} · {queue === 'review' ? 'Vérification' : queue === 'ready' ? 'Signature' : queue === 'disputes' ? 'Litige' : queue === 'overrides' ? 'Dérogation' : 'Suivi'}</strong>
        <DealStatus status={deal.status} />
        <span>Fournisseur : {deal.supplier?.name ?? 'Non attribué'}</span>
        <span>Closeur : {deal.closer?.name ?? 'Non attribué'}</span>
        <small>{override ? `Dérogation le ${formatDate(deal.overrideAt)}` : queue === 'disputes' && 'disputedAt' in deal ? `Litige ouvert le ${formatDate(deal.disputedAt)}` : summary ? `Rapport soumis le ${formatDate(deal.closingReportedAt)}` : `Mis à jour le ${formatDate(deal.updatedAt)}`}</small>
        {queue === 'review' && <>
          <small>Vérificateur : {reviewer?.name ?? 'À attribuer'}</small>
          {reviewSla && <span className={`admin-collab-sla${reviewSla.overdue ? ' is-overdue' : ''}`}>{reviewSla.overdue ? <AlertTriangle size={15} /> : <Clock3 size={15} />}{reviewSla.text}</span>}
        </>}
        {override && <small>Admin : {deal.admin?.name ?? 'Non renseigné'}</small>}
        {prerequisites && <small>Prérequis : {prerequisites.blockers.length ? prerequisites.blockers.join(', ') : 'Prêts à signer'}</small>}
        {reason && <p className="admin-collab-override"><AlertTriangle size={18} />{reason}</p>}
      </div>
      {queue === 'ready'
        ? <button className="outline-button" type="button" onClick={() => onOpen(deal.id)}>Consulter avant signature</button>
        : <button className="outline-button" type="button" onClick={() => onOpen(deal.id)}>{queue === 'review' ? 'Examiner le dossier' : 'Ouvrir le dossier'}</button>}
    </article>
  )
}

function AlertQueueCard({ alert, onOpen }: { alert: AdminCollaborationAlert; onOpen?: (id: number) => void }) {
  return (
    <article className="admin-collab-deal-card">
      <div className="admin-collab-deal-card-main">
        <strong>{alert.type === 'BYPASS' ? 'Contournement' : alert.type === 'EXTRACTION' ? 'Extraction' : 'Expirations répétées'}</strong>
        <span>{alert.message}</span>
        <span>Agent : {alert.agent?.name ?? alert.agents?.map((agent) => agent.name).join(', ') ?? 'Non attribué'}</span>
        <small>{formatDate(alert.occurredAt)} · {alert.severity === 'HIGH' ? 'Priorité élevée' : 'Priorité modérée'}</small>
      </div>
      {alert.dealId !== null && onOpen && <button className="outline-button" type="button" onClick={() => onOpen(alert.dealId!)}>Ouvrir le dossier</button>}
    </article>
  )
}

function localAntananarivoDate(): string {
  const date = new Date(Date.now() + 3 * 60 * 60_000)
  return date.toISOString().slice(0, 10)
}

function SignatureQueueCard({
  deal,
  slaTargetHours,
  onOpen,
  onSuccess,
  onReload,
}: {
  deal: AdminCollaborationReadyDeal
  slaTargetHours: number | undefined
  onOpen: () => void
  onSuccess: () => void
  onReload: () => void
}) {
  const [reference, setReference] = useState('')
  const [signedDate, setSignedDate] = useState(localAntananarivoDate)
  const [contractAmount, setContractAmount] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [totp, setTotp] = useState('')
  const [review, setReview] = useState(false)
  const [result, setResult] = useState<AdminCollaborationSignatureResult | null>(null)
  const [hash, setHash] = useState('')
  const [hashError, setHashError] = useState('')
  const [error, setError] = useState('')
  const [networkUncertain, setNetworkUncertain] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const sla = slaLabel(deal.confirmedAt, slaTargetHours)

  async function prepareSignature() {
    if (!deal.prerequisites.canSign || lock.current || result) return
    const cleanReference = reference.trim()
    if (!cleanReference || !signedDate || !validContractAmount(contractAmount) || !file) {
      setError('Renseignez la référence, la date, le montant final du projet et le fichier du contrat.')
      return
    }
    if (!isAllowedCollaborationUpload(file)) {
      setError('Le contrat doit être un PDF, JPEG, PNG ou WebP de 10 Mio maximum.')
      return
    }
    const confirmed = await confirmAction({
      title: 'Récapitulatif avant signature',
      message: [
        `Dossier #${deal.id}`,
        `Référence : ${cleanReference}`,
        `Date de signature : ${formatDate(antananarivoDateToIso(signedDate))}`,
        `Montant final du projet : ${formatAriaryAmount(contractAmount)}`,
        `Fichier : ${file.name}`,
        'Cette signature est définitive.',
      ].join('\n'),
      confirmLabel: 'Confirmer le récapitulatif',
    })
    if (!confirmed) return
    setReference(cleanReference)
    setReview(true)
    setTotp('')
    setError('')
  }

  async function submitSignature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || lock.current || result) return
    if (!validContractAmount(contractAmount)) {
      setError('Saisissez un montant final strictement positif en Ariary.')
      return
    }
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez un nouveau code administrateur à 6 chiffres.')
      return
    }
    lock.current = true
    setTotp('')
    setBusy(true)
    setError('')
    setNetworkUncertain(false)
    try {
      const signed = await api.signAdminCollaborationDeal(deal.id, code, {
        contractReference: reference,
        contractDate: antananarivoDateToIso(signedDate),
        contractAmount,
        file,
      })
      setResult(signed)
      setReview(false)
      onSuccess()
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 409) {
        const message = caught.message.toLowerCase().includes('correspondance')
          ? caught.message
          : 'Ce dossier est déjà signé ou ne peut plus être signé. Rechargez son état avant toute autre action.'
        setError(message)
      } else {
        setError(errorMessage(caught))
        setNetworkUncertain(!(caught instanceof ApiRequestError) || caught.status >= 500)
      }
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function loadHash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!result || lock.current) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setHashError('Saisissez un nouveau code administrateur à 6 chiffres.')
      return
    }
    lock.current = true
    setTotp('')
    setBusy(true)
    setHashError('')
    try {
      const detail = await api.adminCollaborationDeal(deal.id, code)
      const contract = detail.contractFiles.find((item) => item.id === result.evidenceId)
      if (!contract?.sha256) throw new Error('Empreinte du contrat introuvable dans la fiche.')
      setHash(contract.sha256)
    } catch (caught) {
      setHashError(errorMessage(caught))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <article className="admin-collab-deal-card admin-collab-action-card">
      <div className="admin-collab-deal-card-main">
        <strong>Dossier #{deal.id} · Étape 2 — Signature</strong>
        <span>Fournisseur : {deal.supplier?.name ?? 'Non attribué'} · Closeur : {deal.closer?.name ?? 'Non attribué'}</span>
        <small>Confirmé le {formatDate(deal.confirmedAt)} · mis à jour le {formatDate(deal.updatedAt)}</small>
        <small>Signataire : {deal.signAssignedTo?.name ?? 'À attribuer'}</small>
        {sla && <span className={`admin-collab-sla${sla.overdue ? ' is-overdue' : ''}`}>{sla.overdue ? <AlertTriangle size={15} /> : <Clock3 size={15} />}{sla.text}</span>}
        <button className="outline-button" type="button" onClick={onOpen}>Consulter le dossier avant signature</button>
        {!deal.prerequisites.canSign && (
          <div className="admin-collab-blockers">
            <strong>Signature bloquée</strong>
            {deal.prerequisites.blockers.map((blocker) => <span key={blocker}>{blocker}</span>)}
          </div>
        )}
      </div>
      {result ? (
        <div className="admin-collab-action-result" role="status">
          <strong><CheckCircle2 size={18} /> Contrat signé</strong>
          <span>Numéro de vente : {result.saleNumber}</span>
          <span>Montant final du projet : {formatAriaryAmount(result.contractAmount)}</span>
          {!hash ? (
            <form className="admin-collab-totp-form" onSubmit={(event) => void loadHash(event)}>
              <p>Pour afficher l’empreinte SHA-256, confirmez votre identité avec un nouveau TOTP.</p>
              <div className="admin-collab-inline-form">
                <AdminTotpCodeField id={`signature-hash-totp-${deal.id}`} label="Code administrateur" value={totp} onChange={setTotp} />
                <button className="outline-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}Voir le hash</button>
              </div>
              {hashError && <p className="admin-collab-error" role="alert">{hashError}</p>}
            </form>
          ) : <span className="admin-collab-hash">SHA-256 : {hash}</span>}
        </div>
      ) : deal.prerequisites.canSign && !review ? (
        <div className="admin-collab-signature-fields">
          <label>Référence du contrat<input value={reference} maxLength={150} onChange={(event) => setReference(event.target.value)} /></label>
          <label>Date de signature<input type="date" value={signedDate} onChange={(event) => setSignedDate(event.target.value)} /></label>
          <label>Montant final du projet (Ariary)
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={19}
              pattern="[0-9]{1,19}"
              placeholder="Ex. 2500000"
              value={contractAmount}
              onChange={(event) => setContractAmount(event.target.value.replace(/\D/g, '').slice(0, 19))}
            />
          </label>
          <p className="admin-collab-amount-note">Saisissez le montant exact indiqué sur le contrat signé. Le montant du rapport de clôture restera conservé séparément.</p>
          {contractAmount && validContractAmount(contractAmount) && <small>Montant final : {formatAriaryAmount(contractAmount)}</small>}
          <label>Fichier du contrat (PDF, JPEG, PNG ou WebP · 10 Mio max.)
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => {
              const selected = event.target.files?.[0] ?? null
              setFile(selected && isAllowedCollaborationUpload(selected) ? selected : null)
              setError(selected && !isAllowedCollaborationUpload(selected) ? 'Fichier invalide : formats PDF/JPEG/PNG/WebP, 10 Mio maximum.' : '')
            }} />
          </label>
          {file && <small>Fichier sélectionné : {file.name}</small>}
          <button className="primary-button" type="button" onClick={() => void prepareSignature()} disabled={busy}>Récapitulatif avant signature</button>
        </div>
      ) : review ? (
        <form className="admin-collab-totp-form" onSubmit={(event) => void submitSignature(event)}>
          <div className="admin-collab-decision-summary">
            <strong>Signature à confirmer</strong>
            <span>Dossier #{deal.id} · {deal.supplier?.name ?? 'Fournisseur'} / {deal.closer?.name ?? 'Closeur'}</span>
            <span>Référence : {reference}</span>
            <span>Date : {formatDate(antananarivoDateToIso(signedDate))}</span>
            <span>Montant final : {formatAriaryAmount(contractAmount)}</span>
            <span>Fichier : {file?.name}</span>
            <span>Cette action est irréversible et ne peut être effectuée qu’une fois.</span>
          </div>
          <div className="admin-collab-inline-form">
            <AdminTotpCodeField id={`signature-totp-${deal.id}`} label="Code administrateur pour signer" value={totp} onChange={setTotp} />
            <button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}Signer le contrat</button>
            <button className="outline-button" type="button" disabled={busy} onClick={() => { setReview(false); setTotp('') }}>Annuler</button>
          </div>
        </form>
      ) : null}
      {error && <p className="admin-collab-error" role="alert">{error}</p>}
      {networkUncertain && <section className="admin-collab-note">
        <AlertTriangle size={18} />
        <div><p>Le résultat réseau est incertain. Aucune nouvelle signature n’a été renvoyée automatiquement.</p><button className="admin-collab-refresh" type="button" onClick={onReload}>Recharger l’état avec un nouveau TOTP</button></div>
      </section>}
    </article>
  )
}

function CommissionWalletCard({ commission }: { commission: AdminCollaborationCommission }) {
  const amount = BigInt(commission.amount).toLocaleString('fr-FR')
  return (
    <article className="admin-collab-deal-card">
      <div className="admin-collab-deal-card-main">
        <strong>{commission.saleNumber ? `Vente ${commission.saleNumber}` : `Dossier #${commission.dealId}`}</strong>
        <span>{commission.agent.name} · {commission.role === 'SUPPLIER' ? 'Fournisseur' : 'Closeur'}</span>
        <span>{amount} {commission.currency}</span>
        <small>Créditée au portefeuille le {formatDate(commission.generatedAt)}</small>
      </div>
      <p className="admin-collab-note">Le paiement et sa référence seront enregistrés depuis la file des retraits, après la demande de l’agent.</p>
    </article>
  )
}

function CommissionCsvExport({ onError }: { onError: (message: string) => void }) {
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  async function exportCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      onError('Saisissez un code administrateur à 6 chiffres pour exporter.')
      return
    }
    lock.current = true
    setTotp('')
    setBusy(true)
    onError('')
    try {
      const blob = await api.exportAdminCollaborationCommissions(code)
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = 'collaboration-commissions.csv'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (caught) {
      onError(errorMessage(caught))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <section className="admin-collab-panel admin-collab-export-panel">
      <div className="admin-collab-note"><AlertTriangle size={18} /><p>Export contenant des données financières. Le fichier est préparé en mémoire et n’est pas enregistré dans le stockage de l’application.</p></div>
      <form className="admin-collab-totp-form" onSubmit={(event) => void exportCsv(event)}>
        <div className="admin-collab-inline-form">
          <AdminTotpCodeField id="admin-collab-export-totp" label="Code pour l’export CSV" value={totp} onChange={setTotp} />
          <button className="outline-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}Exporter le CSV</button>
        </div>
      </form>
    </section>
  )
}

function DealReview({
  detail,
  reason,
  onReasonChange,
  overrideConfirmation,
  onOverrideChange,
  pendingDecision,
  summaryDisplayed,
  totp,
  onTotpChange,
  busy,
  error,
  onPrepareDecision,
  onSubmitDecision,
  onCancelDecision,
  canReview,
  canOverrideConfirmation,
  canRestoreHiddenAgent,
  canManageAssignments,
  onAssignmentChange,
  onRestoreHiddenAgent,
}: {
  detail: AdminCollaborationDealDetail
  reason: string
  onReasonChange: (value: string) => void
  overrideConfirmation: boolean
  onOverrideChange: (value: boolean) => void
  pendingDecision: { decision: 'CONFIRM' | 'REJECT'; reason?: string; overrideConfirmation?: boolean } | null
  summaryDisplayed: boolean
  totp: string
  onTotpChange: (value: string) => void
  busy: boolean
  error: string
  onPrepareDecision: (decision: 'CONFIRM' | 'REJECT') => void
  onSubmitDecision: (event: FormEvent<HTMLFormElement>) => void
  onCancelDecision: () => void
  canReview: boolean
  canOverrideConfirmation: boolean
  canRestoreHiddenAgent: boolean
  canManageAssignments: boolean
  onAssignmentChange: (assignment: { reviewAssignedToId: number | null; signAssignedToId: number | null }) => void
  onRestoreHiddenAgent: (agentId: number) => void
}) {
  const confirmedByClient = detail.clientConfirmation?.status === 'CONFIRMED_BY_CLIENT' || detail.clientConfirmation?.status === 'CONFIRMED'
  const evidence = detail.closingReport?.evidence ?? []
  const [downloadError, setDownloadError] = useState('')
  const [restoreAgentId, setRestoreAgentId] = useState<number | null>(null)
  const [restoreTotp, setRestoreTotp] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [reviewAssigneeId, setReviewAssigneeId] = useState(detail.reviewAssignedToId?.toString() ?? '')
  const [signAssigneeId, setSignAssigneeId] = useState(detail.signAssignedToId?.toString() ?? '')
  const [assignmentTotp, setAssignmentTotp] = useState('')
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [assignmentError, setAssignmentError] = useState('')
  const [assignmentSuccess, setAssignmentSuccess] = useState('')

  async function saveAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (assignmentBusy) return
    const code = assignmentTotp.trim()
    if (!/^\d{6}$/.test(code)) {
      setAssignmentError('Saisissez un nouveau code administrateur à 6 chiffres.')
      return
    }
    const input = detail.assignmentEligibility.review
      ? { reviewAssignedToId: reviewAssigneeId ? Number(reviewAssigneeId) : null }
      : { signAssignedToId: signAssigneeId ? Number(signAssigneeId) : null }
    setAssignmentTotp('')
    setAssignmentBusy(true)
    setAssignmentError('')
    setAssignmentSuccess('')
    try {
      const updated = await api.assignAdminCollaborationDeal(code, detail.id, input)
      onAssignmentChange(updated)
      setReviewAssigneeId(updated.reviewAssignedToId?.toString() ?? '')
      setSignAssigneeId(updated.signAssignedToId?.toString() ?? '')
      setAssignmentSuccess('Affectation enregistrée.')
    } catch (caught) {
      setAssignmentError(errorMessage(caught))
    } finally {
      setAssignmentBusy(false)
    }
  }

  async function restoreHiddenAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (restoreAgentId === null || restoreBusy) return
    const code = restoreTotp.trim()
    if (!/^\d{6}$/.test(code)) {
      setRestoreError('Saisissez un nouveau code administrateur à 6 chiffres.')
      return
    }
    setRestoreTotp('')
    setRestoreBusy(true)
    setRestoreError('')
    try {
      await api.restoreAdminHiddenCollaborationAgent(detail.id, restoreAgentId, code)
      onRestoreHiddenAgent(restoreAgentId)
      setRestoreAgentId(null)
    } catch (caught) {
      setRestoreError(errorMessage(caught))
    } finally {
      setRestoreBusy(false)
    }
  }

  async function downloadSignedFile(file: { downloadUrl: string; fileName: string }) {
    setDownloadError('')
    try {
      const response = await fetch(file.downloadUrl, { cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) throw new Error('Téléchargement refusé.')
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = file.fileName
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch {
      setDownloadError('Le lien sécurisé a expiré ou le fichier est indisponible. Rechargez le dossier pour obtenir un nouveau lien.')
    }
  }

  return (
    <>
      {error && <p className="admin-collab-error" role="alert">{error}</p>}
      <header className="admin-collab-detail-heading">
        <div>
          <p className="eyebrow">DOSSIER #{detail.id}</p>
          <h1>Vérification de la vente</h1>
          <p className="intro"><DealStatus status={detail.status} /> · Déclarée le {formatDate(detail.declaredAt)}</p>
        </div>
      </header>
      <div className="admin-collab-detail-grid">
        <section className="admin-collab-panel">
          <div className="admin-collab-panel-heading"><div><FileText size={20} /><h2>Rapport de clôture</h2></div><span>{detail.closingReport?.status ?? 'Aucun rapport'}</span></div>
          {detail.closingReport ? (
            <dl className="admin-collab-data">
              <div><dt>Entreprise</dt><dd>{detail.report.companyName}</dd></div>
              <div><dt>Produit / service</dt><dd>{detail.report.product?.title ?? detail.report.customServiceDescription ?? detail.report.reportType}</dd></div>
              <div><dt>Ville</dt><dd>{detail.report.city}</dd></div>
              <div><dt>Contact déclaré</dt><dd>{detail.report.contactName} · {detail.report.contactRole}</dd></div>
              <div><dt>Coordonnées du dossier</dt><dd>{detail.prospect?.phone ?? detail.report.contactPhone}{detail.prospect?.email || detail.report.contactEmail ? ` · ${detail.prospect?.email ?? detail.report.contactEmail}` : ''}</dd></div>
              <div><dt>Montant déclaré</dt><dd>{detail.closingReport.saleAmount ? `${Number(detail.closingReport.saleAmount).toLocaleString('fr-FR')} Ar` : 'Non renseigné'}</dd></div>
              {detail.contractAmount !== null && <div><dt>Montant final au contrat</dt><dd>{formatAriaryAmount(detail.contractAmount)}</dd></div>}
              <div><dt>Date de vente</dt><dd>{formatDate(detail.closingReport.saleDate)}</dd></div>
              <div><dt>Rapport soumis</dt><dd>{formatDate(detail.closingReport.submittedAt ?? detail.closingReport.reportedAt)}</dd></div>
              <div className="admin-collab-data-wide"><dt>Description</dt><dd>{detail.closingReport.details || detail.report.summary || 'Aucune description.'}</dd></div>
              {detail.closingReport.rejectionReason && <div className="admin-collab-data-wide"><dt>Motif précédent</dt><dd>{detail.closingReport.rejectionReason}</dd></div>}
              {detail.closingReport.supplements.map((supplement) => <div className="admin-collab-data-wide" key={supplement.id}><dt>Complément · {formatDate(supplement.createdAt)} · {supplement.author.email}</dt><dd>{supplement.details}</dd></div>)}
            </dl>
          ) : <p className="admin-collab-muted">Le rapport de clôture n’est pas disponible.</p>}
        </section>

        <section className="admin-collab-panel">
          <div className="admin-collab-panel-heading"><div><CheckCircle2 size={20} /><h2>Confirmation client</h2></div></div>
          <p className={`admin-collab-confirmation ${confirmedByClient ? 'is-confirmed' : detail.clientConfirmation?.status === 'DENIED' ? 'is-denied' : ''}`}>
            {confirmedByClient ? <CheckCircle2 size={20} /> : detail.clientConfirmation?.status === 'DENIED' ? <XCircle size={20} /> : <Clock3 size={20} />}
            {confirmationLabel(detail)}
          </p>
          {detail.clientConfirmation && <dl className="admin-collab-data compact">
            <div><dt>Code envoyé</dt><dd>{formatDate(detail.clientConfirmation.sentAt)}</dd></div>
            <div><dt>Réponse</dt><dd>{formatDate(detail.clientConfirmation.respondedAt)}</dd></div>
            <div><dt>Expiration</dt><dd>{formatDate(detail.clientConfirmation.expiresAt)}</dd></div>
            <div><dt>Tentatives</dt><dd>{detail.clientConfirmation.attempts}</dd></div>
          </dl>}
          {detail.clientConfirmationOverrideReason && <p className="admin-collab-override"><AlertTriangle size={18} />Dérogation enregistrée : {detail.clientConfirmationOverrideReason}</p>}
        </section>

        <section className="admin-collab-panel">
          <div className="admin-collab-panel-heading"><div><ShieldCheck size={20} /><h2>Agents et scores</h2></div></div>
          <div className="admin-collab-agent-scores">
            <article><span>Fournisseur</span><strong>{agentName(detail.supplier)}</strong><small>{scoreLabel(detail.supplier.score)}</small></article>
            <article><span>Closeur</span><strong>{agentName(detail.closer)}</strong><small>{detail.closer ? scoreLabel(detail.closer.score) : 'Aucun closeur attribué'}</small></article>
          </div>
        </section>

        {canManageAssignments && <section className="admin-collab-panel">
          <div className="admin-collab-panel-heading"><div><Users size={20} /><h2>Affectation de l’équipe</h2></div></div>
          <dl className="admin-collab-data compact">
            <div><dt>Vérificateur actuel</dt><dd>{detail.reviewAssignedTo?.name ?? 'Non attribué'}</dd></div>
            <div><dt>Signataire actuel</dt><dd>{detail.signAssignedTo?.name ?? 'Non attribué'}</dd></div>
          </dl>
          {detail.assignmentEligibility.review || detail.assignmentEligibility.sign ? (
            <form className="admin-collab-totp-form" onSubmit={(event) => void saveAssignment(event)}>
              {detail.assignmentEligibility.review && <>
                <label htmlFor={`review-assignee-${detail.id}`}>Vérificateur</label>
                <select id={`review-assignee-${detail.id}`} value={reviewAssigneeId} onChange={(event) => setReviewAssigneeId(event.target.value)}>
                  <option value="">Aucun · remettre dans la file d’affectation</option>
                  {detail.reviewAssignedTo && !detail.assignmentTeam?.reviewers.some(({ id }) => id === detail.reviewAssignedTo?.id)
                    && <option value={detail.reviewAssignedTo.id}>{detail.reviewAssignedTo.name} · compte non opérationnel</option>}
                  {detail.assignmentTeam?.reviewers.map((member: AdminCollaborationAssignmentOption) => <option value={member.id} key={member.id}>{member.name} · {member.email}</option>)}
                </select>
              </>}
              {detail.assignmentEligibility.sign && <>
                <label htmlFor={`sign-assignee-${detail.id}`}>Signataire</label>
                <select id={`sign-assignee-${detail.id}`} value={signAssigneeId} onChange={(event) => setSignAssigneeId(event.target.value)}>
                  <option value="">Aucun · remettre dans la file d’affectation</option>
                  {detail.signAssignedTo && !detail.assignmentTeam?.signers.some(({ id }) => id === detail.signAssignedTo?.id)
                    && <option value={detail.signAssignedTo.id}>{detail.signAssignedTo.name} · compte non opérationnel</option>}
                  {detail.assignmentTeam?.signers.map((member: AdminCollaborationAssignmentOption) => <option value={member.id} key={member.id}>{member.name} · {member.email}</option>)}
                </select>
              </>}
              <div className="admin-collab-inline-form">
                <AdminTotpCodeField id={`assignment-totp-${detail.id}`} label="Code pour confirmer l’affectation" value={assignmentTotp} onChange={setAssignmentTotp} />
                <button className="primary-button" type="submit" disabled={assignmentBusy}>{assignmentBusy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Enregistrer l’affectation</button>
              </div>
              {assignmentError && <p className="admin-collab-error" role="alert">{assignmentError}</p>}
              {assignmentSuccess && <p className="admin-collab-confirmation is-confirmed" role="status">{assignmentSuccess}</p>}
            </form>
          ) : <p className="admin-collab-muted">Ce dossier n’est pas actuellement dans une file d’affectation.</p>}
        </section>}

        {canRestoreHiddenAgent && <section className="admin-collab-panel">
          <div className="admin-collab-panel-heading"><div><Users size={20} /><h2>Prospect retiré des listes</h2></div></div>
          {detail.hiddenAgents.length === 0
            ? <p className="admin-collab-muted">Aucun agent n’a retiré ce prospect de sa liste.</p>
            : <div className="admin-collab-agent-list">
              {detail.hiddenAgents.map((agent) => (
                <article className="admin-collab-agent-card" key={agent.id}>
                  <strong>{agent.name}</strong>
                  <span>{agent.email} · {formatDate(agent.hiddenAt)}</span>
                  <button className="outline-button" type="button" onClick={() => { setRestoreAgentId(agent.id); setRestoreError('') }}>
                    Réafficher pour cet agent
                  </button>
                </article>
              ))}
            </div>}
          {restoreAgentId !== null && <form className="admin-collab-totp-form" onSubmit={(event) => void restoreHiddenAgent(event)}>
            <div className="admin-collab-inline-form">
              <AdminTotpCodeField id={`restore-hidden-agent-${restoreAgentId}`} label="Code pour réafficher le prospect" value={restoreTotp} onChange={setRestoreTotp} />
              <button className="primary-button" type="submit" disabled={restoreBusy}>{restoreBusy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Réafficher</button>
              <button className="outline-button" type="button" onClick={() => { setRestoreAgentId(null); setRestoreTotp(''); setRestoreError('') }} disabled={restoreBusy}>Annuler</button>
            </div>
            {restoreError && <p className="admin-collab-error" role="alert">{restoreError}</p>}
          </form>}
        </section>}

        <section className="admin-collab-panel">
          <div className="admin-collab-panel-heading"><div><FileText size={20} /><h2>Pièces jointes</h2></div></div>
          {evidence.length === 0 ? <p className="admin-collab-muted">Aucune pièce jointe associée au rapport.</p> : (
            <ul className="admin-collab-evidence">
              {evidence.map((file) => <li key={file.id}><button className="admin-collab-file-button" type="button" onClick={() => void downloadSignedFile(file)}>{file.fileName}</button><small>SHA-256 : {file.sha256}</small></li>)}
            </ul>
          )}
          {detail.contractFiles.length > 0 && <div className="admin-collab-contract-files"><strong>Contrats</strong>{detail.contractFiles.map((file) => <button className="admin-collab-file-button" key={file.id} type="button" onClick={() => void downloadSignedFile(file)}>{file.fileName} · SHA-256 {file.sha256}</button>)}</div>}
          {downloadError && <p className="admin-collab-error" role="alert">{downloadError}</p>}
        </section>

        <section className="admin-collab-panel admin-collab-history-panel">
          <div className="admin-collab-panel-heading"><div><Clock3 size={20} /><h2>Historique</h2></div></div>
          {detail.statusHistory.length === 0 ? <p className="admin-collab-muted">Aucun historique de statut.</p> : (
            <ol className="admin-collab-history">
              {detail.statusHistory.map((entry) => <li key={entry.id}>
                <span className="admin-collab-history-dot" />
                <div><strong>{entry.fromStatus ? `${STATUS_LABELS[entry.fromStatus] ?? entry.fromStatus} → ` : ''}{STATUS_LABELS[entry.toStatus] ?? entry.toStatus}</strong><small>{formatDate(entry.createdAt)} · {entry.actor?.email ?? 'Système'}</small>{entry.comment && <p>{entry.comment}</p>}</div>
              </li>)}
            </ol>
          )}
        </section>
      </div>

      {canReview && <section className="admin-collab-panel admin-collab-decision-panel">
        <div className="admin-collab-panel-heading"><div><AlertTriangle size={20} /><h2>Décision</h2></div></div>
        {!detail.closingReport ? (
          <p className="admin-collab-muted">Aucune décision n’est proposée : l’API exige un rapport de clôture pour confirmer ou rejeter ce dossier.</p>
        ) : !pendingDecision ? (
          <>
            <label className="admin-collab-field-label" htmlFor="admin-collab-reason">Motif de rejet ou de dérogation (obligatoire si concerné)</label>
            <textarea id="admin-collab-reason" rows={3} maxLength={2000} value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Expliquez clairement la décision…" />
            {!confirmedByClient && canOverrideConfirmation && <label className="admin-collab-checkbox"><input type="checkbox" checked={overrideConfirmation} onChange={(event) => onOverrideChange(event.target.checked)} /><span>Confirmer malgré l’absence de confirmation client (dérogation motivée)</span></label>}
            {!confirmedByClient && !canOverrideConfirmation && <p className="admin-collab-override"><AlertTriangle size={18} />À transmettre à un administrateur : la confirmation client est absente.</p>}
            <div className="admin-collab-decision-actions">
              <button type="button" className="admin-collab-confirm-button" onClick={() => onPrepareDecision('CONFIRM')} disabled={busy || (!confirmedByClient && !canOverrideConfirmation)}><CheckCircle2 size={18} />Confirmer la vente</button>
              <button type="button" className="admin-collab-reject-button" onClick={() => onPrepareDecision('REJECT')} disabled={busy || (!confirmedByClient && !canOverrideConfirmation)}><XCircle size={18} />Rejeter le dossier</button>
            </div>
          </>
        ) : (
          <form className="admin-collab-totp-form" onSubmit={onSubmitDecision}>
            <p>{pendingDecision.decision === 'CONFIRM' ? 'La vente sera confirmée' : 'Le dossier sera rejeté'} avec le code administrateur à usage unique. Ce code ne sera pas conservé.</p>
            {summaryDisplayed && <div className="admin-collab-decision-summary" role="status">
              <strong>Récapitulatif à confirmer</strong>
              <span>Dossier #{detail.id} · {pendingDecision.decision === 'CONFIRM' ? 'Confirmation de la vente' : 'Rejet du dossier'}</span>
              <span>Fournisseur : {agentName(detail.supplier)} · Closeur : {agentName(detail.closer)}</span>
              {pendingDecision.reason && <span>Motif : {pendingDecision.reason}</span>}
              {pendingDecision.overrideConfirmation && <span>Dérogation : confirmation client absente ; motif enregistré et visible dans le dossier.</span>}
            </div>}
            {pendingDecision.overrideConfirmation && <p className="admin-collab-override"><AlertTriangle size={18} />Cette confirmation déroge à l’absence de confirmation client.</p>}
            <div className="admin-collab-inline-form">
              <AdminTotpCodeField id="admin-collab-decision-totp" label="Code pour confirmer la décision" value={totp} onChange={onTotpChange} />
              <button className="primary-button" type="submit" disabled={busy || !summaryDisplayed}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}Confirmer et enregistrer</button>
              <button className="outline-button" type="button" onClick={onCancelDecision} disabled={busy}>Annuler</button>
            </div>
          </form>
        )}
      </section>}
    </>
  )
}

function AuditChainStatusCard({ status, onChange }: { status: AdminAuditVerification | null; onChange: (value: AdminAuditVerification | null) => void }) {
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = totp.trim()
    if (lock.current) return
    if (!/^\d{6}$/.test(code)) { setError('Saisissez le code administrateur à 6 chiffres.'); return }
    lock.current = true
    setTotp('')
    setBusy(true)
    setError('')
    try { onChange(await api.adminCollaborationAuditVerification(code)) }
    catch (caught) { setError(errorMessage(caught)) }
    finally { lock.current = false; setBusy(false) }
  }

  const label = status?.status ?? 'Non vérifiée'
  return (
    <section className={`admin-collab-panel admin-collab-chain is-${auditChainTone(status?.status ?? null)}`} aria-live="polite">
      <div className="admin-collab-panel-heading"><div><ShieldCheck size={20} /><h2>Vérification de la chaîne d’audit</h2></div>
        <strong className="admin-collab-chain-status">{label}</strong>
      </div>
      {status?.status === 'BROKEN' && <p className="admin-collab-chain-alert" role="alert"><AlertTriangle size={18} />Alerte : la vérification signale une rupture dans la chaîne d’audit.</p>}
      {status && status.status !== 'VALID' && status.status !== 'BROKEN' && <p className="admin-collab-muted">Chaîne non certifiée : {status.status === 'STALE' ? 'la dernière vérification a plus de 36 heures.' : 'aucune vérification exploitable n’est disponible.'}</p>}
      {status?.checkedAt && <p className="admin-collab-muted">Dernière vérification : {formatDate(status.checkedAt)}</p>}
      <form className="admin-collab-totp-form" onSubmit={(event) => void load(event)}>
        <div className="admin-collab-inline-form">
          <AdminTotpCodeField id="admin-collab-dashboard-chain-totp" label="Code pour vérifier la chaîne" value={totp} onChange={setTotp} />
          <button type="submit" className="outline-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Vérifier la chaîne</button>
        </div>
      </form>
      {error && <p className="admin-collab-error" role="alert">{error}</p>}
    </section>
  )
}

function AuditPanel() {
  const [filters, setFilters] = useState<AdminAuditFilters>({})
  const [draftFilters, setDraftFilters] = useState<AdminAuditFilters>({})
  const [entries, setEntries] = useState<AdminCollaborationAuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [chain, setChain] = useState<AdminAuditVerification | null>(null)
  const [totp, setTotp] = useState('')
  const [verificationTotp, setVerificationTotp] = useState('')
  const [exportTotp, setExportTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const lock = useRef(false)
  const exportLock = useRef(false)
  const verificationLock = useRef(false)
  const [verificationBusy, setVerificationBusy] = useState(false)

  async function loadEntries(event?: FormEvent<HTMLFormElement>, nextPage = page, requestedFilters = filters) {
    event?.preventDefault()
    const code = totp.trim()
    if (lock.current) return
    if (!/^\d{6}$/.test(code)) { setError('Saisissez le code administrateur à 6 chiffres.'); return }
    lock.current = true
    setTotp('')
    setBusy(true)
    setError('')
    try {
      const result = await api.adminCollaborationAudit(code, requestedFilters, nextPage, 50)
      setEntries(result.data)
      setTotal(result.pagination.total)
      setPage(nextPage)
      setLoaded(true)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { lock.current = false; setBusy(false) }
  }

  async function loadChain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = verificationTotp.trim()
    if (verificationLock.current) return
    if (!/^\d{6}$/.test(code)) { setError('Saisissez un code administrateur frais.'); return }
    verificationLock.current = true
    setVerificationTotp('')
    setVerificationBusy(true)
    setError('')
    try { setChain(await api.adminCollaborationAuditVerification(code)) }
    catch (caught) { setError(errorMessage(caught)) }
    finally { verificationLock.current = false; setVerificationBusy(false) }
  }

  async function exportCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (exportLock.current) return
    const code = exportTotp.trim()
    if (!/^\d{6}$/.test(code)) { setExportError('Saisissez un code administrateur frais.'); return }
    exportLock.current = true
    setExportTotp('')
    setExportBusy(true)
    setExportError('')
    try {
      const blob = await api.exportAdminCollaborationAudit(code, filters)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'journal-audit-collaboration.csv'
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (caught) { setExportError(errorMessage(caught)) }
    finally { exportLock.current = false; setExportBusy(false) }
  }

  const maxPage = Math.max(1, Math.ceil(total / 50))
  return (
    <div className="admin-collab-special-panels">
      <section className={`admin-collab-panel admin-collab-chain is-${auditChainTone(chain?.status ?? null)}`}>
        <div className="admin-collab-panel-heading"><div><ShieldCheck size={20} /><h2>Statut de la chaîne</h2></div><strong className="admin-collab-chain-status">{chain?.status ?? 'Non vérifiée'}</strong></div>
        {chain?.status === 'BROKEN' && <p className="admin-collab-chain-alert" role="alert"><AlertTriangle size={18} />La chaîne d’audit est signalée comme rompue.</p>}
        {chain && chain.status !== 'VALID' && chain.status !== 'BROKEN' && <p className="admin-collab-muted">{chain.status === 'STALE' ? 'La vérification date de plus de 36 heures.' : 'Aucune vérification exploitable.'}</p>}
        {chain?.checkedAt && <p className="admin-collab-muted">Dernière vérification : {formatDate(chain.checkedAt)}</p>}
        <form className="admin-collab-totp-form" onSubmit={(event) => void loadChain(event)}>
          <div className="admin-collab-inline-form">
            <AdminTotpCodeField id="admin-collab-audit-chain-totp" label="Code pour vérifier la chaîne" value={verificationTotp} onChange={setVerificationTotp} />
            <button type="submit" className="outline-button" disabled={verificationBusy}>{verificationBusy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Vérifier</button>
          </div>
        </form>
      </section>
      <section className="admin-collab-panel">
        <div className="admin-collab-panel-heading"><div><ScrollText size={20} /><h2>Filtres du journal</h2></div></div>
        <form className="admin-collab-admin-filters" onSubmit={(event) => {
          event.preventDefault()
          const nextFilters: AdminAuditFilters = {
            actorId: draftFilters.actorId?.trim() || undefined,
            entityType: draftFilters.entityType?.trim() || undefined,
            entityId: draftFilters.entityId?.trim() || undefined,
            action: draftFilters.action?.trim() || undefined,
            from: draftFilters.from ? antananarivoDayBoundaryToIso(draftFilters.from.slice(0, 10), false) : undefined,
            to: draftFilters.to ? antananarivoDayBoundaryToIso(draftFilters.to.slice(0, 10), true) : undefined,
          }
          setFilters(nextFilters)
          setPage(1)
          setLoaded(false)
          void loadEntries(undefined, 1, nextFilters)
        }}>
          <label>Acteur (ID)<input inputMode="numeric" value={draftFilters.actorId ?? ''} onChange={(event) => setDraftFilters((value) => ({ ...value, actorId: event.target.value }))} /></label>
          <label>Type d’objet<input value={draftFilters.entityType ?? ''} onChange={(event) => setDraftFilters((value) => ({ ...value, entityType: event.target.value }))} /></label>
          <label>ID objet<input inputMode="numeric" value={draftFilters.entityId ?? ''} onChange={(event) => setDraftFilters((value) => ({ ...value, entityId: event.target.value }))} /></label>
          <label>Action<input value={draftFilters.action ?? ''} onChange={(event) => setDraftFilters((value) => ({ ...value, action: event.target.value }))} /></label>
          <label>Du<input type="date" value={draftFilters.from?.slice(0, 10) ?? ''} onChange={(event) => setDraftFilters((value) => ({ ...value, from: event.target.value }))} /></label>
          <label>Au<input type="date" value={draftFilters.to?.slice(0, 10) ?? ''} onChange={(event) => setDraftFilters((value) => ({ ...value, to: event.target.value }))} /></label>
          <AdminTotpCodeField className="admin-collab-filter-totp" label="Code administrateur" value={totp} onChange={setTotp} />
          <button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Appliquer les filtres</button>
        </form>
        {error && <p className="admin-collab-error" role="alert">{error}</p>}
      </section>
      {loaded && (
        <section className="admin-collab-panel">
          <div className="admin-collab-panel-heading"><div><ScrollText size={20} /><h2>Événements</h2></div><span>{total} résultat{total === 1 ? '' : 's'} · Page {page}/{maxPage}</span></div>
          {entries.length === 0 ? <p className="admin-collab-muted">Aucun événement pour ces filtres.</p> : (
            <div className="admin-collab-audit-list">
              {entries.map((entry) => <article key={entry.sequence}>
                <strong>{entry.action}</strong><span>{entry.entityType}{entry.entityId ? ` #${entry.entityId}` : ''}{entry.dealId ? ` · Dossier #${entry.dealId}` : ''}</span>
                <small>{formatDate(entry.createdAt)} · {entry.actorEmail ?? `Acteur #${entry.actorId ?? 'système'}`} · {entry.actorRole ?? 'SYSTEM'}</small>
              </article>)}
            </div>
          )}
          <div className="admin-collab-pagination">
            <button className="outline-button" type="button" disabled={page <= 1 || busy} onClick={() => void loadEntries(undefined, page - 1)}>Précédent</button><span>Page {page}/{maxPage}</span>
            <button className="outline-button" type="button" disabled={page >= maxPage || busy} onClick={() => void loadEntries(undefined, page + 1)}>Suivant</button>
          </div>
          <form className="admin-collab-totp-form admin-collab-audit-export" onSubmit={(event) => void exportCsv(event)}>
            <p className="admin-collab-note"><AlertTriangle size={18} />Le CSV contient des données de journal sensibles. Il est téléchargé en mémoire et ne sera pas conservé par l’application.</p>
            <div className="admin-collab-inline-form">
              <AdminTotpCodeField id="admin-collab-audit-export-totp" label="Code pour l’export du journal" value={exportTotp} onChange={setExportTotp} />
              <button type="submit" className="outline-button" disabled={exportBusy}>{exportBusy ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}Exporter le CSV</button>
            </div>
            {exportError && <p className="admin-collab-error" role="alert">{exportError}</p>}
          </form>
        </section>
      )}
    </div>
  )
}

function AgentTrustPanel() {
  const [agents, setAgents] = useState<AdminCollaborationTrustAgent[]>([])
  const [trustPage, setTrustPage] = useState(1)
  const [trustTotal, setTrustTotal] = useState(0)
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [alertType, setAlertType] = useState<AdminCollaborationAlert['type']>('EXTRACTION')
  const [alertAgentId, setAlertAgentId] = useState('')
  const [alertFrom, setAlertFrom] = useState('')
  const [alertTo, setAlertTo] = useState('')
  const [alertsTotp, setAlertsTotp] = useState('')
  const [alerts, setAlerts] = useState<AdminCollaborationAlert[]>([])
  const [alertsTotal, setAlertsTotal] = useState(0)
  const [alertPage, setAlertPage] = useState(1)
  const [alertsLoaded, setAlertsLoaded] = useState(false)
  const requestLock = useRef(false)

  async function loadAgents(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = totp.trim()
    if (!/^\d{6}$/.test(code) || requestLock.current) { setError('Saisissez un code administrateur valide à 6 chiffres.'); return }
    requestLock.current = true
    setTotp('')
    setBusy(true)
    setError('')
    try {
      const result = await api.adminCollaborationTrust(code, trustPage, 50)
      setAgents(result.data)
      setTrustTotal(result.pagination.total)
      setLoaded(true)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { requestLock.current = false; setBusy(false) }
  }

  async function loadAlerts(event?: FormEvent<HTMLFormElement>, nextPage = alertPage) {
    event?.preventDefault()
    const code = alertsTotp.trim()
    if (!/^\d{6}$/.test(code) || requestLock.current) { setError('Saisissez un code administrateur valide à 6 chiffres.'); return }
    requestLock.current = true
    setAlertsTotp('')
    setBusy(true)
    setError('')
    try {
      const result = await api.adminCollaborationAlerts(code, alertType, nextPage, 50, {
        ...(alertAgentId ? { agentId: alertAgentId } : {}),
        ...(alertFrom ? { from: antananarivoDayBoundaryToIso(alertFrom, false) } : {}),
        ...(alertTo ? { to: antananarivoDayBoundaryToIso(alertTo, true) } : {}),
      })
      setAlerts(result.data)
      setAlertsTotal(result.pagination.total)
      setAlertPage(nextPage)
      setAlertsLoaded(true)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { requestLock.current = false; setBusy(false) }
  }

  return (
    <div className="admin-collab-special-panels">
      <section className="admin-collab-panel">
        <div className="admin-collab-panel-heading"><div><Users size={20} /><h2>Confiance et statut des agents</h2></div>{loaded && <span>{trustTotal} agent{trustTotal === 1 ? '' : 's'} · Page {trustPage}/{Math.max(1, Math.ceil(trustTotal / 50))}</span>}</div>
        {!loaded ? <form className="admin-collab-totp-form" onSubmit={(event) => void loadAgents(event)}>
          <p>La liste paginée affiche jusqu’à 50 agents par page.</p>
          <div className="admin-collab-inline-form">
            <AdminTotpCodeField id="admin-collab-trust-totp" label="Code pour charger les scores" value={totp} onChange={setTotp} />
            <button type="submit" className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}Charger les scores</button>
          </div>
        </form> : agents.length === 0 ? <p className="admin-collab-muted">Aucun agent dans la réponse.</p> : (
          <div className="admin-collab-agent-list">
            {agents.map((agent) => <AgentStatusCard key={agent.id} agent={agent} onSuccess={() => setLoaded(false)} />)}
          </div>
        )}
        {loaded && <div className="admin-collab-pagination">
          <button type="button" className="outline-button" disabled={trustPage <= 1 || busy} onClick={() => { setTrustPage((value) => value - 1); setLoaded(false); setTotp('') }}>Précédent</button>
          <span>Page {trustPage}/{Math.max(1, Math.ceil(trustTotal / 50))}</span>
          <button type="button" className="outline-button" disabled={trustPage >= Math.max(1, Math.ceil(trustTotal / 50)) || busy} onClick={() => { setTrustPage((value) => value + 1); setLoaded(false); setTotp('') }}>Suivant</button>
        </div>}
      </section>
      <section className="admin-collab-panel">
        <div className="admin-collab-panel-heading"><div><AlertTriangle size={20} /><h2>Alertes des agents</h2></div></div>
        <form className="admin-collab-admin-filters" onSubmit={(event) => { setAlertPage(1); void loadAlerts(event, 1) }}>
          <label>Type<select value={alertType} onChange={(event) => setAlertType(event.target.value as AdminCollaborationAlert['type'])}><option value="EXTRACTION">Extraction</option><option value="BYPASS">Contournement</option><option value="REPEATED_EXPIRATIONS">Expirations répétées</option></select></label>
          <label>Agent (ID)<input inputMode="numeric" value={alertAgentId} onChange={(event) => setAlertAgentId(event.target.value)} /></label>
          <label>Du<input type="date" value={alertFrom} onChange={(event) => setAlertFrom(event.target.value)} /></label>
          <label>Au<input type="date" value={alertTo} onChange={(event) => setAlertTo(event.target.value)} /></label>
          <AdminTotpCodeField className="admin-collab-filter-totp" label="Code administrateur" value={alertsTotp} onChange={setAlertsTotp} />
          <button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Charger les alertes</button>
        </form>
        {alertsLoaded && <div className="admin-collab-special-panels">
          <p className="admin-collab-muted">{alertsTotal} alerte{alertsTotal === 1 ? '' : 's'} · Page {alertPage}/{Math.max(1, Math.ceil(alertsTotal / 50))}</p>
          {alerts.length === 0 ? <p className="admin-collab-muted">Aucune alerte pour ces filtres.</p> : alerts.map((alert) => <AlertQueueCard key={alert.id} alert={alert} />)}
          <div className="admin-collab-pagination">
            <button className="outline-button" type="button" disabled={alertPage <= 1 || busy} onClick={() => void loadAlerts(undefined, alertPage - 1)}>Précédent</button>
            <span>Page {alertPage}/{Math.max(1, Math.ceil(alertsTotal / 50))}</span>
            <button className="outline-button" type="button" disabled={alertPage >= Math.max(1, Math.ceil(alertsTotal / 50)) || busy} onClick={() => void loadAlerts(undefined, alertPage + 1)}>Suivant</button>
          </div>
        </div>}
      </section>
      <section className="admin-collab-note">
        <AlertTriangle size={18} />
        <p>La réactivation exige également un motif côté serveur. Les choix de réattribution proviennent de la liste paginée d’agents actifs, contrôlée et auditée par l’API.</p>
      </section>
      {error && <p className="admin-collab-error" role="alert">{error}</p>}
    </div>
  )
}

function AgentStatusCard({ agent, onSuccess }: { agent: AdminCollaborationTrustAgent; onSuccess: () => void }) {
  const [targetStatus, setTargetStatus] = useState<'ACTIF' | 'SUSPENDU' | null>(null)
  const [reason, setReason] = useState('')
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const isSuspended = agent.status === 'SUSPENDU'

  async function prepare(target: 'ACTIF' | 'SUSPENDU') {
    if (lock.current) return
    const cleanReason = reason.trim()
    if (cleanReason.length < 10) { setError('Un motif d’au moins 10 caractères est obligatoire.'); return }
    const ok = await confirmAction({
      title: target === 'SUSPENDU' ? 'Confirmer la suspension' : 'Confirmer la réactivation',
      message: `Agent : ${agent.name} (#${agent.id})\nAction : ${target === 'SUSPENDU' ? 'suspension' : 'réactivation'}\nMotif : ${cleanReason}\nCette action modifie immédiatement l’accès de l’agent.`,
      confirmLabel: 'Confirmer le récapitulatif',
      destructive: target === 'SUSPENDU',
    })
    if (ok) { setTargetStatus(target); setTotp(''); setError('') }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!targetStatus || lock.current) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) { setError('Saisissez le code administrateur à 6 chiffres.'); return }
    lock.current = true
    setTotp('')
    setBusy(true)
    setError('')
    try {
      await api.updateAdminAgentStatus(agent.id, code, targetStatus, reason.trim())
      onSuccess()
    } catch (caught) { setError(errorMessage(caught)) }
    finally { lock.current = false; setBusy(false) }
  }

  return (
    <article className={`admin-collab-agent-card ${agent.suspensionProposed ? 'is-priority' : ''}`}>
      <div className="admin-collab-agent-card-summary">
        <strong>{agent.name}</strong><span>Agent #{agent.id} · {agent.status === 'ACTIF' ? 'Actif' : agent.status === 'SUSPENDU' ? 'Suspendu' : agent.status}</span>
        <span>Score : {agent.trustScore ? `${agent.trustScore.score} % · calculé le ${formatDate(agent.trustScore.calculatedAt)}` : 'Non calculé'}</span>
        {agent.suspensionProposed && <p className="admin-collab-override"><AlertTriangle size={18} />Suspension proposée par le système. Aucune action automatique n’a été exécutée.</p>}
      </div>
      {!targetStatus ? (
        <>
          <label>Motif obligatoire<textarea rows={2} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Expliquez la suspension ou la réactivation…" /></label>
          <button className={isSuspended ? 'outline-button' : 'admin-collab-reject-button'} type="button" onClick={() => void prepare(isSuspended ? 'ACTIF' : 'SUSPENDU')}>{isSuspended ? 'Préparer la réactivation' : 'Préparer la suspension'}</button>
        </>
      ) : (
        <form className="admin-collab-totp-form" onSubmit={(event) => void submit(event)}>
          <div className="admin-collab-decision-summary"><strong>Récapitulatif prêt</strong><span>{targetStatus === 'SUSPENDU' ? 'Suspension' : 'Réactivation'} · {agent.name}</span><span>Motif : {reason.trim()}</span></div>
          <AdminTotpCodeField label="Code pour confirmer le changement" value={totp} onChange={setTotp} />
          <div className="admin-collab-inline-form">
            <button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}Confirmer</button>
            <button className="outline-button" type="button" disabled={busy} onClick={() => { setTargetStatus(null); setTotp('') }}>Annuler</button>
          </div>
        </form>
      )}
      {error && <p className="admin-collab-error" role="alert">{error}</p>}
    </article>
  )
}

function DisputeCommissionsPanel({ deals, onSuccess }: { deals: AdminCollaborationDealSummary[]; onSuccess: () => void }) {
  const [rows, setRows] = useState<AdminCollaborationCommission[]>([])
  const [totals, setTotals] = useState(0)
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set())
  const [holdCounts, setHoldCounts] = useState<Map<number, number>>(new Map())
  const [pageRows, setPageRows] = useState<Map<number, AdminCollaborationCommission[]>>(new Map())

  async function loadHolds(event?: FormEvent<HTMLFormElement>, nextPage = page) {
    event?.preventDefault()
    if (lock.current) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) { setError('Saisissez un code administrateur frais.'); return }
    lock.current = true
    setTotp('')
    setBusy(true)
    setError('')
    try {
      const result = await api.adminCollaborationCommissionsByStatus(code, 'ON_HOLD', nextPage, 100)
      setRows(result.data)
      setTotals(result.pagination.total)
      setPage(nextPage)
      const nextRowsByPage = new Map(pageRows)
      nextRowsByPage.set(nextPage, result.data)
      const nextHoldCounts = new Map<number, number>()
      for (const loadedRows of nextRowsByPage.values()) {
        for (const commission of loadedRows) nextHoldCounts.set(commission.dealId, (nextHoldCounts.get(commission.dealId) ?? 0) + 1)
      }
      setPageRows(nextRowsByPage)
      setHoldCounts(nextHoldCounts)
      setLoadedPages((current) => new Set(current).add(nextPage))
      setLoaded(true)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { lock.current = false; setBusy(false) }
  }

  const holdPages = Math.max(1, Math.ceil(totals / 100))
  const allHoldPagesLoaded = totals === 0 || loadedPages.size >= holdPages
  const visibleDeals = [...deals].sort((a, b) => Number(Boolean(b.disputeReason)) - Number(Boolean(a.disputeReason)) || a.id - b.id)
  return (
    <section className="admin-collab-panel">
      <div className="admin-collab-panel-heading"><div><AlertTriangle size={20} /><h2>Arbitrage des litiges</h2></div></div>
      <p className="admin-collab-muted">La liste /deals inclut les dossiers DISPUTED sans commission, mais n’offre pas de filtre de statut et doit être parcourue par pages. Les commissions sont rechargées séparément avant décision. Les décisions RELEASE, CANCEL et REASSIGN gardent leur motif obligatoire.</p>
      {visibleDeals.length === 0 ? <p className="admin-collab-muted">Aucun dossier DISPUTED sur cette page de /deals.</p> : (
        <div className="admin-collab-deal-list">
          {visibleDeals.map((deal) => {
            const count = holdCounts.get(deal.id) ?? 0
            return <DisputeResolutionCard key={deal.id} deal={deal} heldCount={count} stateKnown={loaded && allHoldPagesLoaded} onSuccess={onSuccess} />
          })}
        </div>
      )}
      <div className="admin-collab-panel-heading admin-collab-hold-heading"><div><CircleDot size={20} /><h2>Commissions ON_HOLD</h2></div><strong>{loaded ? `${totals} en attente de décision` : 'État non chargé'}</strong></div>
      {!loaded && <form className="admin-collab-totp-form" onSubmit={(event) => void loadHolds(event, page)}>
        <p>Rechargez l’état serveur avec TOTP. Les commissions sont triées par ancienneté · page {page}/{holdPages}.</p>
        <div className="admin-collab-inline-form">
          <AdminTotpCodeField id="admin-collab-dispute-load-totp" label="Code pour recharger l’état" value={totp} onChange={setTotp} />
          <button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Recharger l’état</button>
        </div>
      </form>}
      {loaded && rows.length === 0 && <p className="admin-collab-muted">Aucune commission ON_HOLD sur cette page.</p>}
      {loaded && rows.length > 0 && <div className="admin-collab-deal-list">
        {rows.map((commission) => <HeldCommissionCard key={commission.id} commission={commission} page={page} onSuccess={onSuccess} onReload={(nextPage) => { setLoadedPages(new Set()); setPageRows(new Map()); setHoldCounts(new Map()); setPage(nextPage); setLoaded(false); setTotp('') }} />)}
      </div>}
      {loaded && totals > 100 && <div className="admin-collab-pagination">
        <button type="button" className="outline-button" disabled={page <= 1 || busy} onClick={() => { setPage((value) => value - 1); setLoaded(false); setTotp(''); }}>Précédent</button>
        <span>Commissions · Page {page}/{holdPages} · pages rechargées {loadedPages.size}/{holdPages}</span>
        <button type="button" className="outline-button" disabled={page >= holdPages || busy} onClick={() => { setPage((value) => value + 1); setLoaded(false); setTotp(''); }}>Suivant</button>
      </div>}
      {loaded && <button className="admin-collab-refresh" type="button" onClick={() => { setLoadedPages(new Set()); setPageRows(new Map()); setHoldCounts(new Map()); setPage(1); setLoaded(false); setTotp(''); }}><RefreshCw size={17} />Recharger les commissions avant une décision</button>}
      {!allHoldPagesLoaded && loaded && <p className="admin-collab-note"><AlertTriangle size={18} /><span>Chargez toutes les pages ON_HOLD pour connaître le nombre exact par dossier; la résolution reste désactivée d’ici là.</span></p>}
      {error && <p className="admin-collab-error" role="alert">{error}</p>}
    </section>
  )
}

function DisputeResolutionCard({ deal, heldCount, stateKnown, onSuccess }: { deal: AdminCollaborationDealSummary; heldCount: number; stateKnown: boolean; onSuccess: () => void }) {
  const [reason, setReason] = useState('')
  const [refreshTotp, setRefreshTotp] = useState('')
  const [totp, setTotp] = useState('')
  const [review, setReview] = useState(false)
  const [stateRefreshed, setStateRefreshed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)

  async function prepare() {
    const clean = reason.trim()
    if (clean.length < 10) { setError('Un motif d’au moins 10 caractères est obligatoire.'); return }
    if (heldCount > 0) { setError(`${heldCount} commission(s) ON_HOLD doivent d’abord être traitées.`); return }
    if (!stateKnown) { setError('Rechargez toutes les pages de commissions avant de résoudre le litige.'); return }
    const ok = await confirmAction({
      title: 'Récapitulatif de résolution',
      message: `Dossier #${deal.id}\nCommissions ON_HOLD : ${heldCount}\nMotif : ${clean}\nRechargez et confirmez la résolution du litige.`,
      confirmLabel: 'Confirmer le récapitulatif',
      destructive: true,
    })
    if (ok) { setReview(true); setStateRefreshed(false); setRefreshTotp(''); setTotp(''); setError('') }
  }

  async function refreshBeforeResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || !review) return
    const code = refreshTotp.trim()
    if (!/^\d{6}$/.test(code)) { setError('Un code TOTP frais est requis pour recharger les commissions.'); return }
    lock.current = true
    setRefreshTotp('')
    setBusy(true)
    setError('')
    try {
      const current = await api.adminCollaborationCommissionsByStatus(code, 'ON_HOLD', 1, 100)
      if (current.pagination.total !== 0) {
        setError(`L’état a changé : ${current.pagination.total} commission(s) ON_HOLD restent à traiter. Rechargez la file des litiges.`)
        onSuccess()
        return
      }
      setStateRefreshed(true)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { lock.current = false; setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || !review || !stateRefreshed || heldCount > 0 || !stateKnown) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) { setError('Saisissez le code administrateur frais.'); return }
    lock.current = true
    setTotp('')
    setBusy(true)
    setError('')
    try { await api.resolveAdminCollaborationDispute(deal.id, code, reason.trim()); onSuccess() }
    catch (caught) { setError(errorMessage(caught)) }
    finally { lock.current = false; setBusy(false) }
  }

  return (
    <article className="admin-collab-dispute-card">
      <div><strong>Dossier #{deal.id}</strong><DealStatus status={deal.status} /><span>Commissions ON_HOLD : {stateKnown ? heldCount : 'recharger toutes les pages'}</span></div>
      {heldCount > 0 && <p className="admin-collab-note"><AlertTriangle size={18} /><span>Traitez d’abord les commissions ON_HOLD.</span></p>}
      {stateKnown && heldCount === 0 && !review && <p className="admin-collab-muted">Aucune commission ON_HOLD. Le serveur déterminera l’état final selon les décisions prises; un dossier sans commission peut rester non résolvable par la route actuelle.</p>}
      {!review ? <>
        <label>Motif de résolution obligatoire<textarea rows={2} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button className="primary-button" type="button" disabled={!canResolveAdminDispute(stateKnown, heldCount)} onClick={() => void prepare()}>Résoudre le litige</button>
      </> : !stateRefreshed ? <form className="admin-collab-totp-form" onSubmit={(event) => void refreshBeforeResolution(event)}>
        <div className="admin-collab-decision-summary"><strong>Confirmation irréversible</strong><span>Dossier #{deal.id} · {heldCount} commission ON_HOLD</span><span>Motif : {reason.trim()}</span></div>
        <p>Un nouveau TOTP recharge les commissions juste avant la décision.</p>
        <AdminTotpCodeField label="Code pour recharger l’état" value={refreshTotp} onChange={setRefreshTotp} />
        <div className="admin-collab-inline-form"><button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Recharger l’état serveur</button><button type="button" className="outline-button" disabled={busy} onClick={() => { setReview(false); setRefreshTotp('') }}>Annuler</button></div>
      </form> : <form className="admin-collab-totp-form" onSubmit={(event) => void submit(event)}>
        <div className="admin-collab-decision-summary"><strong>État rechargé : aucune commission ON_HOLD</strong><span>Dossier #{deal.id} · Motif : {reason.trim()}</span></div>
        <AdminTotpCodeField label="Code pour confirmer la résolution" value={totp} onChange={setTotp} />
        <div className="admin-collab-inline-form"><button className="primary-button" type="submit" disabled={busy || heldCount > 0}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}Confirmer la résolution</button><button type="button" className="outline-button" disabled={busy} onClick={() => { setReview(false); setStateRefreshed(false); setTotp('') }}>Annuler</button></div>
      </form>}
      {error && <p className="admin-collab-error" role="alert">{error}</p>}
    </article>
  )
}

function HeldCommissionCard({ commission, page, onSuccess, onReload }: { commission: AdminCollaborationCommission; page: number; onSuccess: () => void; onReload: (page: number) => void }) {
  const [decision, setDecision] = useState<'RELEASE' | 'CANCEL' | 'REASSIGN' | null>(null)
  const [reason, setReason] = useState('')
  const [targetAgentId, setTargetAgentId] = useState('')
  const [activeAgents, setActiveAgents] = useState<Array<{ id: number; name: string }>>([])
  const [activeAgentsPage, setActiveAgentsPage] = useState(1)
  const [activeAgentsTotal, setActiveAgentsTotal] = useState(0)
  const [activeAgentsLoaded, setActiveAgentsLoaded] = useState(false)
  const [activeAgentsTotp, setActiveAgentsTotp] = useState('')
  const [refreshTotp, setRefreshTotp] = useState('')
  const [totp, setTotp] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)

  async function refreshBeforeDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!decision || lock.current) return
    const cleanReason = reason.trim()
    const code = refreshTotp.trim()
    if (cleanReason.length < 10) { setError('Un motif d’au moins 10 caractères est obligatoire.'); return }
    if (decision === 'REASSIGN' && (!/^\d+$/.test(targetAgentId) || Number(targetAgentId) < 1 || Number(targetAgentId) === commission.agentId)) {
      setError('Choisissez un autre agent actif.'); return
    }
    if (decision === 'REASSIGN' && (!activeAgentsLoaded || !activeAgents.some((agent) => agent.id === Number(targetAgentId)))) {
      setError('Chargez la page de l’agent actif choisi avant de poursuivre.'); return
    }
    if (!/^\d{6}$/.test(code)) { setError('Un code TOTP frais est requis pour recharger l’état.'); return }
    const ok = await confirmAction({
      title: decision === 'CANCEL' ? 'Annulation irréversible' : 'Récapitulatif de décision',
      message: [
        `Commission #${commission.id} · dossier #${commission.dealId}`,
        `Agent actuel : ${commission.agent.name} (#${commission.agentId})`,
        decision === 'REASSIGN' ? `Nouvel agent : ${activeAgents.find((agent) => agent.id === Number(targetAgentId))?.name ?? `#${targetAgentId}`}` : `Décision : ${decision === 'RELEASE' ? 'libérer' : 'annuler'}`,
        `Motif : ${cleanReason}`,
        decision === 'CANCEL' ? 'Cette commission sera annulée de manière irréversible.' : '',
      ].filter(Boolean).join('\n'),
      confirmLabel: 'Confirmer le récapitulatif et recharger',
      destructive: decision === 'CANCEL',
    })
    if (!ok) return
    lock.current = true
    setRefreshTotp('')
    setBusy(true)
    setError('')
    try {
      const current = await api.adminCollaborationCommissionsByStatus(code, 'ON_HOLD', page, 100)
      if (!current.data.some((item) => item.id === commission.id && item.status === 'ON_HOLD')) {
        throw new ApiRequestError('Cette commission a changé depuis le chargement. Actualisez la file.', 409)
      }
      setConfirmed(true)
      setTotp('')
    } catch (caught) { setError(errorMessage(caught)) }
    finally { lock.current = false; setBusy(false) }
  }

  async function loadActiveAgents(event?: FormEvent<HTMLFormElement>, nextPage = activeAgentsPage) {
    event?.preventDefault()
    if (lock.current) return
    const code = activeAgentsTotp.trim()
    if (!/^\d{6}$/.test(code)) { setError('Un code TOTP frais est requis pour charger les agents actifs.'); return }
    lock.current = true
    setActiveAgentsTotp('')
    setBusy(true)
    setError('')
    try {
      const result = await api.adminCollaborationActiveAgents(code, nextPage, 50)
      setActiveAgents(result.data)
      setActiveAgentsPage(nextPage)
      setActiveAgentsTotal(result.pagination.total)
      setActiveAgentsLoaded(true)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { lock.current = false; setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!decision || !confirmed || lock.current) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) { setError('Saisissez un code TOTP frais pour cette action.'); return }
    lock.current = true
    setTotp('')
    setBusy(true)
    setError('')
    try {
      await api.decideAdminCollaborationCommission(commission.id, code, {
        action: decision,
        reason: reason.trim(),
        ...(decision === 'REASSIGN' ? { targetAgentId: Number(targetAgentId) } : {}),
      })
      onSuccess()
    } catch (caught) { setError(errorMessage(caught)) }
    finally { lock.current = false; setBusy(false) }
  }

  return (
    <article className="admin-collab-deal-card admin-collab-action-card">
      <div className="admin-collab-deal-card-main"><strong>Commission #{commission.id} · dossier #{commission.dealId}</strong><span>{commission.agent.name} · {commission.role}</span><span>{commission.amount} {commission.currency} · générée le {formatDate(commission.generatedAt)}</span><DealStatus status={commission.status} /></div>
      {!decision ? <div className="admin-collab-inline-form">
        <button className="outline-button" type="button" onClick={() => setDecision('RELEASE')}>Libérer</button>
        <button className="outline-button" type="button" onClick={() => { setDecision('REASSIGN'); setActiveAgentsLoaded(false); setActiveAgentsPage(1); setActiveAgentsTotp('') }}>Réattribuer</button>
        <button className="admin-collab-reject-button" type="button" onClick={() => setDecision('CANCEL')}>Annuler</button>
      </div> : !confirmed ? (
        <form className="admin-collab-totp-form" onSubmit={(event) => void refreshBeforeDecision(event)}>
          {decision === 'REASSIGN' && <>
            {!activeAgentsLoaded ? (
              <div className="admin-collab-totp-form">
                <p>Choisissez parmi les agents actifs. Page {activeAgentsPage}/{Math.max(1, Math.ceil(activeAgentsTotal / 50))}.</p>
                <AdminTotpCodeField label="Code pour charger les agents" value={activeAgentsTotp} onChange={setActiveAgentsTotp} />
                <button className="outline-button" type="button" disabled={busy} onClick={() => void loadActiveAgents(undefined, activeAgentsPage)}>{busy ? <LoaderCircle className="spin" size={18} /> : <Users size={18} />}Charger les agents actifs</button>
              </div>
            ) : <>
              <label>Nouvel agent actif<select value={targetAgentId} onChange={(event) => setTargetAgentId(event.target.value)}>
                <option value="">Choisir un agent</option>
                {activeAgents.filter((agent) => agent.id !== commission.agentId).map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · #{agent.id}</option>)}
              </select></label>
              <div className="admin-collab-pagination">
                <button type="button" className="outline-button" disabled={activeAgentsPage <= 1 || busy} onClick={() => { setActiveAgentsPage((value) => value - 1); setActiveAgentsLoaded(false); setTargetAgentId(''); setActiveAgentsTotp(''); }}>Page précédente</button>
                <span>{activeAgentsTotal} agent{activeAgentsTotal === 1 ? '' : 's'} · {activeAgentsPage}/{Math.max(1, Math.ceil(activeAgentsTotal / 50))}</span>
                <button type="button" className="outline-button" disabled={activeAgentsPage >= Math.max(1, Math.ceil(activeAgentsTotal / 50)) || busy} onClick={() => { setActiveAgentsPage((value) => value + 1); setActiveAgentsLoaded(false); setTargetAgentId(''); setActiveAgentsTotp(''); }}>Page suivante</button>
              </div>
            </>}
          </>}
          <label>Motif obligatoire<textarea rows={2} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <AdminTotpCodeField label="Code pour recharger l’état" value={refreshTotp} onChange={setRefreshTotp} />
          <div className="admin-collab-inline-form"><button className="primary-button" type="submit" disabled={busy || (decision === 'REASSIGN' && !activeAgentsLoaded)}>{busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Récapitulatif et rechargement</button><button type="button" className="outline-button" disabled={busy} onClick={() => setDecision(null)}>Annuler</button></div>
        </form>
      ) : <form className="admin-collab-totp-form" onSubmit={(event) => void submit(event)}>
        <div className="admin-collab-decision-summary"><strong>État rechargé : ON_HOLD</strong><span>Agent actuel : {commission.agent.name} (#{commission.agentId})</span>{decision === 'REASSIGN' && <span>Nouvel agent : {activeAgents.find((agent) => agent.id === Number(targetAgentId))?.name ?? 'Agent'} (#{targetAgentId})</span>}<span>Motif : {reason.trim()}</span>{decision === 'CANCEL' && <span>Annulation irréversible.</span>}</div>
        <AdminTotpCodeField label="Code pour confirmer la décision" value={totp} onChange={setTotp} />
        <div className="admin-collab-inline-form"><button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}Enregistrer la décision</button><button type="button" className="outline-button" disabled={busy} onClick={() => { setConfirmed(false); setTotp(''); onReload(page) }}>Recharger l’état</button></div>
      </form>}
      {error && <p className="admin-collab-error" role="alert">{error}</p>}
    </article>
  )
}
