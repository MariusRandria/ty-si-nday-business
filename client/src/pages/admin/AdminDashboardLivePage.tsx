import { useEffect, useState } from 'react'
import api, { type AdminDashboardData } from '../../api/client'
import type { View } from '../../types/report'

type AdminView = Extract<View, 'admin-applications' | 'admin-reports' | 'admin-withdrawals' | 'admin-products'>

export default function AdminDashboardLivePage({ onNavigate }: { onNavigate: (view: AdminView) => void }) {
  const [stats, setStats] = useState<AdminDashboardData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api.adminDashboard()
      .then((data) => { if (active) { setStats(data); setError('') } })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger le tableau de bord.') })
    return () => { active = false }
  }, [])

  const pendingTotal = stats ? stats.pendingApplications + stats.pendingReports + stats.pendingWithdrawals : null
  const currency = stats ? new Intl.NumberFormat('fr-FR').format(stats.totalPaid) : '—'

  return <>
    <section className="welcome-row"><div><p className="eyebrow">ESPACE ADMINISTRATEUR · {new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' })}</p><h1>Bonjour, équipe InnovCom <span>✦</span></h1><p className="intro">Vue en temps réel des candidatures, rapports et retraits.</p></div></section>
    {error && <div className="settings-error" role="alert">{error}</div>}
    <section className="metric-grid">
      <Metric label="Candidatures à examiner" value={stats?.pendingApplications ?? '—'} action="Voir les candidatures" onClick={() => onNavigate('admin-applications')} />
      <Metric label="Rapports à traiter" value={stats?.pendingReports ?? '—'} action="Ouvrir la file" onClick={() => onNavigate('admin-reports')} />
      <Metric label="Retraits en attente" value={stats?.pendingWithdrawals ?? '—'} action="Traiter les retraits" onClick={() => onNavigate('admin-withdrawals')} />
      <Metric label="Agents actifs" value={stats?.activeAgents ?? '—'} action="Agents validés" />
    </section>
    <div className="admin-grid">
      <section className="panel attention-panel"><div className="panel-heading"><div><span className="section-kicker">À TRAITER</span><h2>Files de travail</h2></div><span className="priority-count">{pendingTotal ?? '—'}</span></div>
        {stats ? <>
          <Priority label="Rapports soumis ou en vérification" count={stats.pendingReports} tone="blue" onClick={() => onNavigate('admin-reports')} />
          <Priority label="Candidatures reçues" count={stats.pendingApplications} tone="yellow" onClick={() => onNavigate('admin-applications')} />
          <Priority label="Demandes de retrait" count={stats.pendingWithdrawals} tone="coral" onClick={() => onNavigate('admin-withdrawals')} />
        </> : <p className="admin-dashboard-state">{error || 'Chargement des files...'}</p>}
      </section>
      <section className="panel admin-summary"><span className="section-kicker">PAIEMENTS CONFIRMÉS</span><h2>Total payé aux agents</h2><strong>{currency} <small>Ar</small></strong><p>{stats ? `${stats.activeAgents} agent${stats.activeAgents === 1 ? '' : 's'} actif${stats.activeAgents === 1 ? '' : 's'}` : 'Calcul à partir des retraits payés'}</p><div className="admin-summary-actions"><button className="outline-button" onClick={() => onNavigate('admin-withdrawals')}>Voir les retraits</button><button className="outline-button" onClick={() => onNavigate('admin-products')}>Gérer le catalogue</button></div></section>
    </div>
    <section className="panel admin-activity-panel"><div className="panel-heading"><div><span className="section-kicker">ACTIVITÉ RÉCENTE</span><h2>Dernières opérations</h2></div></div>
      {!stats ? <p className="admin-dashboard-state">{error || 'Chargement de l’activité...'}</p> : stats.recentActivity.length === 0 ? <p className="admin-dashboard-state">Aucune opération enregistrée pour le moment.</p> : <div className="admin-activity-list">{stats.recentActivity.map((item) => <button key={item.id} className="admin-activity-row" onClick={() => onNavigate(item.view as AdminView)}><span className={`activity-kind ${item.kind.toLowerCase()}`}>{item.kind}</span><span className="activity-copy"><strong>{item.title}</strong><small>{item.detail} · {item.status.toLowerCase()}</small></span><time>{new Date(item.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</time><b aria-hidden="true">→</b></button>)}</div>}
    </section>
  </>
}

function Metric({ label, value, action, onClick }: { label: string; value: number | string; action: string; onClick?: () => void }) {
  return <article className="metric admin-metric"><span className="metric-label">{label}</span><div className="metric-value"><strong>{value}</strong></div><button className="text-button" onClick={onClick}>{action} <span>→</span></button></article>
}

function Priority({ label, count, tone, onClick }: { label: string; count: number; tone: string; onClick: () => void }) {
  return <button className="priority-row" onClick={onClick}><i className={tone} /><span>{label}</span><b>{count}</b><em>→</em></button>
}