import type { Report, ReportNature, ReportType } from '../types/report'

export type NewReportInput = {
  productId: number | null
  customServiceDescription?: string
  companyName: string
  city: string
  address: string
  contactName: string
  contactRole: string
  contactPhone: string
  contactEmail?: string
  contactType: 'PRESENTIEL' | 'APPEL' | 'VISIO'
  reportNature: ReportNature
  reportType: ReportType
  meetingAt: string
  summary: string
  interestLevel: 'FAIBLE' | 'MOYEN' | 'FORT'
  nextStep?: string
}

export type GoogleAuthInput = {
  credential: string
  firstName?: string
  lastName?: string
  phone?: string
  city?: string
  consent?: boolean
}

export type Product = { id: number; title: string; description: string; targetAudience: string; salesPitch: string; status: string }
export type AdminProduct = Product & { slug: string; publishedAt: string | null; createdAt: string }
export type MarketplaceProductStatus = 'BROUILLON' | 'PUBLIE' | 'ARCHIVE'
export type MarketplaceOrderStatus = 'DEMANDEE' | 'CONFIRMEE' | 'EN_PREPARATION' | 'PRETE' | 'EXPEDIEE' | 'LIVREE' | 'ANNULEE'
export type MarketplaceDeliveryMethod = 'LIVRAISON' | 'COLIS' | 'RECUPERATION'
export type MarketplacePaymentMethod = 'MVOLA' | 'ORANGE_MONEY' | 'AIRTEL_MONEY' | 'ESPECES'
export type MarketplaceMobilePaymentMethod = Exclude<MarketplacePaymentMethod, 'ESPECES'>
export type MarketplacePaymentSettings = {
  providers: Array<{ method: MarketplaceMobilePaymentMethod; label: string; account: string | null; accountName: string | null }>
  instructions: string
}
export type AdminMarketplacePaymentSettings = {
  mvolaNumber: string | null
  mvolaAccountName: string | null
  orangeMoneyNumber: string | null
  orangeMoneyName: string | null
  airtelMoneyNumber: string | null
  airtelMoneyName: string | null
  instructions: string
}
export type MarketplaceVariant = { id: number; label: string; stock: number; isActive?: boolean }
export type MarketplaceProduct = { id: number; title: string; category: string; description: string; price: string; imageUrl: string | null; status: MarketplaceProductStatus; publishedAt: string | null; variants: MarketplaceVariant[] }
export type MarketplaceProductInput = { title: string; category: string; description: string; price: number; status: MarketplaceProductStatus; variants: Array<{ id?: number; label: string; stock: number }> }
export type MarketplaceOrderItem = { id: number; productId: number | null; variantId: number | null; productName: string; variantLabel: string; quantity: number; unitPrice: string; lineTotal: string }
export type MarketplaceOrder = {
  id: number
  agentId: number
  status: MarketplaceOrderStatus
  paymentStatus: 'A_CONFIRMER' | 'PAYE'
  deliveryMethod: MarketplaceDeliveryMethod
  deliveryAddress: string | null
  agentNote: string | null
  itemsAmount: string
  deliveryFee: string | null
  totalAmount: string | null
  paymentMethod: MarketplacePaymentMethod | null
  paymentAccount: string | null
  paymentAccountName: string | null
  paymentInstructions: string | null
  paymentReference: string | null
  quotedAt: string | null
  quoteExpiresAt: string | null
  paymentExpiresAt: string | null
  cancellationReason: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
  items: MarketplaceOrderItem[]
  agent?: { id: number; email: string; agentProfile: { firstName: string; lastName: string; phone: string; city: string } | null }
  paidBy?: { id: number; email: string } | null
}
export type ProspectContact = {
  id: number
  companyName: string
  responsibleName: string | null
  latitude: number | null
  longitude: number | null
  address: string | null
  contact: string | null
  createdAt: string
}
export type BadgeConfig = { price: number; durationDays: number; paymentOperator: string; paymentName: string; paymentNumber: string; configured: boolean }
export type SubscriptionRequest = { id: number; status: string; amount: number; durationDays: number; transactionRef: string; rejectionReason: string | null; requestedAt: string; reviewedAt: string | null; startsAt: string | null; expiresAt: string | null }
export type SubscriptionOverview = { config: BadgeConfig; current: { id: number; startsAt: string | null; expiresAt: string | null; amount: number; durationDays: number } | null; latestRequest: SubscriptionRequest | null }
export type AdminSubscriptionRequest = SubscriptionRequest & { proofMimeType: string; user: { id: number; email: string; agentProfile: { firstName: string; lastName: string; phone: string } | null } }
export type NewProspectContact = Omit<ProspectContact, 'id' | 'createdAt'>
export type AdminDashboardData = { pendingApplications: number; pendingReports: number; pendingWithdrawals: number; activeAgents: number; totalPaid: number; recentActivity: { id: string; kind: string; title: string; detail: string; status: string; createdAt: string; view: string }[] }
export type SearchResult = { id: string; title: string; detail: string; view: string }
export type SessionUser = { id: number; email: string; role: 'AGENT' | 'ADMIN' | 'SUPER_ADMIN' | 'SALES_REVIEWER' | 'SALES_SIGNER'; status: string; profile: { firstName: string; lastName: string; phone?: string; city?: string; imageUrl?: string | null } | null }
export type AgentStats = {
  reportCounts: Record<string, number>
  pendingReports: number
  validationRate: number
  totalGains: number
  totalWithdrawn: number
  pendingWithdrawals: number
  availableBalance: number
  withdrawalMinimum: number
  transactions: { id: number; type: string; amount: number; note: string | null; reportName: string | null; createdAt: string }[]
  withdrawals: { id: number; amount: number; status: string; operator: string; phoneNumber: string; createdAt: string; paymentReference: string | null }[]
}
export type CollaborationCommission = {
  id: number
  dealId: number
  agentId: number
  role: 'SUPPLIER' | 'CLOSER'
  amount: string
  currency: string
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'ON_HOLD'
  paymentMode: 'MVOLA' | 'ORANGE_MONEY' | 'AIRTEL_MONEY' | 'BANK_TRANSFER' | 'CASH' | null
  paymentReference: string | null
  generatedAt: string
  paidAt: string | null
  saleNumber: string | null
  adjustmentTotal: string
  netAmount: string
  adjustments: { id: number; currency: string; reason: string; createdAt: string; amount: string }[]
}
export type CollaborationCommissionSummary = {
  periodBasis: 'generatedAt'
  totalsByCurrency: { currency: string; pending: string; paid: string; onHold: string; cancelled: string }[]
  byPeriod: { period: string; currency: string; pending: string; paid: string; onHold: string; cancelled: string }[]
}
export type CollaborationSuppliedDeal = {
  dealId: number
  status: string
  declaredAt: string
  updatedAt: string
  prospectName: string
  city: string
  reportNature: string
  reportCreatedAt: string
  pendingRequestsCount: number
}
export type CollaborationCloserAccess = {
  dealId: number
  dealStatus: 'IN_PROGRESS' | 'CLOSING_REPORTED' | 'CLIENT_CONFIRMED' | 'NO_RESPONSE' | 'CONFIRMED' | string
  prospectName: string
  city: string
  reportNature: string
  reportType: string
  customServiceDescription?: string | null
  meetingAt: string
  createdAt: string
  accessExpiresAt: string
  closingReportStatus: 'NONE' | 'DRAFT' | 'SUBMITTED' | string
}
export type CollaborationDealContactDetails = {
  dealId: number
  dealStatus: string
  supplierId: number
  closerId: number | null
  accessExpiresAt: string | null
  watermark: { agentId: number; agentName: string }
  report: {
    id: number
    city: string
    reportNature: string
    reportType: string
    customServiceDescription?: string | null
    meetingAt: string
    createdAt: string
    status: string
    contactType: string
    contactRole: string | null
    summary: string
    interestLevel: string
    nextStep: string | null
  }
  prospect: {
    companyName: string
    contactName: string
    phone: string
    email: string | null
    address: string | null
  } | null
}
export type CollaborationPendingAccessRequest = {
  id: number
  dealId: number
  requestedAt: string
  expiresAt: string
  prospectName: string
  requester: {
    id: number
    name: string
    trustScore: { score: number; calculatedAt: string } | null
    successfulSales: number
  }
}
export type CollaborationTimeline = {
  dealId: number
  status: string
  steps: { status: string; at: string }[]
  saleNumber?: string
}
export type CollaborationProspect = {
  dealId: number
  reportId?: number
  prospectName: string
  city: string
  reportNature: string
  reportType: string
  meetingAt: string
  createdAt: string
  status: string
  supplier: { id?: number; name: string }
  supplierTrustScore?: { score: number; calculatedAt: string } | null
  dealStatus: string
  myRequest: {
    id: number
    status: 'PENDING' | 'CLOSED_SIGNED' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'NOT_SELECTED'
    requestedAt: string
    expiresAt: string
    nextRequestAt?: string | null
  } | null
  nextRequestAt?: string | null
}
export type CollaborationClosingReport = {
  id: number
  status: 'DRAFT' | 'SUBMITTED' | 'REJECTED'
  saleAmount: string | null
  saleDate: string | null
  details: string | null
  reportedAt: string
  submittedAt: string | null
  evidence: {
    id: number
    fileName: string
    mimeType: string
    fileSize: number
    sha256: string
    createdAt: string
    downloadUrl: string
  }[]
}
export type CollaborationClosingDraft = {
  saleAmount?: number | null
  saleDate?: string | null
  details?: string | null
}
export type CollaborationLostReason =
  | 'NO_INTEREST'
  | 'UNREACHABLE'
  | 'NO_BUDGET'
  | 'COMPETITOR_SELECTED'
  | 'CLIENT_CANCELLED'
  | 'DUPLICATE'
  | 'OTHER'
