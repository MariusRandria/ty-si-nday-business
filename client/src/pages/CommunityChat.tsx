import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { io, type Socket } from 'socket.io-client'
import api, { type ChatAgent, type ChatConversation, type ChatMessage, type CommunityAuthor } from '../api/client'
import { Archive, ArchiveRestore, ArrowLeft, FileText, Maximize2, MessageCircle, Mic, MoreHorizontal, Paperclip, Phone, Search, Send, ShieldCheck, SquarePen, Trash2, X } from 'lucide-react'
import { notify } from '../utils/toast'
import { SubscriberBadge } from '../components/ui/SubscriberBadge'

function nameOf(agent: CommunityAuthor) {
  return agent.agentProfile
    ? `${agent.agentProfile.firstName} ${agent.agentProfile.lastName}`
    : `Agent #${agent.id}`
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

function avatarContent(agent: CommunityAuthor, name: string) {
  return agent.agentProfile?.imageUrl
    ? <img src={agent.agentProfile.imageUrl} alt="" loading="lazy" />
    : initials(name)
}

function timeOf(value: string) {
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export default function CommunityChat({ currentUserId, initialConversationId }: { currentUserId: number; initialConversationId?: number }) {
  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [conversationFilter, setConversationFilter] = useState<'all' | 'unread' | 'archived'>('all')
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false)
  const [openMessageMenuId, setOpenMessageMenuId] = useState<number | null>(null)
  const [messageMenuPosition, setMessageMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [conversationActionBusy, setConversationActionBusy] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [error, setError] = useState(() => window.localStorage.getItem('innovcom-token')
    ? ''
    : 'Votre session a expiré. Reconnectez-vous pour accéder au chat.')
  const socketRef = useRef<Socket | null>(null)
  const activeIdRef = useRef<number | null>(null)
  const conversationsRef = useRef<ChatConversation[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeMessages = messages.filter((message) => message.conversationId === activeId)

  useEffect(() => {
    conversationsRef.current = conversations
    window.dispatchEvent(new Event('tysynday:chat-unread-updated'))
  }, [conversations])

  useEffect(() => {
    let active = true
    Promise.all([api.communityChatAgents(), api.communityChatConversations()])
      .then(([availableAgents, currentConversations]) => {
        if (!active) return
        setAgents(availableAgents)
        setConversations(currentConversations)
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger la messagerie.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!initialConversationId || !conversations.some((conversation) => conversation.id === initialConversationId)) return
    setActiveId(initialConversationId)
  }, [initialConversationId, conversations])

  useEffect(() => {
    if (!conversationMenuOpen && openMessageMenuId === null) return
    function closeMenuOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Element)) return
      if (!event.target.closest('.chat-conversation-actions')) setConversationMenuOpen(false)
      if (!event.target.closest('.chat-message-actions, .chat-message-menu')) setOpenMessageMenuId(null)
    }
    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setConversationMenuOpen(false)
        setOpenMessageMenuId(null)
      }
    }
    function closeMessageMenu() {
      setOpenMessageMenuId(null)
    }
    document.addEventListener('pointerdown', closeMenuOnOutsideClick)
    document.addEventListener('keydown', closeMenuOnEscape)
    document.addEventListener('scroll', closeMessageMenu, true)
    window.addEventListener('resize', closeMessageMenu)
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsideClick)
      document.removeEventListener('keydown', closeMenuOnEscape)
      document.removeEventListener('scroll', closeMessageMenu, true)
      window.removeEventListener('resize', closeMessageMenu)
    }
  }, [conversationMenuOpen, openMessageMenuId])

  function toggleMessageMenu(messageId: number, event: MouseEvent<HTMLButtonElement>) {
    if (openMessageMenuId === messageId) {
      setOpenMessageMenuId(null)
      return
    }
    const trigger = event.currentTarget.getBoundingClientRect()
    const menuWidth = Math.min(205, window.innerWidth - 16)
    const menuHeight = 100
    const top = window.innerHeight - trigger.bottom >= menuHeight + 8
      ? trigger.bottom + 6
      : Math.max(8, trigger.top - menuHeight - 6)
    const left = Math.max(8, Math.min(trigger.left, window.innerWidth - menuWidth - 8))
    setMessageMenuPosition({ top, left })
    setOpenMessageMenuId(messageId)
  }

  useEffect(() => {
    const token = window.localStorage.getItem('innovcom-token')
    if (!token) return
    const socket = io({ auth: { token } })
    socketRef.current = socket
    socket.on('connect_error', () => {
      setSocketConnected(false)
      setError('Connexion au chat interrompue. Vérifiez que le serveur est démarré.')
    })
    socket.on('connect', () => {
      setSocketConnected(true)
      setError('')
    })
    socket.on('disconnect', () => setSocketConnected(false))
    socket.on('message:new', (message: ChatMessage) => {
      if (!conversationsRef.current.some((conversation) => conversation.id === message.conversationId)) {
        void api.communityChatConversations().then(setConversations).catch((caught) => {
          setError(caught instanceof Error ? caught.message : 'Impossible d’actualiser les conversations.')
        })
      }
      setConversations((current) => current.map((conversation) => conversation.id === message.conversationId
        ? { ...conversation, lastMessage: message, unreadCount: activeIdRef.current === message.conversationId ? 0 : conversation.unreadCount + 1, updatedAt: message.createdAt, archivedAt: null }
        : conversation).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)))
      if (activeIdRef.current === message.conversationId) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
        void api.markCommunityChatRead(message.conversationId).catch((caught) => {
          setError(caught instanceof Error ? caught.message : 'Impossible de marquer le message comme lu.')
        })
      }
    })
    socket.on('conversation:archive-changed', (event: { conversationId: number; archivedAt: string | null }) => {
      setConversations((current) => current.map((conversation) => conversation.id === event.conversationId
        ? { ...conversation, archivedAt: event.archivedAt }
        : conversation))
    })
    socket.on('conversation:deleted', (event: { conversationId: number }) => {
      setConversations((current) => current.filter((conversation) => conversation.id !== event.conversationId))
      setMessages((current) => current.filter((message) => message.conversationId !== event.conversationId))
      if (activeIdRef.current === event.conversationId) {
        activeIdRef.current = null
        setActiveId(null)
      }
    })
    socket.on('message:deleted', (event: {
      conversationId: number
      messageId: number
      deletedMessage: ChatMessage
      lastMessage: ChatMessage | null
      updatedAt: string
      unreadCount: number
    }) => {
      setMessages((current) => current.map((message) => message.id === event.messageId ? event.deletedMessage : message))
      setOpenMessageMenuId((current) => current === event.messageId ? null : current)
      setConversations((current) => current.map((conversation) => conversation.id === event.conversationId
        ? {
          ...conversation,
          lastMessage: conversation.lastMessage?.id === event.messageId ? event.lastMessage : conversation.lastMessage,
          updatedAt: event.updatedAt,
          unreadCount: event.unreadCount,
        }
        : conversation).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)))
    })
    socket.on('message:hidden', (event: {
      conversationId: number
      messageId: number
      lastMessage: ChatMessage | null
      unreadCount: number
    }) => {
      setMessages((current) => current.filter((message) => message.id !== event.messageId))
      setOpenMessageMenuId((current) => current === event.messageId ? null : current)
      setConversations((current) => current.map((conversation) => conversation.id === event.conversationId
        ? {
          ...conversation,
          lastMessage: conversation.lastMessage?.id === event.messageId ? event.lastMessage : conversation.lastMessage,
          unreadCount: event.unreadCount,
        }
        : conversation))
    })
    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [currentUserId])

  useEffect(() => {
    activeIdRef.current = activeId
    if (activeId === null) return
    let active = true
    api.communityChatMessages(activeId)
      .then((data) => {
        if (!active) return
        setMessages(data)
        setConversations((current) => current.map((item) => item.id === activeId ? { ...item, unreadCount: 0 } : item))
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger les messages.') })
    return () => { active = false }
  }, [activeId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, activeId])

  async function openAgent(agentId: number) {
    setError('')
    try {
      const conversationId = await api.startCommunityChat(agentId)
      setConversations(await api.communityChatConversations())
      setActiveId(conversationId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de démarrer la conversation.')
    }
  }

  async function toggleActiveConversationArchive() {
    if (!activeConversation || conversationActionBusy) return
    setConversationActionBusy(true)
    setError('')
    try {
      const archivedAt = await api.setCommunityChatArchived(activeConversation.id, !activeConversation.archivedAt)
      setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
        ? { ...conversation, archivedAt }
        : conversation))
      if (!archivedAt && conversationFilter === 'archived') setConversationFilter('all')
      setConversationMenuOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de modifier l’archivage.')
    } finally {
      setConversationActionBusy(false)
    }
  }

  async function deleteActiveConversation() {
    if (!activeConversation || conversationActionBusy) return
    const confirmation = 'Retirer cette conversation et son historique de votre liste ? L’autre agent conservera la conversation.'
    if (!window.confirm(confirmation)) return
    setConversationActionBusy(true)
    setError('')
    try {
      await api.deleteCommunityChatConversation(activeConversation.id)
      setConversations((current) => current.filter((conversation) => conversation.id !== activeConversation.id))
      setMessages((current) => current.filter((message) => message.conversationId !== activeConversation.id))
      activeIdRef.current = null
      setActiveId(null)
      setConversationMenuOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de supprimer la conversation.')
    } finally {
      setConversationActionBusy(false)
    }
  }

  async function deleteMessageForEveryone(message: ChatMessage) {
    if (!activeConversation || message.senderId !== currentUserId || conversationActionBusy) return
    if (!window.confirm(`Supprimer uniquement ce message pour tout le monde ? Cette action est définitive.\n\n« ${message.content} »`)) return
    setConversationActionBusy(true)
    setError('')
    try {
      const result = await api.deleteCommunityChatMessage(activeConversation.id, message.id)
      setMessages((current) => current.map((item) => item.id === message.id ? result.deletedMessage : item))
      setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
        ? {
          ...conversation,
          lastMessage: conversation.lastMessage?.id === message.id ? result.lastMessage : conversation.lastMessage,
          updatedAt: result.updatedAt,
          unreadCount: result.unreadCount,
        }
        : conversation).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)))
      setOpenMessageMenuId(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de supprimer le message.')
    } finally {
      setConversationActionBusy(false)
    }
  }

  async function deleteMessageForMe(message: ChatMessage) {
    if (!activeConversation || conversationActionBusy) return
    if (!window.confirm('Retirer ce message de votre affichage uniquement ? Il restera visible pour l’autre participant.')) return
    setConversationActionBusy(true)
    setError('')
    try {
      const result = await api.hideCommunityChatMessage(activeConversation.id, message.id)
      setMessages((current) => current.filter((item) => item.id !== message.id))
      setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
        ? {
          ...conversation,
          lastMessage: conversation.lastMessage?.id === message.id ? result.lastMessage : conversation.lastMessage,
          unreadCount: result.unreadCount,
        }
        : conversation))
      setOpenMessageMenuId(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de supprimer le message pour vous.')
    } finally {
      setConversationActionBusy(false)
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim() || (attachment ? `Pièce jointe : ${attachment.name}` : '')
    if ((!content && !attachment) || activeId === null || sending) return
    const socket = socketRef.current
    if (!socket?.connected) {
      setError('Le chat est déconnecté. Patientez quelques secondes puis réessayez.')
      return
    }
    setSending(true)
    setError('')
    socket.timeout(10000).emit('message:send', { conversationId: activeId, content }, (timeoutError: Error, result: { data?: ChatMessage; error?: string }) => {
      setSending(false)
      if (timeoutError) {
        setError('Le serveur ne confirme pas l’envoi. Vérifiez la connexion avant de réessayer.')
        return
      }
      const message = result.data
      if (result.error || !message) {
        setError(result.error ?? 'Impossible d’envoyer le message.')
        return
      }
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
      setConversations((current) => current.map((item) => item.id === activeId
        ? { ...item, lastMessage: message, updatedAt: message.createdAt, archivedAt: null }
        : item).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)))
      setDraft('')
      setAttachment(null)
    })
  }

  const activeConversation = conversations.find((item) => item.id === activeId) ?? null
  const filteredAgents = agents.filter((agent) => nameOf(agent).toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')))
  const existingAgentIds = new Set(conversations.map((conversation) => conversation.agent.id))
  const visibleConversations = conversations.filter((conversation) => {
    const matchesSearch = nameOf(conversation.agent).toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))
      || (conversation.lastMessage?.content ?? '').toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))
    const matchesFilter = conversationFilter === 'archived'
      ? Boolean(conversation.archivedAt)
      : !conversation.archivedAt && (conversationFilter === 'all' || conversation.unreadCount > 0)
    return matchesSearch && matchesFilter
  })

  return <section className="chat-page">
    <header className="chat-heading">
      <div><span className="section-kicker">ESPACE AGENT</span><h2>Messages privés</h2><p>Échangez directement et en toute confidentialité avec les autres agents.</p></div>
      <span className={socketConnected ? 'chat-live online' : 'chat-live'}><i /> {socketConnected ? 'Chat en direct' : 'Connexion…'}</span>
    </header>
    {error && <p className="form-error chat-error" role="alert">{error}</p>}
    <div className={`chat-workspace ${activeId !== null ? 'conversation-open' : ''}`}>
      <aside className="chat-contacts">
        <div className="chat-mobile-list-header">
          <h2>Discussions</h2>
          <div>
            <button type="button" aria-label="Plus d'options"><MoreHorizontal size={22} /></button>
            <button type="button" aria-label="Afficher en plein écran"><Maximize2 size={19} /></button>
            <button type="button" aria-label="Nouvelle discussion" onClick={() => document.querySelector<HTMLInputElement>('.chat-search input')?.focus()}><SquarePen size={20} /></button>
          </div>
        </div>
        <label className="chat-search"><Search size={18} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un agent" aria-label="Rechercher un agent" /></label>
        <div className="chat-mobile-tabs" aria-label="Filtrer les discussions">
          <button type="button" className={conversationFilter === 'all' ? 'active' : ''} onClick={() => setConversationFilter('all')}>Tout</button>
          <button type="button" className={conversationFilter === 'unread' ? 'active' : ''} onClick={() => setConversationFilter('unread')}>Non lu</button>
          <button type="button" className={conversationFilter === 'archived' ? 'active' : ''} onClick={() => setConversationFilter('archived')}>Archivées</button>
        </div>
        {loading ? <p className="chat-empty">Chargement des conversations…</p> : <>
          <h3 className="chat-list-title">{conversationFilter === 'archived' ? 'Conversations archivées' : 'Conversations'}</h3>
          <div className="chat-contact-list">
            {visibleConversations.map((conversation) => {
              const name = nameOf(conversation.agent)
              return <button type="button" key={conversation.id} className={`chat-contact ${activeId === conversation.id ? 'active' : ''}`} onClick={() => setActiveId(conversation.id)}>
                <span className="chat-avatar" aria-hidden="true">{avatarContent(conversation.agent, name)}</span><span className="chat-contact-copy"><strong><span>{name}</span>{conversation.agent.isSubscriber && <SubscriberBadge />}</strong><small>{conversation.lastMessage?.deletedAt ? 'Message supprimé' : conversation.lastMessage?.content ?? 'Démarrer la conversation'}</small></span>
                {conversation.unreadCount > 0 && <span className="chat-unread">{conversation.unreadCount}</span>}
              </button>
            })}
            {visibleConversations.length === 0 && <p className="chat-empty">{conversationFilter === 'archived' ? 'Aucune conversation archivée.' : conversationFilter === 'unread' ? 'Aucun message non lu.' : 'Vos conversations apparaîtront ici.'}</p>}
          </div>
          <h3 className="chat-list-title chat-agents-title">Agents disponibles</h3>
          <div className="chat-contact-list">
            {filteredAgents.filter((agent) => !existingAgentIds.has(agent.id)).map((agent) => {
              const name = nameOf(agent)
              return <button type="button" key={agent.id} className="chat-contact" onClick={() => void openAgent(agent.id)}>
                <span className="chat-avatar" aria-hidden="true">{avatarContent(agent, name)}</span><span className="chat-contact-copy"><strong><span>{name}</span>{agent.isSubscriber && <SubscriberBadge />}</strong><small>{agent.agentProfile?.city || 'Agent actif'}</small></span><span className="chat-start">＋</span>
              </button>
            })}
            {filteredAgents.filter((agent) => !existingAgentIds.has(agent.id)).length === 0 && <p className="chat-empty">Aucun autre agent à afficher.</p>}
          </div>
        </>}
      </aside>
      <section className="chat-thread" aria-label="Conversation">
        {activeConversation ? <>
          <header className="chat-thread-header">
            <button className="chat-mobile-back" type="button" aria-label="Retour aux conversations" onClick={() => setActiveId(null)}><ArrowLeft size={22} /></button>
            <span className="chat-avatar large" aria-hidden="true">{avatarContent(activeConversation.agent, nameOf(activeConversation.agent))}</span>
            <span className="chat-thread-person"><strong><span>{nameOf(activeConversation.agent)}</span>{activeConversation.agent.isSubscriber && <SubscriberBadge />}</strong><small>Agent Ty sy Nday Business · conversation privée</small></span>
            <div className="chat-thread-actions">
              <button className="chat-tool-button" type="button" aria-label="Démarrer un appel vocal" title="Appel vocal" onClick={() => notify('Appel vocal prêt à être lancé avec cet agent.', 'info')}><Phone size={20} /></button>
              <div className="chat-conversation-actions">
                <button className="chat-tool-button" type="button" aria-label="Options de conversation" aria-haspopup="menu" aria-expanded={conversationMenuOpen} onClick={() => setConversationMenuOpen((open) => !open)} disabled={conversationActionBusy}><MoreHorizontal size={21} /></button>
                {conversationMenuOpen && <div className="chat-conversation-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void toggleActiveConversationArchive()} disabled={conversationActionBusy}>
                    {activeConversation.archivedAt ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
                    {activeConversation.archivedAt ? 'Désarchiver' : 'Archiver'}
                  </button>
                  <button type="button" role="menuitem" className="danger" onClick={() => void deleteActiveConversation()} disabled={conversationActionBusy}>
                    <Trash2 size={16} aria-hidden="true" /> Supprimer pour moi
                  </button>
                </div>}
              </div>
            </div>
          </header>
          <div className="chat-messages" aria-live="polite">
            {activeMessages.length === 0 && <p className="chat-first-message">Dites bonjour et commencez la conversation 👋</p>}
            {activeMessages.map((message) => <div className={`chat-message-row ${message.senderId === currentUserId ? 'mine' : ''}`} key={message.id}>
              <div className="chat-bubble">
                {message.senderId === currentUserId && !message.deletedAt && <div className="chat-message-actions">
                  <button type="button" className="chat-message-menu-trigger" aria-label="Options de ce message" aria-haspopup="menu" aria-expanded={openMessageMenuId === message.id} onClick={(event) => toggleMessageMenu(message.id, event)} disabled={conversationActionBusy}><MoreHorizontal size={17} aria-hidden="true" /></button>
                  {openMessageMenuId === message.id && messageMenuPosition && createPortal(<div className={`chat-message-menu ${document.querySelector('.app-shell.theme-dark') ? 'theme-dark' : ''}`} role="menu" style={messageMenuPosition}>
                    <button type="button" role="menuitem" onClick={() => void deleteMessageForMe(message)} disabled={conversationActionBusy}><Trash2 size={15} aria-hidden="true" /> Supprimer pour moi</button>
                    <button type="button" role="menuitem" className="danger" onClick={() => void deleteMessageForEveryone(message)} disabled={conversationActionBusy}><Trash2 size={15} aria-hidden="true" /> Supprimer pour tout le monde</button>
                  </div>, document.body)}
                </div>}
                {message.deletedAt
                  ? <p className="chat-message-deleted">{message.senderId === currentUserId ? 'Vous avez supprimé ce message' : `${nameOf(activeConversation.agent)} a supprimé ce message`}</p>
                  : <p>{message.content}</p>}
                <time>{timeOf(message.createdAt)}</time>
              </div>
            </div>)}
            <div ref={endRef} />
          </div>
          {attachment && <div className="chat-attachment-preview"><FileText size={18} /><span><strong>{attachment.name}</strong><small>{Math.max(1, Math.round(attachment.size / 1024))} Ko</small></span><button type="button" aria-label="Retirer la pièce jointe" onClick={() => setAttachment(null)}><X size={18} /></button></div>}
          <form className="chat-compose" onSubmit={sendMessage}>
            <input ref={fileInputRef} className="chat-file-input" type="file" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} />
            <button className="chat-tool-button" type="button" aria-label="Joindre un fichier" onClick={() => fileInputRef.current?.click()}><Paperclip size={21} /></button>
            <button className="chat-tool-button chat-voice-button" type="button" aria-label="Appel vocal" onClick={() => notify('Appel vocal prêt à être lancé avec cet agent.', 'info')}><Mic size={21} /></button>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Écrire un message privé…" aria-label="Écrire un message privé" />
            <button className="chat-send-button" type="submit" disabled={(!draft.trim() && !attachment) || sending} aria-label="Envoyer le message">{sending ? '…' : <Send size={19} />}</button>
          </form>
          <p className="chat-privacy-note"><ShieldCheck size={14} /> Vos messages sont visibles uniquement par les participants.</p>
        </> : <div className="chat-welcome"><div className="chat-welcome-icon"><MessageCircle size={28} /></div><h3>Votre espace de discussion</h3><p>Sélectionnez une conversation ou choisissez un agent pour lui écrire.</p></div>}
      </section>
    </div>
  </section>
}
