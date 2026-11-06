import { useEffect, useState } from 'react'
import api, { type AdminApplication } from '../../api/client'
import { notify } from '../../utils/toast'
import { confirmAction } from '../../utils/confirmation'
import { LoadingState } from '../../components/ui/LoadingState'

export default function AdminApplicationsPage() {
  const [items, setItems] = useState<AdminApplication[]>([])
  const [filter, setFilter] = useState('TOUS')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)

  useEffect(() => {
    api.adminApplications().then(setItems).catch((caught) => {
      const message = caught instanceof Error ? caught.message : 'Impossible de charger les inscriptions.'
      setError(message)
      notify(message, 'error')
    }).finally(() => setLoading(false))
  }, [])

  async function decide(item: AdminApplication, status: string) {
    if (status === 'REFUSEE') {
      const confirmed = await confirmAction({
        title: 'Refuser cette candidature ?',
        message: `La candidature de ${item.fullName} sera refusée. Cette action mettra fin à son examen.`,
        confirmLabel: 'Refuser la candidature',
        destructive: true,
      })
      if (!confirmed) return
    }
    const actionId = `${item.id}:${status}`
    setBusyAction(actionId)
    try {
      const result = await api.updateApplication(item.id, status, status === 'REFUSEE' ? 'Profil ne correspondant pas aux critères actuels.' : undefined)
      setItems((current) => current.map((entry) => entry.id === item.id ? {
        ...entry,
        status,
        userId: result.data?.userId ?? entry.userId,
        userStatus: result.data?.userStatus ?? entry.userStatus,
      } : entry))
      notify(status === 'ACCEPTEE' ? result.message ?? 'Candidature acceptée. Un email de confirmation a été envoyé.' : 'Inscription refusée.', status === 'ACCEPTEE' ? 'success' : 'info')
    } catch (caught) {
      if (status === 'ACCEPTEE') {
        try {
          setItems(await api.adminApplications())
        } catch {
          notify('La candidature a peut-être été acceptée, mais la liste n’a pas pu être actualisée. Rechargez la page pour vérifier son statut.', 'error')
        }
      }
      notify(caught instanceof Error ? caught.message : 'Impossible de traiter cette inscription.', 'error')
    } finally { setBusyAction(null) }
  }

  async function resendApprovalEmail(item: AdminApplication) {
    const actionId = `${item.id}:RESEND_EMAIL`
    setBusyAction(actionId)
    try {
      notify(await api.resendApplicationApprovalEmail(item.id), 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Impossible de renvoyer l’email de confirmation.', 'error')
    } finally { setBusyAction(null) }
  }

  async function toggleAgentAccount(item: AdminApplication, nextStatus: 'ACTIF' | 'SUSPENDU') {
    if (!item.userId) return
    if (nextStatus === 'SUSPENDU') {
      const confirmed = await confirmAction({
        title: 'Suspendre ce compte agent ?',
        message: `${item.fullName} ne pourra plus se connecter tant que son compte restera suspendu.`,
        confirmLabel: 'Suspendre le compte',
        destructive: true,
      })
      if (!confirmed) return
    }
    const actionId = `${item.id}:${nextStatus}`
    setBusyAction(actionId)
    try {
      const updated = await api.updateAgentStatus(item.userId, nextStatus)
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, userStatus: updated.status } : entry))
      notify(nextStatus === 'SUSPENDU' ? 'Compte agent suspendu. Il ne peut plus se connecter.' : 'Compte agent réactivé. Il peut de nouveau se connecter.', 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Impossible de modifier le statut de ce compte.', 'error')
    } finally { setBusyAction(null) }
  }

  const visible = filter === 'TOUS' ? items : items.filter((item) => item.status === filter)

  return <><section className="page-heading"><div><p className="eyebrow">RECRUTEMENT DU RÉSEAU</p><h1>Validation des inscriptions</h1><p className="intro">Examinez, acceptez ou refusez les agents qui souhaitent rejoindre Ty sy Nday Business.</p></div><button className="outline-button">↓ Exporter</button></section><div className="filter-row"><button className={`filter ${filter === 'TOUS' ? 'active' : ''}`} onClick={() => setFilter('TOUS')}>Toutes <b>{items.length}</b></button><button className={`filter ${filter === 'RECUE' ? 'active' : ''}`} onClick={() => setFilter('RECUE')}>Reçues <b>{items.filter((item) => item.status === 'RECUE').length}</b></button><button className={`filter ${filter === 'EN_EXAMEN' ? 'active' : ''}`} onClick={() => setFilter('EN_EXAMEN')}>En examen <b>{items.filter((item) => item.status === 'EN_EXAMEN').length}</b></button><button className={`filter ${filter === 'ACCEPTEE' ? 'active' : ''}`} onClick={() => setFilter('ACCEPTEE')}>Acceptées <b>{items.filter((item) => item.status === 'ACCEPTEE').length}</b></button></div>{loading && <section className="panel"><LoadingState label="Chargement des candidatures…" /></section>}{error && <section className="panel empty-state error-state">{error}<button className="outline-button" onClick={() => window.location.reload()}>Recharger</button></section>}{!loading && !error && visible.length === 0 && <section className="panel empty-state">Aucune inscription dans cette catégorie.</section>}{!loading && !error && visible.length > 0 && <section className="panel admin-table-panel"><table><thead><tr><th>CANDIDAT</th><th>VILLE</th><th>CONTACT</th><th>STATUT</th><th>ACTION</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td><div className="company"><span>{item.fullName.slice(0, 1)}</span><strong>{item.fullName}</strong></div><small className="table-subtext">{item.motivation}</small></td><td>{item.city}</td><td>{item.email}<br />{item.phone}</td><td><span className={`status ${item.status.toLowerCase()}`}>{item.status.replace('_', ' ').toLowerCase()}</span>{item.userId && <><br /><small className={`status ${String(item.userStatus ?? 'ACTIF').toLowerCase()}`}>{item.userStatus === 'SUSPENDU' ? 'Compte suspendu' : item.userStatus === 'EN_ATTENTE_ACTIVATION' ? 'Activation en attente' : 'Compte actif'}</small></>}</td><td><div className="action-group">{!['ACCEPTEE', 'REFUSEE'].includes(item.status) && <><button className="approve-button" disabled={busyAction !== null} onClick={() => void decide(item, 'ACCEPTEE')}>{busyAction === `${item.id}:ACCEPTEE` ? 'Acceptation…' : 'Accepter'}</button><button className="reject-button" disabled={busyAction !== null} onClick={() => void decide(item, 'REFUSEE')}>{busyAction === `${item.id}:REFUSEE` ? 'Refus…' : 'Refuser'}</button></>}{item.status === 'ACCEPTEE' && item.userId && <><button disabled={busyAction !== null} className="outline-button compact" onClick={() => void resendApprovalEmail(item)}>{busyAction === `${item.id}:RESEND_EMAIL` ? 'Envoi…' : 'Renvoyer l’email'}</button><button disabled={busyAction !== null} className={item.userStatus === 'SUSPENDU' ? 'approve-button' : 'reject-button'} onClick={() => void toggleAgentAccount(item, item.userStatus === 'SUSPENDU' ? 'ACTIF' : 'SUSPENDU')}>{busyAction === `${item.id}:${item.userStatus === 'SUSPENDU' ? 'ACTIF' : 'SUSPENDU'}` ? 'Mise à jour…' : item.userStatus === 'SUSPENDU' ? 'Réactiver' : 'Suspendre'}</button></>}</div></td></tr>)}</tbody></table></section>}</>
}
