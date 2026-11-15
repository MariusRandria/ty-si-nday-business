import { useEffect, useState } from 'react'
import type { View } from '../../types/report'
import { notify } from '../../utils/toast'
import { confirmAction } from '../../utils/confirmation'
import api, { type SessionUser } from '../../api/client'
import { BadgeCheck, BarChart3, ChevronRight, ClipboardList, Grid2X2, Inbox, MessagesSquare, WalletCards, UserRound, LogOut, X, MapPinned, BriefcaseBusiness, Settings, ShoppingBag } from 'lucide-react'
import { useI18n } from '../../i18n'
import { SubscriberBadge } from '../ui/SubscriberBadge'

const navItems: { id: View; label: string; icon: typeof BarChart3 }[] = [
  { id: 'dashboard', label: 'Vue d’ensemble', icon: BarChart3 },
  { id: 'collaboration-home', label: 'Mes prospects', icon: MapPinned },
  { id: 'collaboration-closer-prospects', label: 'Prospects disponibles', icon: MapPinned },
  { id: 'collaboration-closer-accesses', label: 'Mes accès', icon: BriefcaseBusiness },
  { id: 'collaboration-requests', label: 'Demandes d’accès', icon: Inbox },
  { id: 'reports', label: 'Mes rapports', icon: ClipboardList },
  { id: 'products', label: 'Catalogue produits', icon: Grid2X2 },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
  { id: 'prospects', label: 'Contacts prospects', icon: MapPinned },
  { id: 'subscription', label: 'Badge abonné', icon: BadgeCheck },
  { id: 'community', label: 'Communauté', icon: MessagesSquare },
  { id: 'messages', label: 'Messages privés', icon: MessagesSquare },
  { id: 'commissions', label: 'Mes commissions', icon: WalletCards },
]
const desktopShortcutItems = new Set<View>(['collaboration-home', 'reports', 'products', 'community', 'messages'])
const mobileShortcutItems = new Set<View>(['collaboration-home', 'collaboration-closer-accesses', 'collaboration-requests', 'reports', 'commissions', 'community', 'messages'])

export default function Sidebar({ view, onNavigate, mobileOpen, onMobileClose, user, pendingRequestCount = 0 }: { view: View; onNavigate: (view: View) => void; mobileOpen: boolean; onMobileClose: () => void; user: SessionUser; pendingRequestCount?: number }) {
  const { t } = useI18n()
  const [isSubscriber, setIsSubscriber] = useState(false)
  const fullName = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ') || user.email
  const initials = fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  useEffect(() => {
    let active = true
    const refreshSubscriberStatus = () => {
      api.subscriptionOverview()
        .then((overview) => { if (active) setIsSubscriber(Boolean(overview.current)) })
        .catch((caught) => { if (active) console.error('Impossible de vérifier le statut du badge abonné dans la navigation.', caught) })
    }
    refreshSubscriberStatus()
    const interval = window.setInterval(refreshSubscriberStatus, 60_000)
    window.addEventListener('focus', refreshSubscriberStatus)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshSubscriberStatus)
    }
  }, [user.id])

  async function logout() {
    const confirmed = await confirmAction({ title: t('Se déconnecter ?'), message: t('Votre session agent sera fermée sur cet appareil.'), confirmLabel: t('Se déconnecter') })
    if (!confirmed) return
    window.localStorage.removeItem('innovcom-token')
    window.localStorage.removeItem('innovcom-user')
    notify('Vous êtes déconnecté.', 'info')
    window.setTimeout(() => window.location.reload(), 600)
  }

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Navigation de l’espace agent">
      <button className="mobile-sidebar-close" type="button" aria-label="Fermer le menu" onClick={onMobileClose}><X size={22} /></button>
      <button className="profile-mini mobile-profile-link" type="button" aria-label={`${t('Ouvrir mon profil')} : ${fullName}`} onClick={() => onNavigate('profile')}>
        <span className="avatar mobile-profile-avatar">
          {user.profile?.imageUrl ? <img src={user.profile.imageUrl} alt="" /> : initials}
        </span>
        <span className="mobile-profile-info">
          <strong>{fullName}</strong>
          {isSubscriber && <SubscriberBadge />}
        </span>
        <span className="mobile-profile-chevron"><ChevronRight size={18} aria-hidden="true" /></span>
      </button>
      <nav className="main-nav" aria-label="Navigation principale">
        <span className="nav-caption">{t('ESPACE AGENT')}</span>
        {navItems.map(({ id, label, icon: Icon }) => {
          const active = view === id
            || (id === 'collaboration-home' && view === 'collaboration-detail')
            || (id === 'collaboration-closer-prospects' && view === 'collaboration-closer-prospects')
            || (id === 'collaboration-closer-accesses' && ['collaboration-closer-accesses', 'collaboration-closing-report', 'collaboration-lost'].includes(view))
          return (
            <button key={id} className={`nav-item${active ? ' active' : ''}${desktopShortcutItems.has(id) ? ' nav-item-desktop-shortcut' : ''}${mobileShortcutItems.has(id) ? ' nav-item-mobile-shortcut' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => onNavigate(id)}>
              <Icon size={19} strokeWidth={1.7} />{t(label)}
              {id === 'collaboration-requests' && pendingRequestCount > 0 && (
                <span className="nav-badge collaboration-pending-badge" aria-label={`${pendingRequestCount >= 200 ? 'Au moins 200' : pendingRequestCount} demandes en attente`}>
                  {pendingRequestCount >= 200 ? '200+' : pendingRequestCount}
                </span>
              )}
            </button>
          )
        })}
        <span className="nav-caption second">{t('MON ESPACE')}</span>
        <button className={`nav-item${view === 'wallet' ? ' active' : ''}`} aria-current={view === 'wallet' ? 'page' : undefined} onClick={() => onNavigate('wallet')}><WalletCards size={19} strokeWidth={1.7} />{t('Portefeuille')}</button>
        <button className={`nav-item${view === 'profile' ? ' active' : ''} nav-item-mobile-shortcut`} aria-current={view === 'profile' ? 'page' : undefined} onClick={() => onNavigate('profile')}><UserRound size={19} strokeWidth={1.7} />{t('Mon profil')}</button>
        <button className={`nav-item${view === 'account-settings' ? ' active' : ''}`} aria-current={view === 'account-settings' ? 'page' : undefined} onClick={() => onNavigate('account-settings')}><Settings size={19} strokeWidth={1.7} />{t('Paramètres du compte')}</button>
      </nav>
      <div className="sidebar-bottom">
        {/* <div className="help-card"><LifeBuoy size={22} /><strong>Besoin d’aide ?</strong><p>Notre équipe vous accompagne dans vos projets.</p><button onClick={() => notify('Votre demande a été envoyée à l’équipe support.', 'success')}>Contacter l’équipe</button></div> */}
        <button className="logout" onClick={() => void logout()}><LogOut size={18} />{t('Se déconnecter')}</button>
      </div>
    </aside>
  )
}
