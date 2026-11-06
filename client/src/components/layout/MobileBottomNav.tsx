import {
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  BriefcaseBusiness,
  LayoutDashboard,
  Inbox,
  MapPinned,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import type { View } from '../../types/report'

type MobileBottomNavProps = {
  admin: boolean
  view: View
  onNavigate: (view: View) => void
  pendingRequestCount?: number
}

const agentItems: { id: View; label: string; icon: typeof BarChart3 }[] = [
  { id: 'collaboration-home', label: 'Prospects', icon: MapPinned },
  { id: 'collaboration-closer-accesses', label: 'Mes accès', icon: BriefcaseBusiness },
  { id: 'collaboration-requests', label: 'Demandes', icon: Inbox },
  { id: 'reports', label: 'Rapports', icon: ClipboardList },
  { id: 'commissions', label: 'Commissions', icon: WalletCards },
]

const adminItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'admin-dashboard', label: 'Accueil', icon: LayoutDashboard },
  { id: 'admin-applications', label: 'Inscriptions', icon: UsersRound },
  { id: 'admin-reports', label: 'Rapports', icon: ClipboardCheck },
  { id: 'admin-withdrawals', label: 'Retraits', icon: WalletCards },
]

export default function MobileBottomNav({ admin, view, onNavigate, pendingRequestCount = 0 }: MobileBottomNavProps) {
  const items = admin ? adminItems : agentItems

  return (
    <nav className={`mobile-bottom-nav ${admin ? 'mobile-bottom-nav-admin' : 'mobile-bottom-nav-agent'}`} aria-label="Navigation principale mobile">
      <div className="mobile-bottom-nav-inner">
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={(view === id || (id === 'collaboration-home' && view === 'collaboration-detail') || (id === 'collaboration-closer-accesses' && ['collaboration-closing-report', 'collaboration-lost'].includes(view))) ? 'page' : undefined} className={(view === id || (id === 'collaboration-home' && view === 'collaboration-detail') || (id === 'collaboration-closer-accesses' && ['collaboration-closing-report', 'collaboration-lost'].includes(view))) ? 'mobile-bottom-item active' : 'mobile-bottom-item'} onClick={() => onNavigate(id)} aria-label={id === 'collaboration-requests' && pendingRequestCount > 0 ? `${label}, ${pendingRequestCount >= 200 ? 'au moins 200' : pendingRequestCount} demandes en attente` : label}>
            <span className="mobile-bottom-icon"><Icon size={21} strokeWidth={1.8} />
              {id === 'collaboration-requests' && pendingRequestCount > 0 && <span className="mobile-request-badge">{pendingRequestCount >= 200 ? '200+' : pendingRequestCount}</span>}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