export type AdminCollaborationDealSummary = {
  id: number
  status: string
  closingReportedAt: string | null
  reviewSlaStartedAt?: string | null
  updatedAt: string
  disputeReason?: string | null
  disputedAt?: string | null
  clientConfirmationOverrideReason?: string | null
  supplier: { id: number; name: string } | null
  closer: { id: number; name: string } | null
  reviewAssignedTo?: { id: number; name: string } | null
}
export type AdminCollaborationOverrideSummary = {
  id: number
  status: string
  closingReportedAt: string | null
  updatedAt: string
  overrideReason: string | null
  overrideAt: string | null
  admin: { id: number; name: string } | null
  supplier: { id: number; name: string } | null
  closer: { id: number; name: string } | null
}
export type AdminCollaborationActiveAgent = { id: number; name: string }
export type AdminCollaborationDashboard = {
  salesToVerify: number
  contractsToSign: number
  commissionsToPay: number
  disputes: number
  bypassAlerts: number
  extractionAlerts: number
  repeatedExpirations: number
  overrides: number
  sla: {
    review: { targetHours: number; overdue: number; unassigned: number }
    signature: { targetHours: number; overdue: number; unassigned: number }
  }
}
export type AdminSignedContractStatus = 'CONTRACT_SIGNED' | 'COMMISSIONS_PAID' | 'DISPUTED'
export type AdminSignedContractsFilters = {
  q?: string
  status?: 'ALL' | AdminSignedContractStatus
  from?: string
  to?: string
}
export type AdminSignedContract = {
  id: number
  status: string
  saleNumber: string
  contractReference: string | null
  contractSignedAt: string
  supplier: string
  closer: string | null
  signatory: string | null
  client: { companyName: string; contactName: string }
  project: string
  projectDetails: string | null
  contractAmount: string | null
  reportedAmount: string | null
  saleDate: string | null
  closingDetails: string | null
  contractFiles: AdminCollaborationEvidence[]
}
export type AdminCollaborationQueueFilters = Pick<AdminAuditFilters, 'from' | 'to'> & {
  assignment?: 'ASSIGNED' | 'UNASSIGNED'
  reviewStage?: 'WAITING_CLIENT' | 'CLIENT_CONFIRMED' | 'NO_RESPONSE' | 'DISPUTED'
  sla?: 'OVERDUE'
}
export type AdminCollaborationPagination = { page: number; limit: number; total: number }
export type AdminCollaborationPage<T> = { data: T[]; pagination: AdminCollaborationPagination }
export type AdminCollaborationReadyDeal = {
  id: number
  status: string
  updatedAt: string
  confirmedAt: string | null
  supplier: { id: number; name: string } | null
  closer: { id: number; name: string } | null
  signAssignedTo?: { id: number; name: string } | null
  prerequisites: { closingReportSubmitted: boolean; confirmationSatisfied: boolean; canSign: boolean; blockers: string[] }
}
export type AdminCollaborationTeamMember = {
  id: number
  email: string
  role: 'SALES_REVIEWER' | 'SALES_SIGNER'
  status: string
  totpEnabled: boolean
  createdAt: string
  lastActiveAt: string | null
  name: string
  reviewLoad: number
  signLoad: number
}
export type AdminCollaborationAssignmentOption = { id: number; email: string; name: string }
export type AdminCollaborationAlert = {
  id: string
  type: 'BYPASS' | 'EXTRACTION' | 'REPEATED_EXPIRATIONS'
  severity: 'HIGH' | 'MEDIUM'
  occurredAt: string
  agent: { id: number; name: string } | null
  agents?: Array<{ id: number; name: string }>
  dealId: number | null
  count?: number
  message: string
}
export type AdminCollaborationCommission = {
  id: number
  dealId: number
  agentId: number
  role: 'SUPPLIER' | 'CLOSER'
  amount: string
  currency: string
  status: string
  paymentMode: string | null
  paymentReference: string | null
  generatedAt: string
  paidAt: string | null
  saleNumber: string | null
  agent: { id: number; email: string; status: string; name: string }
}
export type AdminCollaborationSignatureResult = {
  status: 'CONTRACT_SIGNED'
  saleNumber: string
  contractAmount: string
  evidenceId: number
}
export type AdminCollaborationTrustAgent = {
  id: number
  status: string
  name: string
  trustScore: {
    score: number
    formulaVersion: number
    calculatedAt: string
  } | null
  suspensionProposed: boolean
}
export type AdminCollaborationAuditEntry = {
  sequence: string
  createdAt: string
  occurredAtLocal: string
  actorId: number | null
  actorRole: string | null
  actorEmail: string | null
  action: string
  entityType: string
  entityId: number | null
  dealId: number | null
  oldValues: unknown
  newValues: unknown
  metadata: unknown
  ip: string | null
  userAgent: string | null
  previousHash: string
  entryHash: string
}
export type AdminAuditFilters = {
  actorId?: string
  entityType?: string
  entityId?: string
  action?: string
  from?: string
  to?: string
}
export type AdminAuditVerification = {
  status: 'VALID' | 'BROKEN' | 'STALE' | 'UNKNOWN'
  lastResult: 'VALID' | 'BROKEN' | null
  checkedAt: string | null
  sequence: string | null
  issueCount: number | null
}
export type AdminCollaborationAgentScore = {
  score: number | null
  confirmed: number
  unresolvedOrNegative: number
  active: number
  resolved: number
  method: string
}
export type AdminCollaborationEvidence = {
  id: number
  fileName: string
  mimeType: string
  fileSize: number
  sha256: string
  createdAt: string
  downloadUrl: string
}
export type AdminCollaborationDealDetail = {
  id: number
  status: string
  declaredAt: string
  closingReportedAt: string | null
  contractSignedAt: string | null
  contractAmount: string | null
  saleNumber: string | null
  disputeReason: string | null
  clientConfirmationOverrideReason: string | null
  reviewAssignedToId: number | null
  signAssignedToId: number | null
  reviewAssignedTo: AdminCollaborationAssignmentOption | null
  signAssignedTo: AdminCollaborationAssignmentOption | null
  assignmentTeam: {
    reviewers: AdminCollaborationAssignmentOption[]
    signers: AdminCollaborationAssignmentOption[]
  } | null
  assignmentEligibility: { review: boolean; sign: boolean }
  report: {
    id: number
    companyName: string
    city: string
    address: string
    contactName: string
    contactRole: string
    contactPhone: string
    contactEmail: string | null
    contactType: string
    reportNature: string
    reportType: string
    customServiceDescription?: string | null
    meetingAt: string
    createdAt: string
    status: string
    summary: string
    interestLevel: string
    nextStep: string | null
    product: { title: string } | null
    commissionAmount: string | null
  }
  prospect: {
    companyName: string
    contactName: string
    phone: string
    email: string | null
    address: string | null
  } | null
  supplier: {
    id: number
    email: string
    profile: { firstName: string; lastName: string; city: string } | null
    score: AdminCollaborationAgentScore
  }
  closer: {
    id: number
    email: string
    profile: { firstName: string; lastName: string; city: string } | null
    score: AdminCollaborationAgentScore
  } | null
  closingReport: {
    id: number
    status: string
    saleAmount: string | null
    saleDate: string | null
    details: string | null
    reportedAt: string | null
    submittedAt: string | null
    rejectionReason: string | null
    supplements: { id: number; details: string; createdAt: string; author: { id: number; email: string } }[]
    evidence: AdminCollaborationEvidence[]
  } | null
  clientConfirmation: {
    id: number
    status: string
    attempts: number
    expiresAt: string
    sentAt: string | null
    respondedAt: string | null
    blockedUntil: string | null
  } | null
  contractFiles: AdminCollaborationEvidence[]
  hiddenAgents: { id: number; email: string; name: string; hiddenAt: string }[]
  statusHistory: {
    id: number
    fromStatus: string | null
    toStatus: string
    comment: string | null
    createdAt: string
    actor: { id: number; email: string; role: string } | null
  }[]
}
export type ClientConfirmation = { status: 'PENDING' | 'CONFIRMED' | 'CONFIRMED_BY_CLIENT' | 'DENIED' | 'NO_RESPONSE'; expiresAt: string }
export type CommissionAmounts = Record<ReportType, number>
export type Notification = {
  id: number
  type: string
  title: string
  body: string
  link?: string | null
  readAt?: string | null
  createdAt: string
  actor?: { id: number; role: string; lastActiveAt?: string | null; agentProfile: { firstName: string; lastName: string; imageUrl: string | null } | null } | null
}
export type Setting = { id: number; key: string; value: string }
export type AdminApplication = { id: number; fullName: string; email: string; phone: string; city: string; status: string; motivation: string; createdAt: string; userId?: number | null; userStatus?: string | null }
export type ApplicationDecision = { data?: { id: number; status: string; userId: number | null; userStatus?: string }; message?: string }
export type ValidationHistoryEntry = {
  id: number
  fromStatus?: string | null
  toStatus: string
  comment?: string | null
  createdAt: string
  actor?: { email: string; agentProfile?: { firstName: string; lastName: string } | null } | null
}

