import { useEffect, useState } from 'react'
import api, { type CommunityContentReport } from '../../api/client'
import { notify } from '../../utils/toast'

export default function AdminCommunityPage() {
  const [reports, setReports] = useState<CommunityContentReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  async function refresh() {
    setError('')
    try { setReports(await api.adminCommunityReports()) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de charger les signalements.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    let active = true
    api.adminCommunityReports()
      .then((data) => { if (active) setReports(data) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger les signalements.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function moderate(report: CommunityContentReport, action: 'HIDE' | 'DISMISS') {
    setBusyId(report.id)
    setError('')
    try {
      await api.moderateCommunityReport(report.id, action)
      setReports((current) => current.filter((item) => item.id !== report.id))
      notify(action === 'HIDE' ? 'Contenu masqué et signalement traité.' : 'Signalement classé sans suite.', 'success')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Impossible de traiter le signalement.'
      setError(message)
      notify(message, 'error')
    } finally { setBusyId(null) }
  }

  return <>
    <section className="page-heading"><div><p className="eyebrow">MODÉRATION DU FORUM</p><h1>Signalements</h1><p className="intro">Examinez les contenus signalés par les agents.</p></div><button className="outline-button" onClick={() => { setLoading(true); void refresh() }}>Actualiser</button></section>
    {error && <div className="settings-error" role="alert">{error}</div>}
    {loading ? <section className="panel empty-state">Chargement des signalements...</section> : reports.length === 0 ? <section className="panel empty-state">Aucun signalement en attente.</section> : <section className="community-moderation-list">{reports.map((report) => {
      const comment = report.targetType === 'COMMENT'
      const content = report.target?.content ?? 'Le contenu signalé est introuvable ou déjà supprimé.'
      return <article className="panel community-moderation-item" key={report.id}>
        <div><span className="section-kicker">{comment ? 'COMMENTAIRE' : 'PUBLICATION'} · {new Date(report.createdAt).toLocaleString('fr-FR')}</span><h2>{comment ? report.target?.post?.title ?? 'Commentaire' : report.target?.title ?? 'Publication'}</h2><blockquote>{content}</blockquote><p><strong>Motif :</strong> {report.reason}</p><small>Signalé par {report.reporter.email}</small></div>
        <div className="action-group"><button className="reject-button" disabled={busyId === report.id} onClick={() => void moderate(report, 'HIDE')}>{busyId === report.id ? 'Traitement...' : 'Masquer le contenu'}</button><button className="outline-button compact" disabled={busyId === report.id} onClick={() => void moderate(report, 'DISMISS')}>Classer sans suite</button></div>
      </article>
    })}</section>}
  </>
}
