import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  ArrowRight,
  Eye,
  EyeOff,
  Flag,
  Heart,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import api, { type CommunityAuthor, type CommunityFeed, type CommunityPost } from '../api/client'
import { SubscriberBadge } from '../components/ui/SubscriberBadge'

type FeedFilter = 'ALL' | 'DISCUSSIONS' | 'OFFERS'
type ReportTarget = { targetType: 'POST' | 'COMMENT'; targetId: number }

function authorName(author: CommunityAuthor) {
  const profile = author.agentProfile
  return profile ? `${profile.firstName} ${profile.lastName}` : `Agent #${author.id}`
}

function avatarText(author: CommunityAuthor) {
  return authorName(author).split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

function CommunityAvatar({ author, className }: { author: CommunityAuthor; className: string }) {
  return (
    <span className={className} aria-hidden="true">
      {author.agentProfile?.imageUrl
        ? <img src={author.agentProfile.imageUrl} alt="" loading="lazy" />
        : avatarText(author)}
    </span>
  )
}

function categoryLabel(category?: CommunityPost['category']) {
  const value = category?.name ?? 'Discussion'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function commentKey(postId: number, parentCommentId: number | null) {
  return `${postId}:${parentCommentId ?? 'post'}`
}

function safeComments(comments?: CommunityPost['comments']) {
  return Array.isArray(comments) ? comments : []
}

function isCommunityVideo(url: string) {
  return /\.(mp4|webm)(?:$|[?#])/i.test(url)
}

export default function CommunityPage({ onOpenChat, focusPostId, currentUserId }: { onOpenChat: () => void; focusPostId?: number; currentUserId: number }) {
  const [feed, setFeed] = useState<CommunityFeed>({ posts: [], offers: [] })
  const [filter, setFilter] = useState<FeedFilter>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [composer, setComposer] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [media, setMedia] = useState<File | null>(null)
  const [mediaPreview, setMediaPreview] = useState('')
  const [mediaError, setMediaError] = useState('')
  const mediaInput = useRef<HTMLInputElement>(null)
  const mediaPreviewUrl = useRef<string | null>(null)
  const [category, setCategory] = useState<'Discussion' | 'Question' | 'Astuce'>('Discussion')
  const [saving, setSaving] = useState(false)
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [pendingCommentIds, setPendingCommentIds] = useState<Set<string>>(() => new Set())
  const [replyingTo, setReplyingTo] = useState<{ postId: number; commentId: number } | null>(null)
  const [pendingLikeIds, setPendingLikeIds] = useState<Set<number>>(() => new Set())
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [editingPostId, setEditingPostId] = useState<number | null>(null)
  const [editPostTitle, setEditPostTitle] = useState('')
  const [editPostContent, setEditPostContent] = useState('')
  const [editPostCategory, setEditPostCategory] = useState<'Discussion' | 'Question' | 'Astuce'>('Discussion')
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editCommentContent, setEditCommentContent] = useState('')
  const [savingContentId, setSavingContentId] = useState<string | null>(null)
  const [openActionsMenu, setOpenActionsMenu] = useState<string | null>(null)

  useEffect(() => () => {
    if (mediaPreviewUrl.current) URL.revokeObjectURL(mediaPreviewUrl.current)
  }, [])

  useEffect(() => {
    if (!openActionsMenu) return
    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Element && !event.target.closest('.community-actions-menu')) setOpenActionsMenu(null)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenActionsMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openActionsMenu])

  useEffect(() => {
    let active = true
    api.communityFeed()
      .then((data) => {
        if (!active) return
        setFeed({
          posts: (data.posts ?? []).map((post) => ({
            ...post,
            comments: safeComments(post.comments),
            category: post.category ?? { name: 'Discussion' },
            likesCount: post.likesCount ?? 0,
            likedByMe: Boolean(post.likedByMe),
          })),
          offers: Array.isArray(data.offers) ? data.offers : [],
        })
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger le forum.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (loading || !focusPostId) return
    document.getElementById(`community-post-${focusPostId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusPostId, loading, feed.posts])

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const post = await api.createCommunityPost({ title, content, category }, media)
      setFeed((current) => ({ ...current, posts: [post, ...current.posts] }))
      setTitle('')
      setContent('')
      setSelectedMedia(null)
      setMediaError('')
      setComposer(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de publier le message.') }
    finally { setSaving(false) }
  }

  function selectMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    const isVideo = ['video/mp4', 'video/webm'].includes(file.type)
    if (!isImage && !isVideo) {
      setSelectedMedia(null)
      setMediaError('Choisissez une image JPEG, PNG, WebP ou une vidéo MP4/WebM.')
      return
    }
    if (isImage && file.size > 5 * 1024 * 1024) {
      setSelectedMedia(null)
      setMediaError('Une image ne doit pas dépasser 5 Mo.')
      return
    }
    if (isVideo && file.size > 50 * 1024 * 1024) {
      setSelectedMedia(null)
      setMediaError('Une vidéo ne doit pas dépasser 50 Mo.')
      return
    }
    setMediaError('')
    setSelectedMedia(file)
  }

  function setSelectedMedia(file: File | null) {
    if (mediaPreviewUrl.current) URL.revokeObjectURL(mediaPreviewUrl.current)
    mediaPreviewUrl.current = file ? URL.createObjectURL(file) : null
    setMediaPreview(mediaPreviewUrl.current ?? '')
    setMedia(file)
  }

  async function comment(postId: number, parentCommentId: number | null = null) {
    const key = commentKey(postId, parentCommentId)
    const text = commentDrafts[key]?.trim()
    if (!text || pendingCommentIds.has(key)) return
    setPendingCommentIds((current) => new Set(current).add(key))
    setError('')
    try {
      const newComment = await api.createCommunityComment(postId, text, parentCommentId)
      setFeed((current) => ({ ...current, posts: current.posts.map((post) => post.id === postId ? { ...post, comments: [...post.comments, newComment] } : post) }))
      setCommentDrafts((current) => ({ ...current, [key]: '' }))
      if (parentCommentId !== null) setReplyingTo(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible d’ajouter le commentaire.') }
    finally { setPendingCommentIds((current) => { const next = new Set(current); next.delete(key); return next }) }
  }

  function startPostEdit(post: CommunityPost) {
    setEditingPostId(post.id)
    setEditPostTitle(post.title)
    setEditPostContent(post.content)
    setEditPostCategory(post.category.name as 'Discussion' | 'Question' | 'Astuce')
  }

  async function savePostEdit(event: FormEvent<HTMLFormElement>, postId: number) {
    event.preventDefault()
    setSavingContentId(`post:${postId}`)
    setError('')
    try {
      const updated = await api.updateCommunityPost(postId, { title: editPostTitle, content: editPostContent, category: editPostCategory })
      setFeed((current) => ({ ...current, posts: current.posts.map((post) => post.id === postId ? { ...post, ...updated } : post) }))
      setEditingPostId(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de modifier la publication.') }
    finally { setSavingContentId(null) }
  }

  async function togglePostHidden(post: CommunityPost) {
    setSavingContentId(`post:${post.id}`)
    setError('')
    try {
      await api.setCommunityPostHidden(post.id, !post.isAuthorHidden)
      setFeed((current) => ({ ...current, posts: current.posts.map((item) => item.id === post.id ? { ...item, isAuthorHidden: !post.isAuthorHidden } : item) }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de modifier la visibilité de la publication.') }
    finally { setSavingContentId(null) }
  }

  async function deletePost(post: CommunityPost) {
    if (!window.confirm('Supprimer définitivement cette publication et ses commentaires ?')) return
    setSavingContentId(`post:${post.id}`)
    setError('')
    try {
      await api.deleteCommunityPost(post.id)
      setFeed((current) => ({ ...current, posts: current.posts.filter((item) => item.id !== post.id) }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de supprimer la publication.') }
    finally { setSavingContentId(null) }
  }

  async function saveCommentEdit(event: FormEvent<HTMLFormElement>, postId: number, commentId: number) {
    event.preventDefault()
    setSavingContentId(`comment:${commentId}`)
    setError('')
    try {
      const updated = await api.updateCommunityComment(commentId, editCommentContent)
      setFeed((current) => ({ ...current, posts: current.posts.map((post) => post.id === postId ? { ...post, comments: post.comments.map((item) => item.id === commentId ? { ...item, content: updated.content } : item) } : post) }))
      setEditingCommentId(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de modifier le commentaire.') }
    finally { setSavingContentId(null) }
  }

  async function toggleCommentHidden(postId: number, item: CommunityPost['comments'][number]) {
    setSavingContentId(`comment:${item.id}`)
    setError('')
    try {
      await api.setCommunityCommentHidden(item.id, !item.isAuthorHidden)
      setFeed((current) => ({ ...current, posts: current.posts.map((post) => post.id === postId ? { ...post, comments: post.comments.map((comment) => comment.id === item.id ? { ...comment, isAuthorHidden: !item.isAuthorHidden } : comment) } : post) }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de modifier la visibilité du commentaire.') }
    finally { setSavingContentId(null) }
  }

  async function deleteComment(postId: number, item: CommunityPost['comments'][number]) {
    if (!window.confirm(item.parentCommentId === null ? 'Supprimer ce commentaire et ses réponses ?' : 'Supprimer définitivement ce commentaire ?')) return
    setSavingContentId(`comment:${item.id}`)
    setError('')
    try {
      await api.deleteCommunityComment(item.id)
      setFeed((current) => ({ ...current, posts: current.posts.map((post) => post.id === postId ? { ...post, comments: post.comments.filter((comment) => comment.id !== item.id && (item.parentCommentId !== null || comment.parentCommentId !== item.id)) } : post) }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de supprimer le commentaire.') }
    finally { setSavingContentId(null) }
  }

  async function toggleLike(post: CommunityPost) {
    if (pendingLikeIds.has(post.id)) return
    setPendingLikeIds((current) => new Set(current).add(post.id))
    setError('')
    try {
      const reaction = await api.setCommunityLike(post.id, !post.likedByMe)
      setFeed((current) => ({
        ...current,
        posts: current.posts.map((item) => item.id === post.id ? {
          ...item,
          comments: safeComments(item.comments),
          category: item.category ?? { name: 'Discussion' },
          likedByMe: reaction.liked,
          likesCount: reaction.likesCount,
        } : { ...item, comments: safeComments(item.comments), category: item.category ?? { name: 'Discussion' } }),
      }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de modifier la réaction.') }
    finally { setPendingLikeIds((current) => { const next = new Set(current); next.delete(post.id); return next }) }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reportTarget) return
    setSaving(true)
    setError('')
    try {
      await api.reportCommunityContent({ ...reportTarget, reason: reportReason })
      setReportTarget(null)
      setReportReason('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de signaler le contenu.') }
    finally { setSaving(false) }
  }

  const showPosts = filter !== 'OFFERS'
  const showOffers = filter !== 'DISCUSSIONS'

  return <>
    <section className="community-hero">
      <div className="community-hero-visual" aria-hidden="true"><img src="/community-hero.png" alt="" fetchPriority="high" /></div>
      <div className="community-hero-copy"><span className="community-hero-kicker">COMMUNAUTÉ TY SY NDAY</span><h1>Partageons, grandissons<br />ensemble.</h1><p>Échangez avec les agents, partagez vos réussites et découvrez les opportunités de notre réseau.</p><button type="button" className="community-hero-button" onClick={onOpenChat}><MessageCircle size={17} aria-hidden="true" /> Écrire à un agent <ArrowRight size={16} aria-hidden="true" /></button></div>
      <div className="community-hero-stats"><span><strong>{feed.posts.length}</strong> échanges</span><i /> <span><strong>{feed.offers.length}</strong> offres actives</span></div>
    </section>
    <div className="community-toolbar" role="tablist" aria-label="Filtrer le forum">
      <button type="button" className={filter === 'ALL' ? 'community-filter active' : 'community-filter'} onClick={() => setFilter('ALL')}>Tout le forum</button>
      <button type="button" className={filter === 'DISCUSSIONS' ? 'community-filter active' : 'community-filter'} onClick={() => setFilter('DISCUSSIONS')}>Discussions</button>
      <button type="button" className={filter === 'OFFERS' ? 'community-filter active' : 'community-filter'} onClick={() => setFilter('OFFERS')}>Offres catalogue <span>{feed.offers.length}</span></button>
      <button type="button" className="community-chat-shortcut" onClick={onOpenChat}><MessageCircle size={16} aria-hidden="true" /> Messages privés <ArrowRight size={15} aria-hidden="true" /></button>
    </div>
    {error && <p className="form-error community-error" role="alert">{error}</p>}
    {showPosts && <section className="community-discussions">
      <div className="community-section-heading"><div><span className="section-kicker">LE FIL DES AGENTS</span><h2>Discussions récentes</h2></div><button type="button" className="outline-button community-create-button" onClick={() => setComposer(true)}><Plus size={17} aria-hidden="true" /> Créer une publication</button></div>
      <button type="button" className="community-create-prompt" onClick={() => setComposer(true)}><span className="community-prompt-avatar"><Sparkles size={18} aria-hidden="true" /></span><span><strong>Une question ou une idée à partager ?</strong><small>Publiez une pensée pour lancer l’échange</small></span><b>Créer un post <ArrowRight size={15} aria-hidden="true" /></b></button>
      {loading ? <section className="panel empty-state">Chargement du forum...</section> : feed.posts.length === 0 ? <div className="panel empty-state">Pas encore de discussion. Lancez le premier échange entre agents.</div> : <div className="community-post-list">{feed.posts.map((post) => {
        const comments = safeComments(post.comments)
        const rootComments = comments.filter((item) => item.parentCommentId === null)
        const isOwnPost = post.author.id === currentUserId
        const postBusy = savingContentId === `post:${post.id}`
        return <article id={`community-post-${post.id}`} className={`panel community-post${post.isAuthorHidden ? ' author-hidden' : ''}`} key={post.id}>
          <header className="community-post-header"><div className="post-meta"><CommunityAvatar author={post.author} className="avatar small community-person-avatar" /><span><strong>{authorName(post.author)}{post.author.isSubscriber && <SubscriberBadge />}</strong><small><span className="community-category">{categoryLabel(post.category)}</span> <i>·</i> {new Date(post.createdAt).toLocaleString('fr-FR')}</small></span></div>
            <div className="community-actions-menu">
              <button type="button" className="community-actions-trigger" aria-label="Plus d’options pour la publication" aria-haspopup="menu" aria-expanded={openActionsMenu === `post-${post.id}`} onClick={() => setOpenActionsMenu((current) => current === `post-${post.id}` ? null : `post-${post.id}`)}>
                <MoreHorizontal size={20} aria-hidden="true" />
              </button>
              {openActionsMenu === `post-${post.id}` && <div className="community-actions-dropdown" role="menu">
                {isOwnPost ? <>
                  <button type="button" role="menuitem" onClick={() => { setOpenActionsMenu(null); if (editingPostId === post.id) setEditingPostId(null); else startPostEdit(post) }} disabled={postBusy}><Pencil size={15} aria-hidden="true" /> Modifier</button>
                  <button type="button" role="menuitem" onClick={() => { setOpenActionsMenu(null); void togglePostHidden(post) }} disabled={postBusy}>{post.isAuthorHidden ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}{post.isAuthorHidden ? 'Réafficher' : 'Masquer'}</button>
                  <button type="button" role="menuitem" className="danger" onClick={() => { setOpenActionsMenu(null); void deletePost(post) }} disabled={postBusy}><Trash2 size={15} aria-hidden="true" /> Supprimer</button>
                </> : <button type="button" role="menuitem" onClick={() => { setOpenActionsMenu(null); setReportTarget({ targetType: 'POST', targetId: post.id }) }}><Flag size={15} aria-hidden="true" /> Signaler</button>}
              </div>}
            </div>
          </header>
          {post.isAuthorHidden && <p className="community-hidden-notice"><EyeOff size={14} /> Publication masquée pour les autres agents. Vous seul pouvez la voir.</p>}
          {editingPostId === post.id ? <form className="community-inline-edit" onSubmit={(event) => void savePostEdit(event, post.id)}>
            <label>Titre<input required minLength={3} maxLength={200} value={editPostTitle} onChange={(event) => setEditPostTitle(event.target.value)} /></label>
            <label>Contenu<textarea required maxLength={3000} value={editPostContent} onChange={(event) => setEditPostContent(event.target.value)} /></label>
            <label>Catégorie<select value={editPostCategory} onChange={(event) => setEditPostCategory(event.target.value as typeof editPostCategory)}><option>Discussion</option><option>Question</option><option>Astuce</option></select></label>
            <div className="community-inline-edit-actions"><button type="submit" className="outline-button compact" disabled={postBusy || !editPostTitle.trim() || !editPostContent.trim()}><Save size={14} /> {postBusy ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" className="outline-button compact" onClick={() => setEditingPostId(null)}>Annuler</button></div>
          </form> : <><h3>{post.title}</h3><p className="community-post-content">{post.content}</p></>}
          {post.imageUrl && (isCommunityVideo(post.imageUrl)
            ? <video className="community-post-image community-post-video" src={post.imageUrl} controls preload="metadata" playsInline aria-label={`Vidéo publiée avec « ${post.title} »`} />
            : <img className="community-post-image" src={post.imageUrl} alt={`Photo publiée avec « ${post.title} »`} loading="lazy" />)}
          <div className="community-post-summary"><span><Heart size={14} aria-hidden="true" /> {post.likesCount ?? 0} réaction{(post.likesCount ?? 0) === 1 ? '' : 's'}</span><span>{comments.length} commentaire{comments.length === 1 ? '' : 's'}</span></div>
          <div className="community-post-actions"><button type="button" className={post.likedByMe ? 'like-button liked' : 'like-button'} onClick={() => void toggleLike(post)} aria-pressed={post.likedByMe} disabled={post.isAuthorHidden || pendingLikeIds.has(post.id)}><Heart size={17} fill={post.likedByMe ? 'currentColor' : 'none'} aria-hidden="true" /> J’aime</button><button type="button" className="like-button" onClick={() => document.getElementById(`community-comment-input-${post.id}`)?.focus()} disabled={post.isAuthorHidden}><MessageCircle size={17} aria-hidden="true" /> Commenter</button><button type="button" className="like-button" onClick={onOpenChat}><Send size={17} aria-hidden="true" /> Message</button></div>
          <div className="community-comments" aria-live="polite" hidden={comments.length === 0}>
            {rootComments.map((item) => {
              const replies = comments.filter((reply) => reply.parentCommentId === item.id)
              const replyKey = commentKey(post.id, item.id)
              return <div className="community-comment-thread" key={item.id}>
                <div className={`community-comment${item.isAuthorHidden ? ' author-hidden' : ''}`}><CommunityAvatar author={item.author} className="community-comment-avatar community-person-avatar" />{editingCommentId === item.id ? <form className="community-inline-edit comment-edit" onSubmit={(event) => void saveCommentEdit(event, post.id, item.id)}><textarea required maxLength={2000} value={editCommentContent} onChange={(event) => setEditCommentContent(event.target.value)} /><div className="community-inline-edit-actions"><button type="submit" className="outline-button compact" disabled={savingContentId === `comment:${item.id}` || !editCommentContent.trim()}><Save size={13} /> Enregistrer</button><button type="button" className="outline-button compact" onClick={() => setEditingCommentId(null)}>Annuler</button></div></form> : <p><strong>{authorName(item.author)}{item.author.isSubscriber && <SubscriberBadge />}</strong><span>{item.content}</span>{item.isAuthorHidden && <small className="community-hidden-label">Masqué par vous</small>}</p>}
                  <div className="community-actions-menu">
                    <button type="button" className="community-actions-trigger community-comment-actions-trigger" aria-label="Plus d’options pour le commentaire" aria-haspopup="menu" aria-expanded={openActionsMenu === `comment-${item.id}`} onClick={() => setOpenActionsMenu((current) => current === `comment-${item.id}` ? null : `comment-${item.id}`)}><MoreHorizontal size={18} aria-hidden="true" /></button>
                    {openActionsMenu === `comment-${item.id}` && <div className="community-actions-dropdown" role="menu">
                      {item.author.id === currentUserId ? <>
                        <button type="button" role="menuitem" onClick={() => { setOpenActionsMenu(null); setEditingCommentId(item.id); setEditCommentContent(item.content) }} disabled={savingContentId === `comment:${item.id}`}><Pencil size={15} aria-hidden="true" /> Modifier</button>
                        <button type="button" role="menuitem" onClick={() => { setOpenActionsMenu(null); void toggleCommentHidden(post.id, item) }} disabled={savingContentId === `comment:${item.id}`}>{item.isAuthorHidden ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}{item.isAuthorHidden ? 'Réafficher' : 'Masquer'}</button>
                        <button type="button" role="menuitem" className="danger" onClick={() => { setOpenActionsMenu(null); void deleteComment(post.id, item) }} disabled={savingContentId === `comment:${item.id}`}><Trash2 size={15} aria-hidden="true" /> Supprimer</button>
                      </> : <button type="button" role="menuitem" onClick={() => { setOpenActionsMenu(null); setReportTarget({ targetType: 'COMMENT', targetId: item.id }) }}><Flag size={15} aria-hidden="true" /> Signaler</button>}
                    </div>}
                  </div>
                </div>
                <div className="community-comment-links">{!post.isAuthorHidden && !item.isAuthorHidden && <button type="button" onClick={() => setReplyingTo((current) => current?.commentId === item.id ? null : { postId: post.id, commentId: item.id })}>Répondre</button>}<small>{new Date(item.createdAt).toLocaleString('fr-FR')}</small></div>
                {replies.map((reply) => <div className={`community-comment community-comment-reply${reply.isAuthorHidden ? ' author-hidden' : ''}`} key={reply.id}><CommunityAvatar author={reply.author} className="community-comment-avatar community-person-avatar" />{editingCommentId === reply.id ? <form className="community-inline-edit comment-edit" onSubmit={(event) => void saveCommentEdit(event, post.id, reply.id)}><textarea required maxLength={2000} value={editCommentContent} onChange={(event) => setEditCommentContent(event.target.value)} /><div className="community-inline-edit-actions"><button type="submit" className="outline-button compact" disabled={savingContentId === `comment:${reply.id}` || !editCommentContent.trim()}><Save size={13} /> Enregistrer</button><button type="button" className="outline-button compact" onClick={() => setEditingCommentId(null)}>Annuler</button></div></form> : <p><strong>{authorName(reply.author)}{reply.author.isSubscriber && <SubscriberBadge />}</strong><span>{reply.content}</span>{reply.isAuthorHidden && <small className="community-hidden-label">Masqué par vous</small>}</p>}
                  <div className="community-actions-menu">
                    <button type="button" className="community-actions-trigger community-comment-actions-trigger" aria-label="Plus d’options pour la réponse" aria-haspopup="menu" aria-expanded={openActionsMenu === `comment-${reply.id}`} onClick={() => setOpenActionsMenu((current) => current === `comment-${reply.id}` ? null : `comment-${reply.id}`)}><MoreHorizontal size={18} aria-hidden="true" /></button>
                    {openActionsMenu === `comment-${reply.id}` && <div className="community-actions-dropdown" role="menu">
                      {reply.author.id === currentUserId ? <>
                        <button type="button" role="menuitem" onClick={() => { setOpenActionsMenu(null); setEditingCommentId(reply.id); setEditCommentContent(reply.content) }} disabled={savingContentId === `comment:${reply.id}`}><Pencil size={15} aria-hidden="true" /> Modifier</button>
                        <button type="button" role="menuitem" onClick={() => { setOpenActionsMenu(null); void toggleCommentHidden(post.id, reply) }} disabled={savingContentId === `comment:${reply.id}`}>{reply.isAuthorHidden ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}{reply.isAuthorHidden ? 'Réafficher' : 'Masquer'}</button>
                        <button type="button" role="menuitem" className="danger" onClick={() => { setOpenActionsMenu(null); void deleteComment(post.id, reply) }} disabled={savingContentId === `comment:${reply.id}`}><Trash2 size={15} aria-hidden="true" /> Supprimer</button>
                      </> : <button type="button" role="menuitem" onClick={() => { setOpenActionsMenu(null); setReportTarget({ targetType: 'COMMENT', targetId: reply.id }) }}><Flag size={15} aria-hidden="true" /> Signaler</button>}
                    </div>}
                  </div>
                </div>)}
                {!post.isAuthorHidden && !item.isAuthorHidden && replyingTo?.postId === post.id && replyingTo.commentId === item.id && <form className="community-comment-form community-reply-form" onSubmit={(event) => { event.preventDefault(); void comment(post.id, item.id) }}><input autoFocus aria-label={`Répondre à ${authorName(item.author)}`} maxLength={2000} value={commentDrafts[replyKey] ?? ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [replyKey]: event.target.value }))} placeholder={`Répondre à ${authorName(item.author)}…`} /><button className="outline-button compact" disabled={!commentDrafts[replyKey]?.trim() || pendingCommentIds.has(replyKey)}>{pendingCommentIds.has(replyKey) ? 'Envoi…' : 'Répondre'}</button></form>}
              </div>
            })}
          </div>
          {!post.isAuthorHidden && <form className="community-comment-form community-main-comment" onSubmit={(event) => { event.preventDefault(); void comment(post.id) }}><div className="community-comment-avatar">A</div><input id={`community-comment-input-${post.id}`} aria-label={`Commenter ${post.title}`} maxLength={2000} value={commentDrafts[commentKey(post.id, null)] ?? ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [commentKey(post.id, null)]: event.target.value }))} placeholder="Écrire un commentaire..." /><button className="outline-button compact" disabled={!commentDrafts[commentKey(post.id, null)]?.trim() || pendingCommentIds.has(commentKey(post.id, null))}>{pendingCommentIds.has(commentKey(post.id, null)) ? 'Envoi…' : 'Publier'}</button></form>}
        </article>
      })}</div>}
    </section>}
    {showOffers && <section className="community-offers">
      <div className="community-section-heading"><div><span className="section-kicker">PUBLIÉES PAR L’ADMINISTRATION</span><h2>Nouvelles offres catalogue</h2></div></div>
      {loading ? <section className="panel empty-state">Chargement des offres...</section> : feed.offers.length === 0 ? <div className="panel empty-state">Aucune offre publiée pour le moment.</div> : <div className="community-offer-grid">{feed.offers.map((offer) => <article className="community-offer" key={offer.id}>
        <span className="product-tag">OFFRE CATALOGUE</span><h3>{offer.title}</h3><p>{offer.description}</p><div><strong>Public cible</strong><p>{offer.targetAudience}</p></div><div><strong>Argumentaire</strong><p>{offer.salesPitch}</p></div>
        {offer.publishedAt && <time>{new Date(offer.publishedAt).toLocaleDateString('fr-FR')}</time>}
      </article>)}</div>}
    </section>}
    {composer && <div className="modal-backdrop community-composer-backdrop" onClick={() => setComposer(false)}><form className="modal community-composer" onSubmit={publish} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setComposer(false)}>×</button><p className="eyebrow">COMMUNAUTÉ TY SY NDAY</p><h2>Nouvelle publication</h2><label>Catégorie<select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option>Discussion</option><option>Question</option><option>Astuce</option></select></label><label>Titre<input required minLength={3} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Message<textarea className="community-textarea" required maxLength={3000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Partagez une astuce ou posez une question..." /></label><div className="community-image-picker"><input ref={mediaInput} id="community-post-media-input" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={selectMedia} aria-describedby={mediaError ? 'community-media-error' : undefined} /><button type="button" className="outline-button community-image-select" onClick={() => mediaInput.current?.click()}><ImagePlus size={17} aria-hidden="true" /><Video size={17} aria-hidden="true" /> Ajouter une photo ou vidéo</button><small>Images JPEG/PNG/WebP · 5 Mo max. | Vidéos MP4/WebM · 50 Mo max.</small></div>{mediaError && <p className="community-image-error" id="community-media-error" role="alert">{mediaError}</p>}{media && mediaPreview && <div className="community-image-preview">{media.type.startsWith('video/') ? <video src={mediaPreview} controls playsInline /> : <img src={mediaPreview} alt={`Aperçu de ${media.name}`} />}<div><strong>{media.name}</strong><small>{(media.size / (1024 * 1024)).toFixed(1)} Mo</small></div><button type="button" className="community-image-remove" aria-label="Retirer le média" onClick={() => { setSelectedMedia(null); setMediaError('') }}><X size={17} aria-hidden="true" /></button></div>}<div className="modal-actions"><button type="button" className="outline-button" onClick={() => setComposer(false)}>Annuler</button><button className="primary-button" disabled={saving}>{saving ? 'Publication...' : 'Publier'}</button></div></form></div>}
    {reportTarget && <div className="modal-backdrop" onClick={() => setReportTarget(null)}><form className="modal" onSubmit={submitReport} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setReportTarget(null)}>×</button><p className="eyebrow">MODÉRATION</p><h2>Signaler ce contenu</h2><p className="modal-intro">Le signalement sera transmis à l’administration pour examen.</p><label>Motif<input required minLength={5} maxLength={500} value={reportReason} onChange={(event) => setReportReason(event.target.value)} /></label><div className="modal-actions"><button type="button" className="outline-button" onClick={() => setReportTarget(null)}>Annuler</button><button className="primary-button" disabled={saving}>{saving ? 'Envoi...' : 'Envoyer le signalement'}</button></div></form></div>}
  </>
}