export type AdminReport = Report & {
  agent: { email: string; agentProfile?: { firstName: string; lastName: string; promoCode?: string | null } | null }
  reportNature?: 'CONTACT' | 'RENDEZ_VOUS' | 'CONTRAT'
  reportType?: ReportType
  promoCode?: string | null
  contractSigned?: boolean
  statusHistory?: ValidationHistoryEntry[]
  commissionAmount?: number
}
export type AdminWithdrawal = { id: number; amount: string | number; status: string; operator: string; phoneNumber: string; createdAt: string; agent: { agentProfile?: { firstName: string; lastName: string } | null } }
export type CommunityAuthor = { id: number; role?: 'AGENT' | 'ADMIN' | 'SUPER_ADMIN' | 'SALES_REVIEWER' | 'SALES_SIGNER'; lastActiveAt?: string | null; agentProfile: { firstName: string; lastName: string; imageUrl?: string | null } | null; isSubscriber: boolean }
export type CommunityComment = { id: number; content: string; createdAt: string; parentCommentId: number | null; author: CommunityAuthor; isAuthorHidden: boolean }
export type CommunityPost = {
  id: number
  title: string
  content: string
  imageUrl: string | null
  createdAt: string
  isPinned: boolean
  isAuthorHidden: boolean
  author: CommunityAuthor
  category: { name: string }
  comments: CommunityComment[]
  likesCount: number
  likedByMe: boolean
}
export type CommunityOffer = { id: number; title: string; description: string; targetAudience: string; salesPitch: string; publishedAt: string | null }
export type CommunityFeed = { posts: CommunityPost[]; offers: CommunityOffer[] }
export type CommunityContentReport = {
  id: number
  targetType: 'POST' | 'COMMENT'
  targetId: number
  reason: string
  createdAt: string
  reporter: { id: number; email: string }
  target: { title?: string; content?: string; post?: { title: string } } | null
}
export type ChatAgent = { id: number; lastActiveAt?: string | null; agentProfile: { firstName: string; lastName: string; city: string; imageUrl?: string | null } | null; isSubscriber: boolean }
export type ChatMessage = { id: number; conversationId: number; senderId: number; content: string; readAt: string | null; createdAt: string; deletedAt?: string | null; mediaUrl?: string | null; mediaMimeType?: string | null }
export type ChatConversation = { id: number; agent: CommunityAuthor; lastMessage: ChatMessage | null; unreadCount: number; updatedAt: string; archivedAt: string | null }

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly attemptsRemaining?: number) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function readJsonPayload<T>(response: Response): Promise<T> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiRequestError(`Le serveur API a renvoyé une réponse non JSON (HTTP ${response.status}). Vérifiez le démarrage de l’API et les migrations de la base de données.`, response.status)
  }
  try {
    return await response.json() as T
  } catch {
    throw new ApiRequestError('Le serveur API a renvoyé un JSON invalide. Consultez les logs du serveur.', response.status)
  }
}

function adminCollaborationErrorMessage(status: number): string {
  if (status === 401) return 'Votre session a expiré. Reconnectez-vous puis réessayez.'
  if (status === 403) return 'Accès refusé ou code de validation incorrect. Demandez un nouveau code administrateur.'
  if (status === 409) return 'Le dossier a changé depuis son ouverture. Rechargez-le avant de réessayer.'
  if (status === 429) return 'Trop de tentatives. Patientez un instant avant de réessayer.'
  return `Impossible de traiter la demande (erreur ${status}). Réessayez.`
}

