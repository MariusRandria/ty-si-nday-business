import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ImagePlus, Megaphone, Plus, Search, Send, Video, X } from 'lucide-react'
import api, { type CommunityContentReport, type CommunityPost } from '../../api/client'
import { Modal } from '../../components/ui/Modal'
import { CommunityOfficialBadge } from '../../components/ui/CommunityOfficialBadge'
import { notify } from '../../utils/toast'

type AdminCommunityTab = 'posts' | 'reports'
type PostCategory = 'Discussion' | 'Question' | 'Astuce'
type PostAuthorFilter = 'ALL' | 'ADMIN' | 'AGENT'
type PostMediaFilter = 'ALL' | 'TEXT' | 'IMAGE' | 'VIDEO'
type PostSort = 'RECENT' | 'OLDEST' | 'POPULAR'
type ReportTypeFilter = 'ALL' | 'POST' | 'COMMENT'

function isVideo(url: string) {
  return /\.(mp4|webm)(?:$|[?#])/i.test(url)
}

function normalizeSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr')
}

function authorName(post: CommunityPost) {
  if (post.author.role === 'ADMIN' || post.author.role === 'SUPER_ADMIN') return 'TY SY NDAY'
  const profile = post.author.agentProfile
  return profile ? `${profile.firstName} ${profile.lastName}` : `Agent #${post.author.id}`
}

export default function AdminCommunityPage() {
  const [tab, setTab] = useState<AdminCommunityTab>('posts')
  const [postSearch, setPostSearch] = useState('')
  const [postCategoryFilter, setPostCategoryFilter] = useState('ALL')
  const [postAuthorFilter, setPostAuthorFilter] = useState<PostAuthorFilter>('ALL')
  const [postMediaFilter, setPostMediaFilter] = useState<PostMediaFilter>('ALL')
  const [postSort, setPostSort] = useState<PostSort>('RECENT')
  const [reportSearch, setReportSearch] = useState('')
  const [reportTypeFilter, setReportTypeFilter] = useState<ReportTypeFilter>('ALL')
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [reports, setReports] = useState<CommunityContentReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [publishError, setPublishError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<PostCategory>('Discussion')
  const [media, setMedia] = useState<File | null>(null)
  const [mediaPreview, setMediaPreview] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [publishing, setPublishing] = useState(false)
  const mediaInput = useRef<HTMLInputElement>(null)
  const mediaPreviewUrl = useRef<string | null>(null)

  async function refresh() {
    setError('')
    try {
      const [nextPosts, nextReports] = await Promise.all([api.adminCommunityPosts(), api.adminCommunityReports()])
      setPosts(nextPosts)
      setReports(nextReports)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de charger la communauté.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([api.adminCommunityPosts(), api.adminCommunityReports()])
      .then(([nextPosts, nextReports]) => {
        if (active) {
          setPosts(nextPosts)
          setReports(nextReports)
        }
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger la communauté.') })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      if (mediaPreviewUrl.current) URL.revokeObjectURL(mediaPreviewUrl.current)
    }
  }, [])

  function setSelectedMedia(file: File | null) {
    if (mediaPreviewUrl.current) URL.revokeObjectURL(mediaPreviewUrl.current)
    mediaPreviewUrl.current = file ? URL.createObjectURL(file) : null
    setMediaPreview(mediaPreviewUrl.current ?? '')
    setMedia(file)
  }

  function openComposer() {
    setPublishError('')
    setComposerOpen(true)
  }

  function closeComposer() {
    if (!publishing) setComposerOpen(false)
  }

  function selectMedia(file?: File) {
    if (!file) return
    const image = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    const video = ['video/mp4', 'video/webm'].includes(file.type)
    if (!image && !video) {
      setSelectedMedia(null)
      setMediaError('Formats acceptés : image JPEG, PNG, WebP ou vidéo MP4/WebM.')
      return
    }
    if (image && file.size > 5 * 1024 * 1024) {
      setSelectedMedia(null)
      setMediaError('Une image ne doit pas dépasser 5 Mo.')
      return
    }
    if (video && file.size > 50 * 1024 * 1024) {
      setSelectedMedia(null)
      setMediaError('Une vidéo ne doit pas dépasser 50 Mo.')
      return
    }
    setMediaError('')
    setSelectedMedia(file)
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPublishing(true)
    setPublishError('')
    try {
      const post = await api.createAdminCommunityPost({ title, content, category }, media)
      setPosts((current) => [post, ...current])
      setTitle('')
      setContent('')
      setCategory('Discussion')
      setSelectedMedia(null)
      setMediaError('')
      setComposerOpen(false)
      notify('La publication de l’administration est en ligne.', 'success')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Impossible de publier le contenu.'
      setPublishError(message)
      notify(message, 'error')
    } finally {
      setPublishing(false)
    }
  }

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

  const filteredPosts = posts.filter((post) => {
    const query = normalizeSearchText(postSearch.trim())
    const searchable = normalizeSearchText([
      post.title,
      post.content,
      post.category.name,
      authorName(post),
      ...post.comments.flatMap((comment) => [comment.content, comment.author.agentProfile?.firstName ?? '', comment.author.agentProfile?.lastName ?? '']),
    ].join(' '))
    const isAdminPost = post.author.role === 'ADMIN' || post.author.role === 'SUPER_ADMIN'
    const mediaMatches = postMediaFilter === 'ALL'
      || (postMediaFilter === 'TEXT' && !post.imageUrl)
      || (postMediaFilter === 'VIDEO' && Boolean(post.imageUrl && isVideo(post.imageUrl)))
      || (postMediaFilter === 'IMAGE' && Boolean(post.imageUrl && !isVideo(post.imageUrl)))
    return (!query || query.split(/\s+/).every((term) => searchable.includes(term)))
      && (postCategoryFilter === 'ALL' || post.category.name.toLocaleLowerCase('fr') === postCategoryFilter.toLocaleLowerCase('fr'))
      && (postAuthorFilter === 'ALL' || (postAuthorFilter === 'ADMIN' ? isAdminPost : !isAdminPost))
      && mediaMatches
  }).sort((left, right) => {
    if (postSort === 'POPULAR') return right.likesCount - left.likesCount || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return postSort === 'OLDEST'
      ? Date.parse(left.createdAt) - Date.parse(right.createdAt)
      : Date.parse(right.createdAt) - Date.parse(left.createdAt)
  })

  const filteredReports = reports.filter((report) => {
    const query = normalizeSearchText(reportSearch.trim())
    const searchable = normalizeSearchText([
      report.reason,
      report.reporter.email,
      report.target?.title ?? '',
      report.target?.content ?? '',
      report.target?.post?.title ?? '',
    ].join(' '))
    return (!query || query.split(/\s+/).every((term) => searchable.includes(term)))
      && (reportTypeFilter === 'ALL' || report.targetType === reportTypeFilter)
  })

  return <>
    <section className="page-heading admin-community-heading">
      <div><p className="eyebrow"><Megaphone size={15} aria-hidden="true" /> ESPACE COMMUNAUTAIRE</p><h1>Actualités de la communauté</h1><p className="intro">Consultez les publications des agents, partagez les actualités officielles et traitez les signalements.</p></div>
      <button className="outline-button" type="button" onClick={() => { setLoading(true); void refresh() }}>Actualiser</button>
    </section>
    <nav className="admin-community-tabs" aria-label="Sections de la communauté">
      <button type="button" className={tab === 'posts' ? 'active' : ''} onClick={() => setTab('posts')}>Publications <span>{posts.length}</span></button>
      <button type="button" className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>Signalements <span>{reports.length}</span></button>
    </nav>
    {error && <div className="settings-error" role="alert">{error}</div>}
    {tab === 'posts' && <>
      <section className="panel admin-community-publish">
        <div className="admin-community-publish-copy"><span className="admin-community-publish-icon"><Megaphone size={20} aria-hidden="true" /></span><div><p className="section-kicker">COMMUNIQUÉ OFFICIEL</p><h2>Partager une actualité</h2><p>Votre publication sera mise en avant dans le fil des agents avec le badge officiel.</p></div></div>
        <button className="primary-button" type="button" onClick={openComposer}><Plus size={17} /> Nouvelle publication</button>
      </section>
      <Modal
        open={composerOpen}
        className="admin-community-dialog"
        title="Nouvelle publication"
        onClose={closeComposer}
        footer={<div className="admin-community-modal-footer">
          <small>Visible par les agents · Images 5 Mo max. · Vidéos 50 Mo max.</small>
          <div><button type="button" className="outline-button" onClick={closeComposer} disabled={publishing}>Annuler</button><button type="submit" form="admin-community-publish-form" className="primary-button" disabled={publishing || !title.trim() || !content.trim()}><Send size={16} />{publishing ? 'Publication…' : 'Publier'}</button></div>
        </div>}
      >
        <div className="admin-community-modal-intro"><span className="admin-community-modal-icon"><Megaphone size={19} aria-hidden="true" /></span><div><p className="section-kicker">COMMUNIQUÉ OFFICIEL · TY SY NDAY</p><p>Partagez une information importante avec les agents de la communauté.</p></div></div>
        <form id="admin-community-publish-form" className="admin-community-composer-modal" onSubmit={(event) => void publish(event)}>
          <div className="admin-community-form-grid">
            <label className="admin-community-category-field">Catégorie<select value={category} onChange={(event) => setCategory(event.target.value as PostCategory)}><option>Discussion</option><option>Question</option><option>Astuce</option></select></label>
            <label>Titre<input required minLength={3} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Donnez un titre clair à votre publication" /></label>
            <label className="admin-community-message-field">Message<textarea required maxLength={3000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Rédigez votre annonce…" /></label>
          </div>
          <div className="admin-community-media-picker">
            <input ref={mediaInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(event) => { selectMedia(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
            <button type="button" className="outline-button compact" onClick={() => mediaInput.current?.click()}><ImagePlus size={16} /><Video size={16} /> Ajouter une image ou vidéo</button>
            <small>JPEG, PNG ou WebP · MP4 ou WebM</small>
          </div>
          {mediaError && <p className="community-image-error" role="alert">{mediaError}</p>}
          {media && mediaPreview && <div className="community-image-preview">
            {media.type.startsWith('video/') ? <video src={mediaPreview} controls playsInline /> : <img src={mediaPreview} alt={`Aperçu de ${media.name}`} />}
            <div><strong>{media.name}</strong><small>{(media.size / (1024 * 1024)).toFixed(1)} Mo</small></div>
            <button className="community-image-remove" type="button" aria-label="Retirer le média" onClick={() => setSelectedMedia(null)}><X size={17} /></button>
          </div>}
          {publishError && <p className="settings-error admin-community-publish-error" role="alert">{publishError}</p>}
        </form>
      </Modal>
      <section className="admin-community-filter-panel" aria-label="Recherche et filtres des publications">
        <label className="admin-community-search"><Search size={18} aria-hidden="true" /><input type="search" value={postSearch} onChange={(event) => setPostSearch(event.target.value)} placeholder="Rechercher une publication, un auteur ou un commentaire…" aria-label="Rechercher les publications" />{postSearch && <button type="button" aria-label="Effacer la recherche" onClick={() => setPostSearch('')}><X size={16} /></button>}</label>
        <div className="admin-community-filters">
          <label>Catégorie<select value={postCategoryFilter} onChange={(event) => setPostCategoryFilter(event.target.value)}><option value="ALL">Toutes</option><option>Discussion</option><option>Question</option><option>Astuce</option></select></label>
          <label>Auteur<select value={postAuthorFilter} onChange={(event) => setPostAuthorFilter(event.target.value as PostAuthorFilter)}><option value="ALL">Tous les auteurs</option><option value="ADMIN">Administration</option><option value="AGENT">Agents</option></select></label>
          <label>Média<select value={postMediaFilter} onChange={(event) => setPostMediaFilter(event.target.value as PostMediaFilter)}><option value="ALL">Tous les formats</option><option value="TEXT">Texte seul</option><option value="IMAGE">Avec image</option><option value="VIDEO">Avec vidéo</option></select></label>
          <label>Trier par<select value={postSort} onChange={(event) => setPostSort(event.target.value as PostSort)}><option value="RECENT">Plus récentes</option><option value="OLDEST">Plus anciennes</option><option value="POPULAR">Plus populaires</option></select></label>
        </div>
        <p className="admin-community-result-count">{filteredPosts.length} publication{filteredPosts.length === 1 ? '' : 's'} affichée{filteredPosts.length === 1 ? '' : 's'} sur {posts.length}</p>
      </section>
      {loading ? <section className="panel empty-state">Chargement des publications…</section> : filteredPosts.length === 0 ? <section className="panel empty-state">{posts.length ? 'Aucune publication ne correspond à ces critères.' : 'Aucune publication dans la communauté pour le moment.'}</section> : <section className="admin-community-post-list">{filteredPosts.map((post) => <article className="panel admin-community-post" key={post.id}>
        <header><div><div className="admin-community-post-meta"><span>{post.category.name}</span><time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString('fr-FR')}</time></div><h2>{post.title}</h2><p>Publié par <strong>{authorName(post)}</strong>{(post.author.role === 'ADMIN' || post.author.role === 'SUPER_ADMIN') && <CommunityOfficialBadge />}</p></div></header>
        <p className="admin-community-post-content">{post.content}</p>
        {post.imageUrl && (isVideo(post.imageUrl) ? <video className="community-post-image community-post-video" src={post.imageUrl} controls preload="metadata" playsInline aria-label={`Vidéo publiée avec « ${post.title} »`} /> : <img className="community-post-image" src={post.imageUrl} alt={`Média publié avec « ${post.title} »`} loading="lazy" />)}
        <footer>{post.likesCount} réaction{post.likesCount === 1 ? '' : 's'} · {post.comments.length} commentaire{post.comments.length === 1 ? '' : 's'}</footer>
      </article>)}</section>}
    </>}
    {tab === 'reports' && <>
      <section className="admin-community-filter-panel" aria-label="Recherche et filtres des signalements">
        <label className="admin-community-search"><Search size={18} aria-hidden="true" /><input type="search" value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Rechercher un motif ou un déclarant…" aria-label="Rechercher les signalements" />{reportSearch && <button type="button" aria-label="Effacer la recherche" onClick={() => setReportSearch('')}><X size={16} /></button>}</label>
        <div className="admin-community-filters admin-community-report-filters"><label>Type de contenu<select value={reportTypeFilter} onChange={(event) => setReportTypeFilter(event.target.value as ReportTypeFilter)}><option value="ALL">Tous les signalements</option><option value="POST">Publications</option><option value="COMMENT">Commentaires</option></select></label></div>
        <p className="admin-community-result-count">{filteredReports.length} signalement{filteredReports.length === 1 ? '' : 's'} à traiter</p>
      </section>
      {loading ? <section className="panel empty-state">Chargement des signalements…</section> : filteredReports.length === 0 ? <section className="panel empty-state">{reports.length ? 'Aucun signalement ne correspond à cette recherche.' : 'Aucun signalement en attente.'}</section> : <section className="community-moderation-list">{filteredReports.map((report) => {
      const comment = report.targetType === 'COMMENT'
      const reportContent = report.target?.content ?? 'Le contenu signalé est introuvable ou déjà supprimé.'
      return <article className="panel community-moderation-item" key={report.id}>
        <div><span className="section-kicker">{comment ? 'COMMENTAIRE' : 'PUBLICATION'} · {new Date(report.createdAt).toLocaleString('fr-FR')}</span><h2>{comment ? report.target?.post?.title ?? 'Commentaire' : report.target?.title ?? 'Publication'}</h2><blockquote>{reportContent}</blockquote><p><strong>Motif :</strong> {report.reason}</p><small>Signalé par {report.reporter.email}</small></div>
        <div className="action-group"><button className="reject-button" disabled={busyId === report.id} onClick={() => void moderate(report, 'HIDE')}>{busyId === report.id ? 'Traitement...' : 'Masquer le contenu'}</button><button className="outline-button compact" disabled={busyId === report.id} onClick={() => void moderate(report, 'DISMISS')}>Classer sans suite</button></div>
      </article>
      })}</section>}
    </>}
  </>
}
