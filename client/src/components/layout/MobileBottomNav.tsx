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
import { useI18n } from '../../i18n'

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
  { id: 'community', label: 'Communauté', icon: UsersRound },
]

const adminItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'admin-dashboard', label: 'Accueil', icon: LayoutDashboard },
  { id: 'admin-applications', label: 'Inscriptions', icon: UsersRound },
  { id: 'admin-reports', label: 'Rapports', icon: ClipboardCheck },
  { id: 'admin-withdrawals', label: 'Retraits', icon: WalletCards },
]

export default function MobileBottomNav({ admin, view, onNavigate, pendingRequestCount = 0 }: MobileBottomNavProps) {
  const { t } = useI18n()
  const items = admin ? adminItems : agentItems
  const localize = admin ? (text: string) => text : t

  return (
    <nav className={`mobile-bottom-nav ${admin ? 'mobile-bottom-nav-admin' : 'mobile-bottom-nav-agent'}`} aria-label={localize('Navigation principale mobile')}>
      <div className="mobile-bottom-nav-inner">
        {items.map(({ id, label, icon: Icon }) => {
          const active = view === id
            || (id === 'collaboration-home' && view === 'collaboration-detail')
            || (id === 'collaboration-closer-accesses' && ['collaboration-closing-report', 'collaboration-lost'].includes(view))
          const badgeCount = id === 'collaboration-requests' ? pendingRequestCount : 0
          const accessibleLabel = badgeCount > 0
            ? `${localize(label)}, ${badgeCount >= 200 ? localize('au moins 200') : badgeCount} ${localize('demandes en attente')}`
            : localize(label)
          const badgeLabel = badgeCount >= 200 ? '200+' : badgeCount

          return (
            <button key={id} type="button" aria-current={active ? 'page' : undefined} className={active ? 'mobile-bottom-item active' : 'mobile-bottom-item'} onClick={() => onNavigate(id)} aria-label={accessibleLabel}>
              <span className="mobile-bottom-icon"><Icon size={21} strokeWidth={1.8} />
                {badgeCount > 0 && <span className="mobile-request-badge">{badgeLabel}</span>}
              </span>
              <span>{localize(label)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