const api = {
  async login(email: string, password: string): Promise<{ token: string; user: SessionUser }> {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    const payload = await readJsonPayload<{ token?: string; user?: SessionUser; error?: string }>(response)
    if (!response.ok || !payload.token || !payload.user) throw new Error(payload.error ?? 'Connexion impossible')
    return { token: payload.token, user: payload.user }
  },
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const response = await fetch('/api/auth/password/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    const payload = await readJsonPayload<{ error?: string }>(response)
    if (!response.ok) throw new Error(payload.error ?? 'Impossible de modifier le mot de passe.')
  },
  async googleAuth(input: GoogleAuthInput): Promise<
    | { kind: 'LOGIN'; token: string; user: SessionUser }
    | { kind: 'OTP_PENDING'; message: string; email: string }
  > {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const payload = await readJsonPayload<{
      kind?: 'LOGIN' | 'OTP_PENDING'
      token?: string
      user?: SessionUser
      message?: string
      email?: string
      error?: string
    }>(response)
    if (!response.ok) throw new Error(payload.error ?? 'Connexion Google impossible.')
    if (payload.kind === 'LOGIN' && payload.token && payload.user) {
      return { kind: 'LOGIN', token: payload.token, user: payload.user }
    }
    if (payload.kind === 'OTP_PENDING' && payload.message && payload.email) {
      return { kind: 'OTP_PENDING', message: payload.message, email: payload.email }
    }
    throw new Error('Réponse de connexion Google invalide.')
  },
  async register(input: { firstName: string; lastName: string; email: string; phone: string; city: string; password: string; consent: true }): Promise<{ kind: 'OTP_PENDING'; message: string; email: string }> {
    const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    const payload = await readJsonPayload<{ kind?: 'OTP_PENDING'; message?: string; email?: string; error?: string; details?: { fieldErrors?: Record<string, string[]> } }>(response)
    if (!response.ok) {
      const fields = Object.values(payload.details?.fieldErrors ?? {}).flat().join(' ')
      throw new Error([payload.error, fields].filter(Boolean).join(': ') || 'Inscription impossible')
    }
    if (payload.kind !== 'OTP_PENDING' || !payload.message || !payload.email) throw new Error('Réponse de demande de code invalide.')
    return { kind: payload.kind, message: payload.message, email: payload.email }
  },
  async verifyRegistrationOtp(email: string, code: string): Promise<string> {
    const response = await fetch('/api/auth/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    const payload = await readJsonPayload<{ message?: string; error?: string }>(response)
    if (!response.ok || !payload.message) throw new Error(payload.error ?? 'Vérification du code impossible.')
    return payload.message
  },
  async resendRegistrationOtp(email: string): Promise<string> {
    const response = await fetch('/api/auth/register/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const payload = await readJsonPayload<{ message?: string; error?: string }>(response)
    if (!response.ok) throw new Error(payload.error ?? 'Renvoi du code impossible.')
    return payload.message ?? 'Si une inscription est en attente, un code a été envoyé.'
  },
  async notifications(): Promise<Notification[]> { const response = await fetch('/api/workspace/notifications', { headers: authHeaders() }); const payload = await response.json() as { data?: Notification[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les notifications'); return payload.data },
  async webPushPublicKey(): Promise<string> {
    const response = await fetch('/api/workspace/push/public-key', { headers: authHeaders() })
    const payload = await readJsonPayload<{ publicKey?: string; error?: string }>(response)
    if (!response.ok || !payload.publicKey) throw new Error(payload.error ?? 'Les notifications système ne sont pas disponibles.')
    return payload.publicKey
  },
  async savePushSubscription(subscription: PushSubscription): Promise<void> {
    const response = await fetch('/api/workspace/push/subscriptions', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    })
    const payload = await readJsonPayload<{ message?: string; error?: string }>(response)
    if (!response.ok) throw new Error(payload.error ?? 'Impossible d’activer les notifications système.')
  },
  async removePushSubscription(endpoint: string): Promise<void> {
    const response = await fetch('/api/workspace/push/subscriptions', {
      method: 'DELETE',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    })
    const payload = await readJsonPayload<{ error?: string }>(response)
    if (!response.ok) throw new Error(payload.error ?? 'Impossible de désactiver les notifications système.')
  },
  async markNotificationRead(id: number) { const response = await fetch(`/api/workspace/notifications/${id}/read`, { method: 'PATCH', headers: authHeaders() }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de marquer la notification comme lue') },
  async dismissNotification(id: number) { const response = await fetch(`/api/workspace/notifications/${id}`, { method: 'DELETE', headers: authHeaders() }); if (!response.ok) throw new Error('Impossible de fermer la notification') },
  async settings(): Promise<Setting[]> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch('/api/workspace/settings', {
        headers: authHeaders(),
        cache: 'no-store',
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({})) as { data?: Setting[]; error?: string }
      if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les paramètres')
      return payload.data
    } catch (caught) {
      if (controller.signal.aborted) throw new Error('Le serveur ne répond pas pour les paramètres. Vérifiez la connexion API et la base de données.')
      throw caught
    } finally {
      window.clearTimeout(timeout)
    }
  },
  async commissionAmounts(): Promise<CommissionAmounts> {
    const settings = await api.settings()
    const values = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]))
    const amount = (key: string, fallback: number) => {
      const parsed = Number(values[key])
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
    }
    const lead = amount('report_lead_amount', 50000)
    const sale = amount('report_sale_amount', 100000)
    return {
      LEAD: lead,
      PROVIDED_CONTACT: sale,
      FULL_CYCLE: lead + sale,
    }
  },
  async updateSetting(key: string, value: string): Promise<void> {
    const response = await fetch(`/api/workspace/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ value }),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(payload.error ?? 'Impossible d’enregistrer le paramètre')
  },
  async health() {
    const response = await fetch('/api/health')
    return response.ok
  },
  async reports(): Promise<Report[]> {
    const response = await fetch('/api/reports', { headers: authHeaders() })
    const payload = await readJsonPayload<{ data?: Report[]; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de charger les rapports', response.status)
    return payload.data
  },
  async agentStats(): Promise<AgentStats> {
    const response = await fetch('/api/stats/agent', { headers: authHeaders() })
    const payload = await response.json() as { data?: AgentStats; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger vos statistiques')
    return payload.data
  },
  async collaborationCommissions(status?: CollaborationCommission['status']): Promise<CollaborationCommission[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : ''
    const response = await fetch(`/api/collaboration/commissions/me${query}`, { headers: authHeaders() })
    const payload = await readJsonPayload<{ data?: CollaborationCommission[]; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de charger vos commissions.', response.status)
    return payload.data
  },
  async collaborationCommissionSummary(): Promise<CollaborationCommissionSummary> {
    const response = await fetch('/api/collaboration/commissions/me/summary', { headers: authHeaders() })
    const payload = await readJsonPayload<{ data?: CollaborationCommissionSummary; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de charger le récapitulatif de vos commissions.', response.status)
    return payload.data
  },
  async collaborationSuppliedDeals(): Promise<CollaborationSuppliedDeal[]> {
    const response = await fetch('/api/collaboration/supplied', { headers: authHeaders() })
    const payload = await readJsonPayload<{ data?: CollaborationSuppliedDeal[]; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de charger vos prospects.', response.status)
    return payload.data
  },
  async collaborationCloserAccesses(): Promise<CollaborationCloserAccess[]> {
    const response = await fetch('/api/collaboration/closer/accesses', {
      headers: authHeaders(),
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ data?: CollaborationCloserAccess[]; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de charger vos accès.', response.status)
    return payload.data
  },
  async collaborationDealContactDetails(dealId: number): Promise<CollaborationDealContactDetails> {
    const response = await fetch(`/api/collaboration/${dealId}`, {
      headers: authHeaders(),
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ data?: CollaborationDealContactDetails; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de charger les coordonnées.', response.status)
    return payload.data
  },
  async collaborationProspects(): Promise<CollaborationProspect[]> {
    const response = await fetch('/api/collaboration/prospects', {
      headers: authHeaders(),
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ data?: CollaborationProspect[]; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de charger les prospects disponibles.', response.status)
    return payload.data
  },
  async requestCollaborationAccess(dealId: number, message?: string): Promise<CollaborationProspect['myRequest']> {
    const response = await fetch(`/api/collaboration/${dealId}/access-requests`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(message?.trim() ? { message: message.trim() } : {}),
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ data?: NonNullable<CollaborationProspect['myRequest']>; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible d’envoyer la demande d’accès.', response.status)
    return payload.data
  },
  async hideSignedCollaborationProspect(dealId: number): Promise<void> {
    const response = await fetch(`/api/collaboration/prospects/${dealId}/hide`, {
      method: 'POST',
      headers: authHeaders(),
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ error?: string }>(response)
    if (!response.ok) throw new ApiRequestError(payload.error ?? 'Impossible de retirer ce prospect de votre liste.', response.status)
  },
  async collaborationClosingReport(dealId: number): Promise<CollaborationClosingReport | null> {
    const response = await fetch(`/api/collaboration/${dealId}/closing-report`, {
      headers: authHeaders(),
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ data?: CollaborationClosingReport | null; error?: string }>(response)
    if (!response.ok || payload.data === undefined) throw new ApiRequestError(payload.error ?? 'Impossible de charger le brouillon.', response.status)
    return payload.data
  },
  async saveCollaborationClosingDraft(dealId: number, draft: CollaborationClosingDraft): Promise<void> {
    const response = await fetch(`/api/collaboration/${dealId}/closing-report/draft`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ error?: string }>(response)
    if (!response.ok) throw new ApiRequestError(payload.error ?? 'Impossible d’enregistrer le brouillon.', response.status)
  },
  async uploadCollaborationClosingAttachment(dealId: number, file: File): Promise<CollaborationClosingReport['evidence'][number]> {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch(`/api/collaboration/${dealId}/closing-report/attachments`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ data?: CollaborationClosingReport['evidence'][number]; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de téléverser cette pièce.', response.status)
    return payload.data
  },
  async submitCollaborationClosingReport(dealId: number, idempotencyKey: string): Promise<void> {
    const response = await fetch(`/api/collaboration/${dealId}/closing-report/submit`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey }),
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ error?: string }>(response)
    if (!response.ok) throw new ApiRequestError(payload.error ?? 'Impossible de soumettre le rapport.', response.status)
  },
  async declareCollaborationLost(dealId: number, reason: CollaborationLostReason): Promise<void> {
    const response = await fetch(`/api/collaboration/${dealId}/lost`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
      cache: 'no-store',
    })
    const payload = await readJsonPayload<{ error?: string }>(response)
    if (!response.ok) throw new ApiRequestError(payload.error ?? 'Impossible de déclarer ce prospect perdu.', response.status)
  },
  async collaborationPendingAccessRequests(): Promise<CollaborationPendingAccessRequest[]> {
    const response = await fetch('/api/collaboration/access-requests/pending', { headers: authHeaders() })
    const payload = await readJsonPayload<{ data?: CollaborationPendingAccessRequest[]; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de charger les demandes.', response.status)
    return payload.data
  },
  async collaborationTimeline(dealId: number): Promise<CollaborationTimeline> {
    const response = await fetch(`/api/collaboration/${dealId}/timeline`, { headers: authHeaders() })
    const payload = await readJsonPayload<{ data?: CollaborationTimeline; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Impossible de charger la frise du prospect.', response.status)
    return payload.data
  },
  async decideCollaborationAccessRequest(requestId: number, decision: 'APPROVE' | 'REJECT'): Promise<void> {
    const response = await fetch(`/api/collaboration/access-requests/${requestId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    const payload = await readJsonPayload<{ error?: string }>(response)
    if (!response.ok) throw new ApiRequestError(payload.error ?? 'Impossible de traiter cette demande.', response.status)
  },
  async clientConfirmation(confirmationToken: string): Promise<ClientConfirmation> {
    const response = await fetch(`/api/collaboration/public/confirmations/${confirmationToken}`)
    const payload = await readJsonPayload<{ data?: ClientConfirmation; error?: string }>(response)
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? 'Cette confirmation est introuvable.', response.status)
    return payload.data
  },
  async respondToClientConfirmation(
    confirmationToken: string,
    input: { code: string; answer: 'CONFIRMED' | 'DENIED' },
  ): Promise<{ result: 'CONFIRMED_BY_CLIENT' | 'DENIED' }> {
    const response = await fetch(`/api/collaboration/public/confirmations/${confirmationToken}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const payload = await readJsonPayload<{
      data?: { result: 'CONFIRMED_BY_CLIENT' | 'DENIED' }
      error?: string
      attemptsRemaining?: number
    }>(response)
    if (!response.ok || !payload.data) {
      throw new ApiRequestError(
        payload.error ?? 'Impossible d’enregistrer votre réponse.',
        response.status,
        payload.attemptsRemaining,
      )
    }
    return payload.data
  },
  async uploadProfilePhoto(file: File): Promise<SessionUser> {
    const formData = new FormData()
    formData.append('photo', file)
    const response = await fetch('/api/auth/profile/photo', { method: 'POST', headers: authHeaders(), body: formData })
    const payload = await response.json().catch(() => ({})) as { user?: SessionUser; error?: string }
    if (!response.ok || !payload.user) throw new Error(payload.error ?? 'Impossible d’enregistrer la photo de profil.')
    return payload.user
  },
  async createWithdrawal(input: { amount: number; operator: string; phoneNumber: string }): Promise<void> {
    const response = await fetch('/api/workspace/withdrawals', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) })
    const payload = await response.json() as { error?: string }
    if (!response.ok) throw new Error(payload.error ?? 'Impossible de créer la demande de retrait')
  },
  async createReport(input: NewReportInput): Promise<Report> {
    const response = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(input),
    })
    const payload = await response.json().catch(() => ({})) as { data?: Report; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible d’enregistrer le rapport')
    return payload.data
  },
  async products(): Promise<Product[]> {
    const response = await fetch('/api/products')
    if (!response.ok) throw new Error('Impossible de charger le catalogue')
    const payload = await response.json() as { data: Product[] }
    return payload.data
  },
  async marketplaceProducts(): Promise<MarketplaceProduct[]> {
    const response = await fetch('/api/marketplace/products', { headers: authHeaders() })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceProduct[]; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger la boutique.')
    return payload.data
  },
  async marketplacePaymentSettings(): Promise<MarketplacePaymentSettings> {
    const response = await fetch('/api/marketplace/payment-settings', { headers: authHeaders() })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplacePaymentSettings; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les modes de paiement.')
    return payload.data
  },
  async marketplaceOrders(): Promise<MarketplaceOrder[]> {
    const response = await fetch('/api/marketplace/orders', { headers: authHeaders() })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceOrder[]; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger vos commandes.')
    return payload.data
  },
  async createMarketplaceOrder(input: { items: Array<{ variantId: number; quantity: number }>; deliveryMethod: MarketplaceDeliveryMethod; paymentMethod: MarketplacePaymentMethod; deliveryAddress?: string; agentNote?: string }): Promise<MarketplaceOrder> {
    const response = await fetch('/api/marketplace/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceOrder; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible d’enregistrer votre commande.')
    return payload.data
  },
  async submitMarketplacePaymentReference(id: number, paymentReference: string, paymentMethod?: MarketplaceMobilePaymentMethod): Promise<MarketplaceOrder> {
    const response = await fetch(`/api/marketplace/orders/${id}/payment-reference`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ paymentReference, ...(paymentMethod ? { paymentMethod } : {}) }) })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceOrder; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible d’envoyer la référence de transaction.')
    return payload.data
  },
  async adminMarketplacePaymentSettings(): Promise<AdminMarketplacePaymentSettings> {
    const response = await fetch('/api/admin/marketplace/payment-settings', { headers: authHeaders() })
    const payload = await response.json().catch(() => ({})) as { data?: AdminMarketplacePaymentSettings; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les coordonnées de paiement.')
    return payload.data
  },
  async saveAdminMarketplacePaymentSettings(input: AdminMarketplacePaymentSettings, totp: string): Promise<AdminMarketplacePaymentSettings> {
    const response = await fetch('/api/admin/marketplace/payment-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), 'x-admin-totp': totp },
      body: JSON.stringify(input),
    })
    const payload = await response.json().catch(() => ({})) as { data?: AdminMarketplacePaymentSettings; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible d’enregistrer les coordonnées de paiement.')
    return payload.data
  },
  async adminMarketplaceProducts(): Promise<MarketplaceProduct[]> {
    const response = await fetch('/api/admin/marketplace/products', { headers: authHeaders() })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceProduct[]; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les articles marketplace.')
    return payload.data
  },
  async saveAdminMarketplaceProduct(input: MarketplaceProductInput, image?: File, id?: number): Promise<MarketplaceProduct> {
    const body = new FormData()
    body.append('title', input.title)
    body.append('category', input.category)
    body.append('description', input.description)
    body.append('price', String(input.price))
    body.append('status', input.status)
    body.append('variants', JSON.stringify(input.variants))
    if (image) body.append('image', image)
    const response = await fetch(id ? `/api/admin/marketplace/products/${id}` : '/api/admin/marketplace/products', {
      method: id ? 'PATCH' : 'POST',
      headers: authHeaders(),
      body,
    })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceProduct; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible d’enregistrer cet article.')
    return payload.data
  },
  async adminMarketplaceOrders(): Promise<MarketplaceOrder[]> {
    const response = await fetch('/api/admin/marketplace/orders', { headers: authHeaders() })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceOrder[]; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les commandes marketplace.')
    return payload.data
  },
  async updateAdminMarketplaceOrderStatus(id: number, status: MarketplaceOrderStatus): Promise<MarketplaceOrder> {
    const response = await fetch(`/api/admin/marketplace/orders/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ status }) })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceOrder; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de mettre à jour le statut de la commande.')
    return payload.data
  },
  async quoteAdminMarketplaceOrder(id: number, deliveryFee: number, totp: string): Promise<MarketplaceOrder> {
    const response = await fetch(`/api/admin/marketplace/orders/${id}/quote`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), 'x-admin-totp': totp },
      body: JSON.stringify({ deliveryFee }),
    })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceOrder; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de transmettre le devis de remise.')
    return payload.data
  },
  async confirmAdminMarketplacePayment(id: number, paymentNote: string, totp: string): Promise<MarketplaceOrder> {
    const response = await fetch(`/api/admin/marketplace/orders/${id}/payment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), 'x-admin-totp': totp },
      body: JSON.stringify({ paymentNote }),
    })
    const payload = await response.json().catch(() => ({})) as { data?: MarketplaceOrder; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de confirmer le paiement.')
    return payload.data
  },
  async adminProducts(): Promise<AdminProduct[]> { const response = await fetch('/api/admin/products', { headers: authHeaders() }); const payload = await response.json() as { data?: AdminProduct[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger le catalogue admin'); return payload.data },
  async agentProspects(): Promise<ProspectContact[]> { const response = await fetch('/api/prospects', { headers: authHeaders() }); const payload = await response.json() as { data?: ProspectContact[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les contacts de prospection'); return payload.data },
  async subscriptionOverview(): Promise<SubscriptionOverview> { const response = await fetch('/api/subscriptions/me', { headers: authHeaders() }); const payload = await response.json() as { data?: SubscriptionOverview; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger votre badge abonné'); return payload.data },
  async submitSubscription(transactionRef: string, proof: File): Promise<boolean> {
    const body = new FormData()
    body.append('transactionRef', transactionRef)
    body.append('proof', proof)
    const response = await fetch('/api/subscriptions', { method: 'POST', headers: authHeaders(), body })
    const payload = await response.json() as { error?: string; emailSent?: boolean }
    if (!response.ok) throw new Error(payload.error ?? 'Impossible de transmettre votre demande d’abonnement')
    return payload.emailSent === true
  },
  async adminSubscriptions(): Promise<AdminSubscriptionRequest[]> { const response = await fetch('/api/admin/subscriptions', { headers: authHeaders() }); const payload = await response.json() as { data?: AdminSubscriptionRequest[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les demandes de badge'); return payload.data },
  async subscriptionProof(id: number): Promise<Blob> { const response = await fetch(`/api/admin/subscriptions/${id}/proof`, { headers: authHeaders() }); if (!response.ok) { const payload = await response.json() as { error?: string }; throw new Error(payload.error ?? 'Impossible de charger le justificatif') } return response.blob() },
  async reviewSubscription(id: number, decision: 'APPROVED' | 'REJECTED', reason?: string): Promise<void> { const response = await fetch(`/api/admin/subscriptions/${id}/review`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ decision, reason }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de traiter la demande') },
  async adminProspects(): Promise<ProspectContact[]> { const response = await fetch('/api/admin/prospects', { headers: authHeaders() }); const payload = await response.json() as { data?: ProspectContact[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les prospects'); return payload.data },
  async createProspect(input: NewProspectContact): Promise<ProspectContact> { const response = await fetch('/api/admin/prospects', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) }); const payload = await response.json() as { data?: ProspectContact; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de créer le contact prospect'); return payload.data },
  async updateProspect(id: number, input: NewProspectContact): Promise<ProspectContact> { const response = await fetch(`/api/admin/prospects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) }); const payload = await response.json() as { data?: ProspectContact; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de modifier le contact prospect'); return payload.data },
  async deleteProspect(id: number): Promise<void> { const response = await fetch(`/api/admin/prospects/${id}`, { method: 'DELETE', headers: authHeaders() }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de supprimer le prospect') },
  async createProduct(input: Omit<Product, 'id'>): Promise<AdminProduct> { const response = await fetch('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) }); const payload = await response.json() as { data?: AdminProduct; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de créer le produit'); return payload.data },
  async updateProductStatus(id: number, status: 'BROUILLON' | 'PUBLIE' | 'ARCHIVE'): Promise<AdminProduct> { const response = await fetch(`/api/admin/products/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ status }) }); const payload = await response.json() as { data?: AdminProduct; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de modifier le produit'); return payload.data },
  async adminDashboard(): Promise<AdminDashboardData> { const response = await fetch('/api/admin/dashboard', { headers: authHeaders() }); const payload = await response.json() as { data?: AdminDashboardData; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Session administrateur expirée'); return payload.data },
  async startAdminTotpEnrollment(password: string): Promise<{ secret: string; uri: string }> {
    const response = await fetch('/api/admin/collaboration/2fa/enroll/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ password }),
    })
    const payload = await response.json().catch(() => ({})) as { data?: { secret?: string; uri?: string }; error?: string }
    if (!response.ok || !payload.data?.secret || !payload.data.uri) {
      throw new ApiRequestError(payload.error ?? 'Impossible de démarrer la configuration du code administrateur.', response.status)
    }
    return { secret: payload.data.secret, uri: payload.data.uri }
  },
  async verifyAdminTotpEnrollment(code: string): Promise<void> {
    const response = await fetch('/api/admin/collaboration/2fa/enroll/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ code }),
    })
    const payload = await response.json().catch(() => ({})) as { data?: { enabled?: boolean }; error?: string }
    if (!response.ok || payload.data?.enabled !== true) {
      throw new ApiRequestError(payload.error ?? 'Impossible de vérifier le code administrateur.', response.status)
    }
  },
  async adminCollaborationDashboard(totp: string): Promise<AdminCollaborationDashboard> {
    const response = await fetch('/api/admin/collaboration/dashboard', { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationDashboard; error?: string }
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return payload.data
  },
  async adminCollaborationTeam(totp: string): Promise<AdminCollaborationTeamMember[]> {
    const response = await fetch('/api/admin/collaboration/team', { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationTeamMember[]; error?: string }
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return payload.data
  },
  async inviteAdminCollaborationTeamMember(totp: string, input: { email: string; role: AdminCollaborationTeamMember['role'] }): Promise<Pick<AdminCollaborationTeamMember, 'id' | 'email' | 'role' | 'status'>> {
    const response = await fetch('/api/admin/collaboration/team/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), 'x-admin-totp': totp },
      body: JSON.stringify(input),
    })
    const payload = await response.json().catch(() => ({})) as { data?: Pick<AdminCollaborationTeamMember, 'id' | 'email' | 'role' | 'status'>; error?: string }
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return payload.data
  },
  async resendAdminCollaborationTeamInvitation(totp: string, userId: number): Promise<void> {
    const response = await fetch(`/api/admin/collaboration/team/${userId}/invitation`, {
      method: 'POST',
      headers: { ...authHeaders(), 'x-admin-totp': totp },
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
  },
  async adminSignedContracts(totp: string, page: number, limit: number, filters: AdminSignedContractsFilters): Promise<AdminCollaborationPage<AdminSignedContract>> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const response = await fetch(`/api/admin/collaboration/contracts/signed?${params}`, {
      headers: { ...authHeaders(), 'x-admin-totp': totp },
    })
    const payload = await response.json().catch(() => ({})) as {
      data?: AdminSignedContract[]
      pagination?: AdminCollaborationPagination
      error?: string
    }
    if (!response.ok || !payload.data || !payload.pagination) {
      throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    }
    return { data: payload.data, pagination: payload.pagination }
  },
  async adminCollaborationDeals(totp: string, page = 1, limit = 50, status?: 'DISPUTED', filters: AdminCollaborationQueueFilters = {}): Promise<AdminCollaborationPage<AdminCollaborationDealSummary>> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (status) params.set('status', status)
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const response = await fetch(`/api/admin/collaboration/deals?${params}`, { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationDealSummary[]; pagination?: AdminCollaborationPagination; error?: string }
    if (!response.ok || !payload.data || !payload.pagination) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return { data: payload.data, pagination: payload.pagination }
  },
  async adminCollaborationOverrides(totp: string, page = 1, limit = 50, filters: Pick<AdminAuditFilters, 'from' | 'to'> = {}): Promise<AdminCollaborationPage<AdminCollaborationOverrideSummary>> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const response = await fetch(`/api/admin/collaboration/deals/overrides?${params}`, { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationOverrideSummary[]; pagination?: AdminCollaborationPagination; error?: string }
    if (!response.ok || !payload.data || !payload.pagination) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return { data: payload.data, pagination: payload.pagination }
  },
  async adminCollaborationReadyToSign(totp: string, page = 1, limit = 50, filters: AdminCollaborationQueueFilters = {}): Promise<AdminCollaborationPage<AdminCollaborationReadyDeal>> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const response = await fetch(`/api/admin/collaboration/deals/ready-to-sign?${params}`, { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationReadyDeal[]; pagination?: AdminCollaborationPagination; error?: string }
    if (!response.ok || !payload.data || !payload.pagination) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return { data: payload.data, pagination: payload.pagination }
  },
  async adminCollaborationAlerts(totp: string, type: AdminCollaborationAlert['type'], page = 1, limit = 50, filters: Pick<AdminAuditFilters, 'from' | 'to'> & { agentId?: string } = {}): Promise<AdminCollaborationPage<AdminCollaborationAlert>> {
    const params = new URLSearchParams({ type, page: String(page), limit: String(limit) })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const response = await fetch(`/api/admin/collaboration/alerts?${params}`, { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationAlert[]; pagination?: AdminCollaborationPagination; error?: string }
    if (!response.ok || !payload.data || !payload.pagination) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return { data: payload.data, pagination: payload.pagination }
  },
  async adminCollaborationPendingCommissions(totp: string, page = 1, limit = 50, filters: Pick<AdminAuditFilters, 'from' | 'to'> = {}): Promise<AdminCollaborationPage<AdminCollaborationCommission>> {
    return api.adminCollaborationCommissionsByStatus(totp, 'PENDING', page, limit, filters)
  },
  async adminCollaborationCommissionsByStatus(totp: string, status: 'PENDING' | 'ON_HOLD', page = 1, limit = 50, filters: Pick<AdminAuditFilters, 'from' | 'to'> = {}): Promise<AdminCollaborationPage<AdminCollaborationCommission>> {
    const params = new URLSearchParams({ status, page: String(page), limit: String(limit) })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const response = await fetch(`/api/admin/collaboration/commissions?${params}`, { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationCommission[]; pagination?: AdminCollaborationPagination; error?: string }
    if (!response.ok || !payload.data || !payload.pagination) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return { data: payload.data, pagination: payload.pagination }
  },
  async adminCollaborationTrust(totp: string, page = 1, limit = 50): Promise<AdminCollaborationPage<AdminCollaborationTrustAgent> & { formulaVersion: number }> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    const response = await fetch(`/api/admin/collaboration/trust?${params}`, { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationTrustAgent[]; pagination?: AdminCollaborationPagination; formulaVersion?: number; error?: string }
    if (!response.ok || !payload.data || !payload.pagination || typeof payload.formulaVersion !== 'number') throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return { data: payload.data, pagination: payload.pagination, formulaVersion: payload.formulaVersion }
  },
  async adminCollaborationActiveAgents(totp: string, page = 1, limit = 50): Promise<AdminCollaborationPage<AdminCollaborationActiveAgent>> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    const response = await fetch(`/api/admin/collaboration/agents/active?${params}`, { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationActiveAgent[]; pagination?: AdminCollaborationPagination; error?: string }
    if (!response.ok || !payload.data || !payload.pagination) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return { data: payload.data, pagination: payload.pagination }
  },
  async adminCollaborationAudit(totp: string, filters: AdminAuditFilters, page = 1, limit = 50): Promise<AdminCollaborationPage<AdminCollaborationAuditEntry> & { chainSequence: string }> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const response = await fetch(`/api/admin/collaboration/audit?${params}`, { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationAuditEntry[]; pagination?: AdminCollaborationPagination; chainSequence?: string; error?: string }
    if (!response.ok || !payload.data || !payload.pagination || payload.chainSequence === undefined) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return { data: payload.data, pagination: payload.pagination, chainSequence: payload.chainSequence }
  },
  async adminCollaborationAuditVerification(totp: string): Promise<AdminAuditVerification> {
    const response = await fetch('/api/admin/collaboration/audit/verification', { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminAuditVerification; error?: string }
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return payload.data
  },
  async exportAdminCollaborationAudit(totp: string, filters: AdminAuditFilters): Promise<Blob> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    const query = params.toString()
    const response = await fetch(`/api/admin/collaboration/audit/export.csv${query ? `?${query}` : ''}`, {
      headers: { ...authHeaders(), 'x-admin-totp': totp },
      cache: 'no-store',
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    }
    return response.blob()
  },
  async decideAdminCollaborationCommission(commissionId: number, totp: string, input: { action: 'RELEASE' | 'CANCEL' | 'REASSIGN'; reason: string; targetAgentId?: number }): Promise<void> {
    const response = await fetch(`/api/admin/collaboration/commissions/${commissionId}/decision`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), 'x-admin-totp': totp },
      body: JSON.stringify(input),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
  },
  async resolveAdminCollaborationDispute(dealId: number, totp: string, reason: string): Promise<void> {
    const response = await fetch(`/api/admin/collaboration/deals/${dealId}/dispute-resolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), 'x-admin-totp': totp },
      body: JSON.stringify({ reason }),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
  },
  async updateAdminAgentStatus(userId: number, totp: string, status: 'ACTIF' | 'SUSPENDU', reason: string): Promise<void> {
    const response = await fetch(`/api/admin/agents/${userId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), 'x-admin-totp': totp },
      body: JSON.stringify({ status, reason }),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
  },
  async signAdminCollaborationDeal(dealId: number, totp: string, input: { contractReference: string; contractDate: string; contractAmount: string; file: File }): Promise<AdminCollaborationSignatureResult> {
    const body = new FormData()
    body.set('contractReference', input.contractReference)
    body.set('contractDate', input.contractDate)
    body.set('contractAmount', input.contractAmount)
    body.set('file', input.file)
    const response = await fetch(`/api/admin/collaboration/deals/${dealId}/signature`, {
      method: 'POST',
      headers: { ...authHeaders(), 'x-admin-totp': totp },
      body,
    })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationSignatureResult; error?: string }
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return payload.data
  },
  async exportAdminCollaborationCommissions(totp: string): Promise<Blob> {
    const response = await fetch('/api/admin/collaboration/commissions/export.csv', {
      headers: { ...authHeaders(), 'x-admin-totp': totp },
      cache: 'no-store',
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    }
    return response.blob()
  },
  async adminCollaborationDeal(dealId: number, totp: string): Promise<AdminCollaborationDealDetail> {
    const response = await fetch(`/api/admin/collaboration/deals/${dealId}`, { headers: { ...authHeaders(), 'x-admin-totp': totp } })
    const payload = await response.json().catch(() => ({})) as { data?: AdminCollaborationDealDetail; error?: string }
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return payload.data
  },
  async assignAdminCollaborationDeal(totp: string, dealId: number, input: {
    reviewAssignedToId?: number | null
    signAssignedToId?: number | null
  }): Promise<{ reviewAssignedToId: number | null; signAssignedToId: number | null }> {
    const response = await fetch(`/api/admin/collaboration/deals/${dealId}/assignment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), 'x-admin-totp': totp },
      body: JSON.stringify(input),
    })
    const payload = await response.json().catch(() => ({})) as {
      data?: { reviewAssignedToId: number | null; signAssignedToId: number | null }
      error?: string
    }
    if (!response.ok || !payload.data) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
    return payload.data
  },
  async restoreAdminHiddenCollaborationAgent(dealId: number, agentId: number, totp: string): Promise<void> {
    const response = await fetch(`/api/admin/collaboration/deals/${dealId}/hidden-agents/${agentId}/restore`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'x-admin-totp': totp },
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
  },
  async decideAdminCollaborationDeal(dealId: number, totp: string, input: { decision: 'CONFIRM' | 'REJECT'; reason?: string; overrideConfirmation?: boolean }): Promise<void> {
    const response = await fetch(`/api/admin/collaboration/deals/${dealId}/decision`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), 'x-admin-totp': totp },
      body: JSON.stringify(input),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new ApiRequestError(payload.error ?? adminCollaborationErrorMessage(response.status), response.status)
  },
  async updateAgentStatus(userId: number, status: 'ACTIF' | 'SUSPENDU'): Promise<{ id: number; status: string; email: string }> {
    const response = await fetch(`/api/admin/agents/${userId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status }),
    })
    const payload = await response.json().catch(() => ({})) as { data?: { id: number; status: string; email: string }; error?: string; message?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de modifier le statut du compte agent')
    return payload.data
  },
  async search(query: string): Promise<SearchResult[]> { const params = new URLSearchParams({ q: query }); const response = await fetch(`/api/workspace/search?${params}`, { headers: authHeaders() }); const payload = await response.json() as { data?: SearchResult[]; error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Recherche impossible'); return payload.data ?? [] },
  async communityFeed(): Promise<CommunityFeed> { const response = await fetch('/api/community/feed', { headers: authHeaders() }); const payload = await response.json() as { data?: CommunityFeed; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger le forum'); return payload.data },
  async searchCommunityPosts(query: string, offset = 0): Promise<{ posts: CommunityPost[]; hasMore: boolean }> {
    const params = new URLSearchParams({ q: query, offset: String(offset) })
    const response = await fetch(`/api/community/search?${params}`, { headers: authHeaders() })
    const payload = await response.json() as { data?: { posts: CommunityPost[]; hasMore: boolean }; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de rechercher dans la communauté')
    return payload.data
  },
  async createCommunityPost(input: { title: string; content: string; category: 'Discussion' | 'Question' | 'Astuce' }, media?: File | null): Promise<CommunityPost> {
    const body = media
      ? (() => { const form = new FormData(); form.append('title', input.title); form.append('content', input.content); form.append('category', input.category); form.append('media', media); return form })()
      : JSON.stringify(input)
    const response = await fetch('/api/community/posts', {
      method: 'POST',
      headers: media ? authHeaders() : { 'Content-Type': 'application/json', ...authHeaders() },
      body,
    })
    const payload = await response.json() as { data?: CommunityPost; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de publier le message')
    return payload.data
  },
  async adminCommunityPosts(): Promise<CommunityPost[]> { const response = await fetch('/api/admin/community/posts', { headers: authHeaders() }); const payload = await response.json() as { data?: CommunityPost[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les actualités de la communauté'); return payload.data },
  async createAdminCommunityPost(input: { title: string; content: string; category: 'Discussion' | 'Question' | 'Astuce' }, media?: File | null): Promise<CommunityPost> {
    const body = media
      ? (() => { const form = new FormData(); form.append('title', input.title); form.append('content', input.content); form.append('category', input.category); form.append('media', media); return form })()
      : JSON.stringify(input)
    const response = await fetch('/api/admin/community/posts', {
      method: 'POST',
      headers: media ? authHeaders() : { 'Content-Type': 'application/json', ...authHeaders() },
      body,
    })
    const payload = await response.json() as { data?: CommunityPost; error?: string }
    if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de publier le contenu')
    return payload.data
  },
  async updateCommunityPost(postId: number, input: { title: string; content: string; category: 'Discussion' | 'Question' | 'Astuce' }): Promise<Pick<CommunityPost, 'id' | 'title' | 'content' | 'category'>> { const response = await fetch(`/api/community/posts/${postId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) }); const payload = await response.json() as { data?: Pick<CommunityPost, 'id' | 'title' | 'content' | 'category'>; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de modifier la publication'); return payload.data },
  async setCommunityPostHidden(postId: number, hidden: boolean): Promise<void> { const response = await fetch(`/api/community/posts/${postId}/visibility`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ hidden }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de modifier la visibilité de la publication'); },
  async deleteCommunityPost(postId: number): Promise<void> { const response = await fetch(`/api/community/posts/${postId}`, { method: 'DELETE', headers: authHeaders() }); const payload = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de supprimer la publication'); },
  async createCommunityComment(postId: number, content: string, parentCommentId: number | null = null): Promise<CommunityComment> { const response = await fetch(`/api/community/posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ content, parentCommentId }) }); const payload = await response.json() as { data?: CommunityComment; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible d’ajouter le commentaire'); return payload.data },
  async updateCommunityComment(commentId: number, content: string): Promise<Pick<CommunityComment, 'id' | 'content'>> { const response = await fetch(`/api/community/comments/${commentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ content }) }); const payload = await response.json() as { data?: Pick<CommunityComment, 'id' | 'content'>; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de modifier le commentaire'); return payload.data },
  async setCommunityCommentHidden(commentId: number, hidden: boolean): Promise<void> { const response = await fetch(`/api/community/comments/${commentId}/visibility`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ hidden }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de modifier la visibilité du commentaire'); },
  async deleteCommunityComment(commentId: number): Promise<void> { const response = await fetch(`/api/community/comments/${commentId}`, { method: 'DELETE', headers: authHeaders() }); const payload = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de supprimer le commentaire'); },
  async communityChatAgents(): Promise<ChatAgent[]> { const response = await fetch('/api/community/chat/agents', { headers: authHeaders() }); const payload = await response.json() as { data?: ChatAgent[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les agents'); return payload.data },
  async communityChatConversations(): Promise<ChatConversation[]> { const response = await fetch('/api/community/chat/conversations', { headers: authHeaders() }); const payload = await response.json() as { data?: ChatConversation[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les conversations'); return payload.data },
  async startCommunityChat(agentId: number): Promise<number> { const response = await fetch('/api/community/chat/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ agentId }) }); const payload = await response.json() as { data?: { id: number }; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de démarrer la conversation'); return payload.data.id },
  async setCommunityChatArchived(conversationId: number, archived: boolean): Promise<string | null> { const response = await fetch(`/api/community/chat/conversations/${conversationId}/archive`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ archived }) }); const payload = await response.json() as { data?: { archivedAt: string | null }; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de modifier l’archivage'); return payload.data.archivedAt },
  async deleteCommunityChatConversation(conversationId: number): Promise<void> { const response = await fetch(`/api/community/chat/conversations/${conversationId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ scope: 'me' }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de supprimer la conversation'); },
  async sendCommunityChatMedia(conversationId: number, media: File, caption: string): Promise<ChatMessage> { const form = new FormData(); form.append('media', media); form.append('caption', caption); const response = await fetch(`/api/community/chat/conversations/${conversationId}/messages/media`, { method: 'POST', headers: authHeaders(), body: form }); const payload = await response.json() as { data?: ChatMessage; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible d’envoyer le média'); return payload.data },
  async communityChatMedia(url: string): Promise<Blob> { const response = await fetch(url, { headers: authHeaders() }); if (!response.ok) throw new Error('Impossible de charger le média.'); return response.blob() },
  async deleteCommunityChatMessage(conversationId: number, messageId: number): Promise<{ deletedMessage: ChatMessage; lastMessage: ChatMessage | null; updatedAt: string; unreadCount: number }> { const response = await fetch(`/api/community/chat/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE', headers: authHeaders() }); const payload = await response.json() as { data?: { deletedMessage: ChatMessage; lastMessage: ChatMessage | null; updatedAt: string; unreadCount: number }; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de supprimer le message'); return payload.data },
  async hideCommunityChatMessage(conversationId: number, messageId: number): Promise<{ lastMessage: ChatMessage | null; updatedAt: string; unreadCount: number }> { const response = await fetch(`/api/community/chat/conversations/${conversationId}/messages/${messageId}/me`, { method: 'DELETE', headers: authHeaders() }); const payload = await response.json() as { data?: { lastMessage: ChatMessage | null; updatedAt: string; unreadCount: number }; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de supprimer le message pour vous'); return payload.data },
  async communityChatMessages(conversationId: number): Promise<ChatMessage[]> { const response = await fetch(`/api/community/chat/conversations/${conversationId}/messages`, { headers: authHeaders() }); const payload = await response.json() as { data?: ChatMessage[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les messages'); return payload.data },
  async markCommunityChatRead(conversationId: number): Promise<void> { const response = await fetch(`/api/community/chat/conversations/${conversationId}/read`, { method: 'PATCH', headers: authHeaders() }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de marquer les messages comme lus'); },
  async setCommunityLike(postId: number, liked: boolean): Promise<{ liked: boolean; likesCount: number }> { const response = await fetch(`/api/community/posts/${postId}/like`, { method: liked ? 'POST' : 'DELETE', headers: authHeaders() }); const payload = await response.json() as { data?: { liked: boolean; likesCount: number }; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de modifier la réaction'); return payload.data; },
  async reportCommunityContent(input: { targetType: 'POST' | 'COMMENT'; targetId: number; reason: string }): Promise<void> { const response = await fetch('/api/community/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de signaler ce contenu'); },
  async adminCommunityReports(): Promise<CommunityContentReport[]> { const response = await fetch('/api/admin/community/reports', { headers: authHeaders() }); const payload = await response.json() as { data?: CommunityContentReport[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les signalements'); return payload.data },
  async moderateCommunityReport(id: number, action: 'HIDE' | 'DISMISS'): Promise<void> { const response = await fetch(`/api/admin/community/reports/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ action }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? 'Impossible de traiter le signalement'); },
  async adminApplications(): Promise<AdminApplication[]> { const response = await fetch('/api/admin/applications', { headers: authHeaders() }); const payload = await response.json() as { data: AdminApplication[] }; return payload.data },
  async updateApplication(id: number, status: string, decisionReason?: string): Promise<ApplicationDecision> { const response = await fetch(`/api/admin/applications/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ status, decisionReason }) }); const payload = await response.json().catch(() => ({})) as ApplicationDecision & { error?: string }; if (!response.ok) throw new Error(payload.error ?? `Erreur serveur (${response.status}) pendant le traitement de l’inscription`); return payload },
  async resendApplicationApprovalEmail(id: number): Promise<string> { const response = await fetch(`/api/admin/applications/${id}/resend-approval-email`, { method: 'POST', headers: authHeaders() }); const payload = await response.json().catch(() => ({})) as { message?: string; error?: string }; if (!response.ok) throw new Error(payload.error ?? `Erreur serveur (${response.status}) pendant le renvoi de l’email`); return payload.message ?? 'Email de confirmation renvoyé.' },
  async activateAccount(email: string, token: string, password: string): Promise<{ token: string; user: SessionUser }> { const response = await fetch('/api/auth/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, token, password }) }); const payload = await response.json() as { token?: string; user?: SessionUser; error?: string }; if (!response.ok || !payload.token || !payload.user) throw new Error(payload.error ?? 'Activation impossible'); return { token: payload.token, user: payload.user } },
  async adminReports(): Promise<AdminReport[]> { const response = await fetch('/api/admin/reports', { headers: authHeaders() }); const payload = await response.json() as { data?: AdminReport[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les rapports admin'); return payload.data },
  async updateReport(id: number, status: string, options: { rejectionReason?: string; contractSigned?: boolean } = {}): Promise<void> { const response = await fetch(`/api/admin/reports/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ status, ...options }) }); const payload = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(payload.error ?? `Impossible de mettre à jour le rapport (${response.status})`) },
  async adminWithdrawals(): Promise<AdminWithdrawal[]> { const response = await fetch('/api/admin/withdrawals', { headers: authHeaders() }); const payload = await response.json() as { data?: AdminWithdrawal[]; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Impossible de charger les demandes de retrait'); return payload.data },
  async updateWithdrawal(id: number, status: string, paymentReference?: string, rejectReason?: string, totp?: string): Promise<{ warning?: string }> { const response = await fetch(`/api/admin/withdrawals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(totp ? { 'x-admin-totp': totp } : {}) }, body: JSON.stringify({ status, paymentReference, rejectReason }) }); const payload = await response.json().catch(() => ({})) as { error?: string; warning?: string }; if (!response.ok) throw new Error(payload.error ?? `Impossible de mettre à jour le retrait (${response.status})`); return { warning: payload.warning } },
}

function authHeaders(): Record<string, string> { const token = window.localStorage.getItem('innovcom-token'); return token ? { Authorization: `Bearer ${token}` } : {} }

export default api
