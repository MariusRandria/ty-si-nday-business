import { useCallback, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import api, { type Notification, type SearchResult, type SessionUser } from '../../api/client'
import type { View } from '../../types/report'
import { Bell, BellRing, CheckCircle2, ClipboardList, Grid2X2, LayoutDashboard, MessageCircle, Menu, Moon, PackageOpen, Search, Settings, ShieldCheck, Sun, UsersRound, UserRound, WalletCards, MapPinned, X } from 'lucide-react'
import tySyNdayLogo from '../../assets/TD.png'
import { useI18n } from '../../i18n'
import { AgentPresenceDot } from '../ui/AgentPresence'

function notificationIcon(type: string) {
  if (type.includes('COMMUNITY') || type === 'PRIVATE_MESSAGE') return MessageCircle
  if (type.includes('REPORT')) return ClipboardList
  if (type.includes('WITHDRAWAL') || type.includes('COMMISSION')) return WalletCards
  if (type.includes('APPROVED') || type.includes('CONFIRMED') || type.includes('SIGNED')) return CheckCircle2
  if (type.includes('SECURITY') || type.includes('REJECTED')) return ShieldCheck
  if (type.includes('PRODUCT')) return PackageOpen
  return BellRing
}

function notificationTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

export default function Topbar({ view, apiOnline, theme, onToggleTheme, user, onNavigate, onMobileMenu }: { view: View; apiOnline: boolean; theme: 'light' | 'dark'; onToggleTheme: () => void; user: SessionUser; onNavigate: (view: View) => void; onMobileMenu: () => void }) {
  const { t } = useI18n()
  const localize = user.role === 'AGENT' ? t : (text: string) => text
  const [notifications, setNotifications] = useState<Notification[]>([]); const [open, setOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [notificationError, setNotificationError] = useState('')
  const [messageUnread, setMessageUnread] = useState(0)
  useEffect(() => {
    if (view.startsWith('admin-')) return
    const refreshUnread = () => api.communityChatConversations().then((conversations) => {
      setMessageUnread(conversations.reduce((total, conversation) => total + conversation.unreadCount, 0))
    }).catch(() => undefined)
    refreshUnread()
    const interval = window.setInterval(refreshUnread, 30000)
    const syncUnread = () => refreshUnread()
    window.addEventListener('tysynday:chat-unread-updated', syncUnread)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('tysynday:chat-unread-updated', syncUnread)
    }
  }, [view])
  useEffect(() => {
    let active = true
    const refresh = () => { api.notifications().then((data) => { if (active) setNotifications(data) }).catch(() => undefined) }
    refresh()
    const interval = window.setInterval(refresh, 15000)
    return () => { active = false; window.clearInterval(interval) }
  }, [view])
  useEffect(() => {
    if (user.role !== 'AGENT' || user.status !== 'ACTIF') return
    const token = window.localStorage.getItem('innovcom-token')
    if (!token) return
    const socket = io({ auth: { token } })
    socket.on('notification:new', (notification: Notification) => {
      setNotifications((current) => current.some((item) => item.id === notification.id)
        ? current
        : [notification, ...current].slice(0, 30))
    })
    return () => { socket.disconnect() }
  }, [user.id, user.role, user.status])
  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) { setSearchResults([]); setSearching(false); return }
    let active = true
    const timeout = window.setTimeout(() => {
      setSearching(true)
      setSearchError('')
      api.search(searchQuery.trim()).then((results) => { if (active) setSearchResults(results) }).catch((caught) => { if (active) setSearchError(caught instanceof Error ? caught.message : 'Recherche impossible.') }).finally(() => { if (active) setSearching(false) })
    }, 220)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [searchOpen, searchQuery])
  useEffect(() => {
    if (!searchOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSearchOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [searchOpen])
  const unread = notifications.filter((item) => !item.readAt).length
  const displayName = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ') || user.email
  const initials = displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  const dismissNotification = (id: number) => {
    api.dismissNotification(id).then(() => setNotifications((current) => current.filter((item) => item.id !== id))).catch((caught) => {
      setNotificationError(caught instanceof Error ? caught.message : 'Impossible de supprimer la notification.')
    })
  }
  const openResult = (result: SearchResult) => { onNavigate(result.view as View); setSearchOpen(false); setSearchQuery('') }
  const openNotification = useCallback(async (notification: Notification) => {
    setNotificationError('')
    try {
      if (!notification.readAt) await api.markNotificationRead(notification.id)
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item))
    } catch (caught) {
      setNotificationError(caught instanceof Error ? caught.message : 'Impossible de marquer la notification comme lue.')
    }
    if (notification.link) {
      const target = new URL(notification.link, window.location.origin)
      const segments = target.pathname.split('/').filter(Boolean)
      const route = segments[0]
      const views: View[] = ['dashboard', 'collaboration-home', 'collaboration-requests', 'reports', 'products', 'prospects', 'subscription', 'community', 'messages', 'wallet', 'commissions', 'profile', 'account-settings', 'admin-dashboard', 'admin-applications', 'admin-reports', 'admin-collaboration', 'admin-withdrawals', 'admin-products', 'admin-prospects', 'admin-subscriptions', 'admin-settings', 'admin-community', 'admin-security']
      const collaborationDealId = route === 'collaboration' && Number.isSafeInteger(Number(segments[1]))
        ? Number(segments[1])
        : undefined
      const view: View | null = collaborationDealId
        ? segments[2] === 'access-requests'
          ? 'collaboration-requests'
          : segments[2] === 'closing-report'
            ? 'collaboration-closing-report'
            : 'collaboration-detail'
        : route && views.includes(route as View) ? route as View : null
      if (view) {
        window.dispatchEvent(new CustomEvent('avanceo:open-notification', {
          detail: {
            view,
            dealId: collaborationDealId,
            postId: Number(target.searchParams.get('postId')) || undefined,
            conversationId: Number(target.searchParams.get('conversationId')) || undefined,
          },
        }))
      }
    }
    setOpen(false)
  }, [])
  useEffect(() => {
    if (user.role !== 'AGENT' || !('serviceWorker' in navigator)) return

    const handlePushMessage = (event: MessageEvent<{ type?: string; notificationId?: number }>) => {
      if (event.data?.type !== 'PUSH_NOTIFICATION_CLICK' || !Number.isInteger(event.data.notificationId)) return
      api.notifications().then((data) => {
        setNotifications(data)
        const notification = data.find((item) => item.id === event.data.notificationId)
        if (notification) void openNotification(notification)
      }).catch((caught) => {
        setNotificationError(caught instanceof Error ? caught.message : 'Impossible d’ouvrir cette notification.')
      })
    }

    navigator.serviceWorker.addEventListener('message', handlePushMessage)
    const url = new URL(window.location.href)
    const notificationId = Number(url.searchParams.get('pushNotificationId'))
    if (Number.isInteger(notificationId) && notificationId > 0) {
      url.searchParams.delete('pushNotificationId')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      api.notifications().then((data) => {
        setNotifications(data)
        const notification = data.find((item) => item.id === notificationId)
        if (notification) void openNotification(notification)
      }).catch((caught) => {
        setNotificationError(caught instanceof Error ? caught.message : 'Impossible d’ouvrir cette notification.')
      })
    }

    return () => navigator.serviceWorker.removeEventListener('message', handlePushMessage)
  }, [openNotification, user.id, user.role])
  return (
    <header className="topbar">
      <button className="mobile-menu-button" type="button" aria-label={localize('Ouvrir le menu principal')} onClick={onMobileMenu}><Menu size={22} /></button>
      <div className="desktop-topbar-brand">
        <img src={tySyNdayLogo} alt="" />
        <button className="desktop-search-trigger" type="button" aria-label={localize('Rechercher')} onClick={() => setSearchOpen((current) => !current)}><Search size={18} /><span>{localize('Rechercher')}</span></button>
      </div>
      <nav className="desktop-topbar-shortcuts" aria-label={localize('Accès rapides')}>
        {view.startsWith('admin-') ? (
          <>
            <button className={view === 'admin-dashboard' ? 'active' : ''} type="button" aria-label={localize('Tableau de bord')} onClick={() => onNavigate('admin-dashboard')}><LayoutDashboard size={23} /></button>
            <button className={view === 'admin-applications' ? 'active' : ''} type="button" aria-label={localize('Inscriptions')} onClick={() => onNavigate('admin-applications')}><UsersRound size={23} /></button>
            <button className={view === 'admin-reports' ? 'active' : ''} type="button" aria-label={localize('Rapports')} onClick={() => onNavigate('admin-reports')}><ClipboardList size={23} /></button>
            <button className={view === 'admin-products' ? 'active' : ''} type="button" aria-label={localize('Produits')} onClick={() => onNavigate('admin-products')}><PackageOpen size={23} /></button>
            <button className={view === 'admin-settings' ? 'active' : ''} type="button" aria-label={localize('Paramètres')} onClick={() => onNavigate('admin-settings')}><Settings size={23} /></button>
          </>
        ) : (
          <>
            <button className={view === 'collaboration-home' || view === 'collaboration-detail' ? 'active' : ''} type="button" aria-label={localize('Mes prospects')} onClick={() => onNavigate('collaboration-home')}><MapPinned size={23} /></button>
            <button className={view === 'reports' ? 'active' : ''} type="button" aria-label={localize('Rapports')} onClick={() => onNavigate('reports')}><ClipboardList size={23} /></button>
            <button className={view === 'products' ? 'active' : ''} type="button" aria-label={localize('Produits')} onClick={() => onNavigate('products')}><Grid2X2 size={23} /></button>
            <button className={view === 'community' ? 'active' : ''} type="button" aria-label={localize('Communauté')} onClick={() => onNavigate('community')}><UsersRound size={23} /></button>
            <button className={view === 'messages' ? 'active' : ''} type="button" aria-label={`${localize('Messages')}${messageUnread > 0 ? `, ${messageUnread} ${localize('non lus')}` : ''}`} onClick={() => onNavigate('messages')}><MessageCircle size={23} />{messageUnread > 0 && <em className="topbar-badge">{messageUnread > 99 ? '99+' : messageUnread}</em>}</button>
          </>
        )}
      </nav>
      <div className="top-actions">
        <span className={apiOnline ? 'connection online' : 'connection'} aria-label={localize(apiOnline ? 'Connecté' : 'Mode démo')}><i /></span>
        {user.role !== 'AGENT' && <>
          <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-pressed={theme === 'dark'} aria-label={localize(theme === 'light' ? 'Activer le thème sombre' : 'Activer le thème clair')}>{theme === 'light' ? '☾' : '☀'}<span>{localize(theme === 'light' ? 'Sombre' : 'Clair')}</span></button>
          <button className="icon-button mobile-theme-toggle" type="button" onClick={onToggleTheme} aria-pressed={theme === 'dark'} aria-label={localize(theme === 'light' ? 'Activer le thème sombre' : 'Activer le thème clair')}>{theme === 'light' ? <Moon size={21} strokeWidth={1.8} /> : <Sun size={21} strokeWidth={1.8} />}</button>
        </>}
        {!view.startsWith('admin-') && <button className="icon-button mobile-community-action" type="button" aria-label={localize('Ouvrir la communauté')} onClick={() => onNavigate('community')}><UsersRound size={21} strokeWidth={1.8} /></button>}
        <div className="global-search-wrap">
          <button className="icon-button desktop-search-icon" aria-label={localize('Rechercher')} aria-expanded={searchOpen} onClick={() => setSearchOpen((current) => !current)}><Search size={20} /></button>
          {searchOpen && <div className="global-search-popover"><div className="global-search-input"><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={localize(view.startsWith('admin-') ? 'Rapports, candidatures, produits...' : 'Mes rapports, catalogue...')} aria-label={localize('Recherche globale')} /><button className="notification-dismiss" aria-label={localize('Fermer la recherche')} onClick={() => setSearchOpen(false)}>×</button></div>
            {searchQuery.trim().length < 2 ? <p className="global-search-hint">{localize('Saisissez au moins deux caractères.')}</p> : searching ? <p className="global-search-hint">{localize('Recherche...')}</p> : searchError ? <p className="global-search-hint search-error">{localize(searchError)}</p> : searchResults.length === 0 ? <p className="global-search-hint">{localize('Aucun résultat.')}</p> : <div className="global-search-results">{searchResults.map((result) => <button key={result.id} onClick={() => openResult(result)}><strong>{result.title}</strong><span>{localize(result.detail)}</span></button>)}</div>}
          </div>}
        </div>
        {!view.startsWith('admin-') && <button className="icon-button mobile-top-action" type="button" aria-label={`${localize('Ouvrir les messages')}${messageUnread > 0 ? `, ${messageUnread} ${localize('non lus')}` : ''}`} onClick={() => onNavigate('messages')}><MessageCircle size={21} strokeWidth={1.8} />{messageUnread > 0 && <em className="topbar-badge">{messageUnread > 99 ? '99+' : messageUnread}</em>}</button>}
        <div className="notification-wrap">
          <button className="icon-button notification" type="button" aria-label={unread ? `${localize('Notifications')}, ${unread} ${localize('non lues')}` : localize('Notifications')} aria-expanded={open} onClick={() => setOpen((current) => !current)}><Bell className="notification-bell" size={21} strokeWidth={1.8} />{unread > 0 && <em>{unread > 99 ? '99+' : unread}</em>}</button>
          {open && <div className="notification-popover">
            <div className="notification-heading"><div><strong>{localize('Notifications')}</strong><small>{unread ? `${unread} ${localize(unread > 1 ? 'non lues' : 'non lue')}` : localize('Vous êtes à jour')}</small></div><button className="notification-dismiss" type="button" aria-label={localize('Fermer le panneau des notifications')} onClick={() => setOpen(false)}><X size={17} /></button></div>
            {notificationError && <p className="global-search-hint search-error" role="alert">{localize(notificationError)}</p>}
            {notifications.length === 0
              ? <div className="notification-empty"><span><BellRing size={21} /></span><strong>{localize('Aucune notification')}</strong><small>{localize('Vos nouvelles activités apparaîtront ici.')}</small></div>
              : <div className="notification-list">{notifications.slice(0, 10).map((item) => {
                const NotificationIcon = notificationIcon(item.type)
                const actorName = [item.actor?.agentProfile?.firstName, item.actor?.agentProfile?.lastName].filter(Boolean).join(' ')
                const actorInitials = actorName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
                return <article key={item.id} className={`notification-entry${item.readAt ? ' is-read' : ' is-unread'}`}>
                  <button type="button" className="notification-item" onClick={() => void openNotification(item)}>
                    <span className="notification-avatar" aria-hidden="true">
                      {item.actor?.agentProfile?.imageUrl
                        ? <img src={item.actor.agentProfile.imageUrl} alt="" loading="lazy" />
                        : actorInitials
                          ? <span className="notification-avatar-initials">{actorInitials}</span>
                          : <NotificationIcon size={18} />}
                      {item.actor?.role === 'AGENT' && <AgentPresenceDot userId={item.actor.id} lastActiveAt={item.actor.lastActiveAt} />}
                    </span>
                    <span className="notification-copy">
                      <span className="notification-item-topline"><b>{localize(item.title)}</b>{!item.readAt && <i aria-label={localize('Non lue')} />}</span>
                      <span className="notification-item-body">{localize(item.body)}</span>
                      <span className="notification-item-meta">{actorName && <span>{actorName}</span>}<time dateTime={item.createdAt}>{notificationTime(item.createdAt)}</time></span>
                    </span>
                  </button>
                  <button className="notification-dismiss" type="button" aria-label={`${localize('Supprimer la notification')} ${localize(item.title)}`} onClick={() => dismissNotification(item.id)}><X size={15} /></button>
                </article>
              })}</div>}
          </div>}
        </div>
        <span className="top-avatar-wrap">
          <button className="top-avatar top-avatar-button" type="button" aria-label={localize('Ouvrir mon profil')} onClick={() => onNavigate(view.startsWith('admin-') ? 'admin-dashboard' : 'profile')}>
            {user.role === 'AGENT' && user.profile?.imageUrl
              ? <img className="top-avatar-photo" src={user.profile.imageUrl} alt="" />
              : initials || <UserRound size={18} />}
          </button>
          {user.role === 'AGENT' && <AgentPresenceDot userId={user.id} className="profile-online-dot" />}
        </span>
      </div>
    </header>
  )
}
