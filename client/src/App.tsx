import { lazy, useEffect, useState } from 'react'
import api, { ApiRequestError, type CollaborationSuppliedDeal } from './api/client'
const Sidebar = lazy(() => import('./components/layout/Sidebar'))
const Topbar = lazy(() => import('./components/layout/Topbar'))
const MobileBottomNav = lazy(() => import('./components/layout/MobileBottomNav'))
const NewReportModal = lazy(() => import('./components/reports/CreateReportModal'))
const CommunityPage = lazy(() => import('./pages/CommunityPage'))
const CommunityChat = lazy(() => import('./pages/CommunityChat'))
const ProspectsPage = lazy(() => import('./pages/ProspectsPage'))
const SubscriptionPage = lazy(() => import('./pages/SubscriptionPage'))
const ProductsPage = lazy(() => import('./pages/ProductsPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const DashboardPage = lazy(() => import('./pages/AgentPages').then(({ DashboardPage }) => ({ default: DashboardPage })))
const ProfilePage = lazy(() => import('./pages/AgentPages').then(({ ProfilePage }) => ({ default: ProfilePage })))
const WalletPage = lazy(() => import('./pages/AgentPages').then(({ WalletPage }) => ({ default: WalletPage })))
const AdminSidebar = lazy(() => import('./components/layout/AdminSidebar'))
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardLivePage'))
const AdminApplicationsPage = lazy(() => import('./pages/admin/AdminApplicationsPage'))
const AdminReportsPage = lazy(() => import('./pages/admin/AdminReportsPage'))
const AdminWithdrawalsPage = lazy(() => import('./pages/admin/AdminWithdrawalsPage'))
const AdminProductsPage = lazy(() => import('./pages/admin/AdminProductsPage'))
const AdminProspectsPage = lazy(() => import('./pages/admin/AdminProspectsPage'))
const AdminSubscriptionsPage = lazy(() => import('./pages/admin/AdminSubscriptionsPage'))
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage'))
const AdminCommunityPage = lazy(() => import('./pages/admin/AdminCommunityPage'))
const AdminCollaborationReviewPage = lazy(() => import('./pages/admin/AdminCollaborationReviewPage'))
const AdminTotpPage = lazy(() => import('./pages/admin/AdminTotpPage'))
import type { Report, View } from './types/report'
import type { SessionUser } from './api/client'
import { FeedbackCenter } from './components/ui/FeedbackCenter'
const AuthPage = lazy(() => import('./pages/AuthPage'))
const ActivateAccountPage = lazy(() => import('./pages/ActivateAccountPage'))
const CollaborationCommissionsPage = lazy(() => import('./pages/CollaborationCommissionsPage'))
const CollaborationSupplierHomePage = lazy(() => import('./pages/CollaborationSupplierHomePage'))
const CollaborationAccessRequestsPage = lazy(() => import('./pages/CollaborationAccessRequestsPage'))
const CollaborationSupplierDetailPage = lazy(() => import('./pages/CollaborationSupplierDetailPage'))
const CollaborationProspectsPage = lazy(() => import('./pages/CollaborationProspectsPage'))
const CollaborationCloserAccessesPage = lazy(() => import('./pages/CollaborationCloserAccessesPage'))
const CollaborationClosingReportPage = lazy(() => import('./pages/CollaborationClosingReportPage'))
const CollaborationLostPage = lazy(() => import('./pages/CollaborationLostPage'))
import ClientConfirmationPage from './pages/ClientConfirmationPage'
import './App.css'
import './console-redesign.css'

function readStoredUser(): SessionUser | null {
  try {
    const raw = window.localStorage.getItem('innovcom-user')
    return raw ? JSON.parse(raw) as SessionUser : null
  } catch {
    window.localStorage.removeItem('innovcom-user')
    window.localStorage.removeItem('innovcom-token')
    return null
  }
}

function getPortalFromLocation(): 'agent' | 'admin' {
  return window.location.port === '5175' ? 'admin' : 'agent'
}

function isAdminRole(role?: string | null): boolean {
  return !!role && ['ADMIN', 'SUPER_ADMIN'].includes(role)
}

function getInitialTheme(): 'light' | 'dark' {
  const savedTheme = window.localStorage.getItem('innovcom-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function AuthenticatedApp() {
  const portal: 'agent' | 'admin' = getPortalFromLocation()
  const storedUser = readStoredUser()
  const storedIsAdmin = storedUser ? isAdminRole(storedUser.role) : false
  const initialIsAdmin = portal === 'admin' ? storedIsAdmin : false
  const [view, setView] = useState<View>(initialIsAdmin ? 'admin-dashboard' : 'collaboration-home')
  const [notificationTarget, setNotificationTarget] = useState<{ postId?: number; conversationId?: number; dealId?: number } | null>(null)
  const [selectedCollaborationDeal, setSelectedCollaborationDeal] = useState<CollaborationSuppliedDeal | null>(null)
  const [selectedCollaborationDealId, setSelectedCollaborationDealId] = useState<number | null>(null)
  const [selectedCloserDealStatus, setSelectedCloserDealStatus] = useState<string | null>(null)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [reports, setReports] = useState<Report[]>([])
  const [apiOnline, setApiOnline] = useState(false)
  const [showNewReport, setShowNewReport] = useState(false)
  const [session, setSession] = useState<{ token: string; user: SessionUser } | null>(() => {
    const token = window.localStorage.getItem('innovcom-token')
    const user = readStoredUser()
    if (!token || !user) return null
    const userIsAdmin = isAdminRole(user.role)
    return (portal === 'admin') === userIsAdmin ? { token, user } : null
  })
  const [isAdmin, setIsAdmin] = useState(initialIsAdmin)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme)
  const reloadReports = () => api.reports().then(setReports).catch(() => undefined)
  useEffect(() => {
    if (!mobileNavOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = ''
    }
  }, [mobileNavOpen])
  const navigate = (nextView: View) => {
    setNotificationTarget(null)
    if (!['collaboration-detail', 'collaboration-closing-report', 'collaboration-lost'].includes(nextView)) {
      setSelectedCollaborationDeal(null)
      setSelectedCollaborationDealId(null)
      setSelectedCloserDealStatus(null)
    }
    setView(nextView)
    setMobileNavOpen(false)
  }
  const openCollaborationDeal = (dealId: number, deal: CollaborationSuppliedDeal | null = null) => {
    setNotificationTarget(null)
    setSelectedCollaborationDealId(dealId)
    setSelectedCollaborationDeal(deal)
    setSelectedCloserDealStatus(null)
    setView('collaboration-detail')
    setMobileNavOpen(false)
  }
  const openCloserDealAction = (dealId: number, dealStatus: string, nextView: 'collaboration-closing-report' | 'collaboration-lost') => {
    setNotificationTarget(null)
    setSelectedCollaborationDeal(null)
    setSelectedCollaborationDealId(dealId)
    setSelectedCloserDealStatus(dealStatus)
    setView(nextView)
    setMobileNavOpen(false)
  }
  const toggleTheme = () => setTheme((current) => { const next = current === 'light' ? 'dark' : 'light'; window.localStorage.setItem('innovcom-theme', next); return next })
  const handleLogin = (token: string, user: SessionUser) => { const userIsAdmin = isAdminRole(user.role); if ((portal === 'admin') !== userIsAdmin) return false; window.localStorage.setItem('innovcom-token', token); window.localStorage.setItem('innovcom-user', JSON.stringify(user)); setSession({ token, user }); setIsAdmin(userIsAdmin); setPendingRequestCount(0); setView(userIsAdmin ? 'admin-dashboard' : 'collaboration-home'); return true }
  useEffect(() => {
    const user = readStoredUser()
    if (!user) return
    if ((portal === 'admin') !== isAdminRole(user.role)) {
      window.localStorage.removeItem('innovcom-token')
      window.localStorage.removeItem('innovcom-user')
      setSession(null)
      setIsAdmin(false)
      setView('collaboration-home')
    }
  }, [portal])
  const sessionToken = session?.token
  useEffect(() => {
    if (!sessionToken || isAdmin) return
    let active = true
    let errorNotified = false
    const refresh = async () => {
      try {
        const requests = await api.collaborationPendingAccessRequests()
        if (active) {
          setPendingRequestCount(requests.length)
          errorNotified = false
        }
      } catch (caught) {
        if (!active) return
        if (caught instanceof ApiRequestError && caught.status === 401) {
          window.localStorage.removeItem('innovcom-token')
          window.localStorage.removeItem('innovcom-user')
          setSession(null)
          setIsAdmin(false)
          return
        }
        if (!errorNotified) {
          const message = caught instanceof ApiRequestError && caught.status === 429
            ? 'La mise à jour des demandes est temporairement limitée.'
            : 'Impossible d’actualiser le nombre de demandes en attente.'
          window.dispatchEvent(new CustomEvent('innovcom:toast', { detail: { message, tone: 'error' } }))
          errorNotified = true
        }
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    window.addEventListener('collaboration:requests-updated', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('collaboration:requests-updated', refresh)
    }
  }, [sessionToken, isAdmin])
  useEffect(() => {
    api.health().then(setApiOnline).catch(() => setApiOnline(false))
    if (!session) return
    api.reports().then(setReports).catch((caught) => {
      if (caught instanceof ApiRequestError && caught.status === 401) {
        window.localStorage.removeItem('innovcom-token')
        window.localStorage.removeItem('innovcom-user')
        setSession(null)
        setIsAdmin(false)
        return
      }
      const message = caught instanceof Error ? caught.message : 'Impossible de charger les rapports.'
      window.dispatchEvent(new CustomEvent('innovcom:toast', { detail: { message, tone: 'error' } }))
    })
  }, [session?.token])
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ view: View; postId?: number; conversationId?: number; dealId?: number }>).detail
      setNotificationTarget({ postId: detail.postId, conversationId: detail.conversationId, dealId: detail.dealId })
      if (detail.dealId) {
        setSelectedCollaborationDealId(detail.dealId)
        setSelectedCollaborationDeal(null)
      }
      setView(detail.view)
    }
    window.addEventListener('avanceo:open-notification', handler)
    return () => window.removeEventListener('avanceo:open-notification', handler)
  }, [])
  const visibleReports = reports
  if (!session) {
    const params = new URLSearchParams(window.location.search)
    const activationToken = params.get('activationToken')
    if (activationToken) return <ActivateAccountPage email={params.get('activationEmail') ?? ''} token={activationToken} onLogin={handleLogin} />
    return <AuthPage onLogin={handleLogin} portal={portal} />
  }
  if (isAdmin) {
    const adminPage = view === 'admin-dashboard' ? <AdminDashboardPage onNavigate={navigate} /> : view === 'admin-applications' ? <AdminApplicationsPage /> : view === 'admin-reports' ? <AdminReportsPage /> : view === 'admin-collaboration' ? <AdminCollaborationReviewPage /> : view === 'admin-security' ? <AdminTotpPage /> : view === 'admin-withdrawals' ? <AdminWithdrawalsPage /> : view === 'admin-products' ? <AdminProductsPage /> : view === 'admin-prospects' ? <AdminProspectsPage /> : view === 'admin-subscriptions' ? <AdminSubscriptionsPage /> : view === 'admin-community' ? <AdminCommunityPage /> : <AdminSettingsPage />
    return <div className={`app-shell theme-${theme} ${mobileNavOpen ? 'mobile-nav-open' : ''}`}><AdminSidebar view={view} onNavigate={navigate} mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} /><button className="mobile-nav-backdrop" type="button" aria-label="Fermer le menu" onClick={() => setMobileNavOpen(false)} /><main className="main-content"><Topbar view={view} apiOnline={apiOnline} theme={theme} onToggleTheme={toggleTheme} user={session.user} onNavigate={navigate} onMobileMenu={() => setMobileNavOpen(true)} /><div className="content-wrap">{adminPage}</div></main><MobileBottomNav admin view={view} onNavigate={navigate} /><FeedbackCenter /></div>
  }
  const page = view === 'collaboration-home'
    ? <CollaborationSupplierHomePage onOpenDeal={(deal) => openCollaborationDeal(deal.dealId, deal)} onOpenRequests={() => navigate('collaboration-requests')} pendingRequestCount={pendingRequestCount} />
    : view === 'collaboration-requests'
      ? <CollaborationAccessRequestsPage onOpenDeal={(dealId) => openCollaborationDeal(dealId)} onPendingCountChange={setPendingRequestCount} />
      : view === 'collaboration-detail' && selectedCollaborationDealId !== null
        ? <CollaborationSupplierDetailPage dealId={selectedCollaborationDealId} initialDeal={selectedCollaborationDeal} onBack={() => navigate('collaboration-home')} />
        : view === 'collaboration-closer-prospects'
          ? <CollaborationProspectsPage />
          : view === 'collaboration-closer-accesses'
            ? <CollaborationCloserAccessesPage
              onOpenReport={(deal) => openCloserDealAction(deal.dealId, deal.dealStatus, 'collaboration-closing-report')}
              onDeclareLost={(deal) => openCloserDealAction(deal.dealId, deal.dealStatus, 'collaboration-lost')}
            />
            : view === 'collaboration-closing-report' && selectedCollaborationDealId !== null
            ? <CollaborationClosingReportPage dealId={selectedCollaborationDealId} dealStatus={selectedCloserDealStatus ?? 'IN_PROGRESS'} onBack={() => navigate('collaboration-closer-accesses')} onDeclareLost={() => navigate('collaboration-lost')} />
            : view === 'collaboration-lost' && selectedCollaborationDealId !== null
              ? <CollaborationLostPage dealId={selectedCollaborationDealId} onBack={() => navigate('collaboration-closing-report')} onComplete={() => navigate('collaboration-closer-accesses')} />
        : view === 'dashboard'
    ? <DashboardPage reports={visibleReports} user={session.user} onNewReport={() => setShowNewReport(true)} onViewReports={() => navigate('reports')} />
    : view === 'reports'
      ? <ReportsPage reports={visibleReports} onNewReport={() => setShowNewReport(true)} />
        : view === 'products' ? <ProductsPage /> : view === 'prospects' ? <ProspectsPage onSubscribe={() => navigate('subscription')} /> : view === 'subscription' ? <SubscriptionPage onOpenProspects={() => navigate('prospects')} /> : view === 'community' ? <CommunityPage onOpenChat={() => navigate('messages')} focusPostId={notificationTarget?.postId} currentUserId={session.user.id} /> : view === 'messages' ? <CommunityChat currentUserId={session.user.id} initialConversationId={notificationTarget?.conversationId} /> : view === 'wallet' ? <WalletPage /> : view === 'commissions' ? <CollaborationCommissionsPage /> : <ProfilePage user={session.user} onUserUpdate={(user) => { window.localStorage.setItem('innovcom-user', JSON.stringify(user)); setSession((current) => current ? { ...current, user } : current) }} />
      return <div className={`app-shell theme-${theme} ${mobileNavOpen ? 'mobile-nav-open' : ''}`}><Sidebar view={view} onNavigate={navigate} mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} pendingRequestCount={pendingRequestCount} /><button className="mobile-nav-backdrop" type="button" aria-label="Fermer le menu" onClick={() => setMobileNavOpen(false)} /><main className="main-content"><Topbar view={view} apiOnline={apiOnline} theme={theme} onToggleTheme={toggleTheme} user={session.user} onNavigate={navigate} onMobileMenu={() => setMobileNavOpen(true)} /><div className="content-wrap">{page}</div></main><MobileBottomNav admin={false} view={view} onNavigate={navigate} pendingRequestCount={pendingRequestCount} />{showNewReport && <NewReportModal user={session.user} onClose={() => setShowNewReport(false)} onSaved={reloadReports} />}<FeedbackCenter /></div>
}

export default function App() {
  const path = window.location.pathname
  if (path === '/confirmation-client' || path.startsWith('/confirmation-client/')) {
    const match = path.match(/^\/confirmation-client\/([A-Za-z0-9_-]{32})\/?$/)
    return <ClientConfirmationPage confirmationToken={match?.[1] ?? null} />
  }
  return <AuthenticatedApp />
}
