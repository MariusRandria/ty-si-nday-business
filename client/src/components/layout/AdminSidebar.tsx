import type { View } from '../../types/report'
import { notify } from '../../utils/toast'
import { confirmAction } from '../../utils/confirmation'
import { BadgeCheck, LayoutDashboard, UsersRound, ClipboardCheck, WalletCards, PackageOpen, Settings, MessagesSquare, LogOut, X, MapPinned, ClipboardList, ShieldCheck } from 'lucide-react'
import tySyNdayLogo from '../../assets/TD.png'

const items: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'admin-dashboard', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { id: 'admin-applications', label: 'Validation inscriptions', icon: UsersRound },
  { id: 'admin-reports', label: 'Rapports à traiter', icon: ClipboardCheck },
  { id: 'admin-collaboration', label: 'Vérification des ventes', icon: ClipboardList },
  { id: 'admin-withdrawals', label: 'Retraits', icon: WalletCards },
  { id: 'admin-products', label: 'Catalogue produits', icon: PackageOpen },
  { id: 'admin-prospects', label: 'Contacts prospects', icon: MapPinned },
  { id: 'admin-subscriptions', label: 'Demandes badge', icon: BadgeCheck },
  { id: 'admin-settings', label: 'Paramètres', icon: Settings },
  { id: 'admin-security', label: 'Code administrateur', icon: ShieldCheck },
  { id: 'admin-community', label: 'Communauté', icon: MessagesSquare },
]
const desktopShortcutItems = new Set<View>(['admin-dashboard', 'admin-applications', 'admin-reports', 'admin-products', 'admin-settings'])
const mobileShortcutItems = new Set<View>(['admin-dashboard', 'admin-applications', 'admin-reports', 'admin-withdrawals'])
export default function AdminSidebar({ view, onNavigate, mobileOpen, onMobileClose }: { view: View; onNavigate: (view: View) => void; mobileOpen: boolean; onMobileClose: () => void }) {
  async function logout() {
    const confirmed = await confirmAction({ title: 'Se déconnecter ?', message: 'Votre session administration sera fermée sur cet appareil.', confirmLabel: 'Se déconnecter' })
    if (!confirmed) return
    window.localStorage.removeItem('innovcom-token')
    window.localStorage.removeItem('innovcom-user')
    notify('Vous êtes déconnecté.', 'info')
    window.setTimeout(() => window.location.reload(), 600)
  }

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Navigation administration">
      <button className="mobile-sidebar-close" type="button" aria-label="Fermer le menu" onClick={onMobileClose}><X size={22} /></button>
      <a className="brand" href="/" aria-label="Ty sy Nday Business"><img src={tySyNdayLogo} alt="" /><span>TY SY NDAY <small>Business</small></span></a>
      {/* <div className="profile-mini"><div className="avatar admin-avatar">AD</div><div><strong>Administration</strong><span>Ty sy Nday Business</span></div></div> */}
      <nav className="main-nav" aria-label="Navigation principale"><span className="nav-caption">ADMINISTRATION</span>{items.map(({ id, label, icon: Icon }) => <button className={`nav-item${view === id ? ' active' : ''}${desktopShortcutItems.has(id) ? ' nav-item-desktop-shortcut' : ''}${mobileShortcutItems.has(id) ? ' nav-item-mobile-shortcut' : ''}`} aria-current={view === id ? 'page' : undefined} key={id} onClick={() => onNavigate(id)}><Icon size={19} strokeWidth={1.7} />{label}</button>)}</nav>
      <div className="sidebar-bottom"><button className="logout" onClick={() => void logout()}><LogOut size={18} />Se déconnecter</button></div>
    </aside>
  )
}
