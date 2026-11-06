export type View = 'dashboard' | 'collaboration-home' | 'collaboration-requests' | 'collaboration-detail' | 'collaboration-closer-prospects' | 'collaboration-closer-accesses' | 'collaboration-closing-report' | 'collaboration-lost' | 'reports' | 'products' | 'prospects' | 'subscription' | 'community' | 'messages' | 'wallet' | 'commissions' | 'profile' | 'admin-dashboard' | 'admin-applications' | 'admin-reports' | 'admin-withdrawals' | 'admin-products' | 'admin-prospects' | 'admin-subscriptions' | 'admin-settings' | 'admin-community' | 'admin-collaboration' | 'admin-security'

export type ReportNature = 'CONTACT' | 'RENDEZ_VOUS' | 'CONTRAT'
export type ReportType = 'LEAD' | 'PROVIDED_CONTACT' | 'FULL_CYCLE'

export type Report = {
  id: number
  companyName: string
  product: { title: string } | null
  customServiceDescription?: string | null
  status: string
  meetingAt: string
  interestLevel: string
  reportNature?: ReportNature
  reportType?: ReportType
  promoCode?: string | null
  contractSigned?: boolean
  commissionAmount?: number | null
  commissionEstimated?: boolean
}
