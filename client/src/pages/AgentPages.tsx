import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import api, { type AgentStats, type SessionUser } from '../api/client'
import type { Report } from '../types/report'
import Metric from '../components/dashboard/Metric'
import ReportTable from '../components/reports/ReportTable'
import useCommissionAmounts from '../hooks/useCommissionAmounts'
import tySyNdayLogo from '../assets/TD.png'
import QRCode from 'qrcode'
import Swal from 'sweetalert2'
import { BadgeCheck, Camera, Download, FilePlus2, Mail, MapPin, Phone, QrCode } from 'lucide-react'
import './AgentPages.css'
import { SubscriberBadge } from '../components/ui/SubscriberBadge'
import { AgentPresenceDot } from '../components/ui/AgentPresence'
import { useI18n } from '../i18n'

const money = (amount: number, language: 'fr' | 'en' = 'fr') => new Intl.NumberFormat(language === 'en' ? 'en-US' : 'fr-FR').format(amount)

export function DashboardPage({ reports, user, onNewReport, onViewReports }: { reports: Report[]; user: SessionUser; onNewReport: () => void; onViewReports: () => void }) {
  const { language, t } = useI18n()
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [statsError, setStatsError] = useState('')
  const commissionState = useCommissionAmounts()
  useEffect(() => {
    let active = true
    api.agentStats()
      .then((data) => { if (active) { setStats(data); setStatsError('') } })
      .catch((caught) => { if (active) setStatsError(caught instanceof Error ? t(caught.message) : t('Impossible de charger vos statistiques.')) })
    return () => { active = false }
  }, [user.id, t])
  const firstName = user.profile?.firstName || user.email.split('@')[0]
  const statusRows = [
    { key: 'SOUMIS', label: t('En attente') },
    { key: 'VALIDE', label: t('Validé · à payer') },
    { key: 'PAYE', label: t('Payé') },
    { key: 'REJETE', label: t('Rejeté') },
  ]
  return <div className="agent-dashboard">
    <section className="welcome-row agent-dashboard-welcome"><div><p className="eyebrow">{t('ESPACE AGENT')}</p><h1>{t('Bonjour')} {firstName} <span>✦</span></h1><p className="intro">{t('Retrouvez ici votre activité et vos résultats.')}</p></div><button className="primary-button" onClick={onNewReport}><FilePlus2 size={17} aria-hidden="true" /> {t('Nouveau rapport')}</button></section>
    {statsError && <p className="settings-error" role="alert">{statsError}</p>}
    <section className="metric-grid agent-dashboard-metrics" aria-label={t('Indicateurs clés')}>
      <Metric label={t('Solde disponible')} value={stats ? money(stats.availableBalance, language) : '—'} suffix="Ar" note={t('Après retraits payés et en cours')} />
      <Metric label={t('Rapports en attente')} value={stats ? String(stats.pendingReports) : '—'} suffix={t('rapport(s)')} note={t('À traiter ou compléter')} />
      <Metric label={t('Total gagné')} value={stats ? money(stats.totalGains, language) : '—'} suffix="Ar" note={t('Rapports et commissions de collaboration')} />
      <Metric label={t('Taux de validation')} value={stats ? String(stats.validationRate) : '—'} suffix="%" note={t('Sur les rapports examinés')} trend />
    </section>
    <section className="agent-commission-section agent-dashboard-commissions">
      <div className="panel-heading"><div><span className="section-kicker">{t('BARÈME EN VIGUEUR')}</span><h2>{t('Commissions configurées par l’administration')}</h2></div></div>
      {commissionState.status === 'error' && <p className="settings-error" role="alert">{t(commissionState.error)}</p>}
      {commissionState.status === 'ready' && commissionState.error && <p className="settings-error" role="alert">{t('Actualisation impossible :')} {t(commissionState.error)}. {t('Les derniers montants chargés restent affichés.')}</p>}
      <div className="agent-commission-grid">
        <Metric label={t('Apport de contact')} value={commissionState.status === 'ready' ? money(commissionState.amounts.LEAD, language) : '—'} suffix="Ar" note={t('Après signature du contrat')} />
        <Metric label={t('Vente d’un contact fourni')} value={commissionState.status === 'ready' ? money(commissionState.amounts.PROVIDED_CONTACT, language) : '—'} suffix="Ar" note={t('Après signature du contrat')} />
        <Metric label={t('Prospection + vente')} value={commissionState.status === 'ready' ? money(commissionState.amounts.FULL_CYCLE, language) : '—'} suffix="Ar" note={t('Type 1 + Type 2')} />
      </div>
    </section>
    <div className="dashboard-grid agent-dashboard-content">
      <section className="panel chart-panel agent-activity-panel"><div className="panel-heading"><div><span className="section-kicker">{t('MES RAPPORTS')}</span><h2>{t('État de mon activité')}</h2></div></div><div className="transaction-list">{statusRows.map(({ key, label }) => <div className="agent-activity-row" key={key}><span className={`agent-activity-dot is-${key.toLowerCase()}`} aria-hidden="true" /><strong>{label}</strong><b>{stats?.reportCounts[key] ?? '—'}</b></div>)}</div></section>
      <section className="panel reports-panel agent-reports-panel"><div className="panel-heading"><div><span className="section-kicker">{t('DERNIÈRES DÉMARCHES')}</span><h2>{t('Mes rapports récents')}</h2></div><button className="text-button" onClick={onViewReports}>{t('Tout voir')} <span>→</span></button></div>{reports.length ? <ReportTable reports={reports.slice(0, 5)} /> : <div className="empty-state">{t('Aucun rapport enregistré pour le moment.')}</div>}</section>
    </div>
  </div>
}

export function ProfilePage({ user, onUserUpdate }: { user: SessionUser; onUserUpdate: (user: SessionUser) => void }) {
  const { language, t } = useI18n()
  const fullName = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ') || user.email
  const initials = fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  const phone = user.profile?.phone || ''
  const city = user.profile?.city || ''
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [badgeError, setBadgeError] = useState('')
  const [badgeStatusError, setBadgeStatusError] = useState('')
  const [isSubscriber, setIsSubscriber] = useState(false)
  const [badgeExpiresAt, setBadgeExpiresAt] = useState<number | null>(null)
  const [downloadingBadge, setDownloadingBadge] = useState(false)
  const [qrCode, setQrCode] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoMessage, setPhotoMessage] = useState('')
  const [photoError, setPhotoError] = useState('')

  useEffect(() => {
    let active = true
    const refreshSubscriberStatus = () => {
      api.subscriptionOverview()
        .then((overview) => {
          if (!active) return
          setIsSubscriber(Boolean(overview.current))
          setBadgeExpiresAt(overview.current?.expiresAt ? new Date(overview.current.expiresAt).getTime() : null)
          setBadgeStatusError('')
        })
        .catch((caught) => {
          if (active) setBadgeStatusError(caught instanceof Error ? t(caught.message) : t('Impossible de vérifier le statut du badge abonné.'))
        })
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshSubscriberStatus()
    }
    refreshSubscriberStatus()
    const refreshTimer = window.setInterval(refreshSubscriberStatus, 60_000)
    window.addEventListener('focus', refreshSubscriberStatus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', refreshSubscriberStatus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [user.id, t])

  useEffect(() => {
    if (!isSubscriber || badgeExpiresAt === null) return
    const maxTimeout = 2_147_483_647
    let timer: number | undefined
    const checkExpiration = () => {
      const remaining = badgeExpiresAt - Date.now()
      if (remaining <= 0) {
        setIsSubscriber(false)
        return
      }
      timer = window.setTimeout(checkExpiration, Math.min(remaining, maxTimeout))
    }
    checkExpiration()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [isSubscriber, badgeExpiresAt])

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setPhotoMessage('')
    setPhotoError('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError(t('Choisissez une image JPEG, PNG ou WebP.'))
      input.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError(t('La photo ne doit pas dépasser 5 Mo.'))
      input.value = ''
      return
    }

    setUploadingPhoto(true)
    try {
      const updatedUser = await api.uploadProfilePhoto(file)
      onUserUpdate(updatedUser)
      setPhotoMessage('Votre photo de profil a été mise à jour.')
    } catch (caught) {
      setPhotoError(caught instanceof Error ? t(caught.message) : t('Impossible d’enregistrer la photo.'))
    } finally {
      setUploadingPhoto(false)
      input.value = ''
    }
  }

  useEffect(() => {
    let active = true
    QRCode.toDataURL(buildAgentVCard({ fullName, email: user.email, phone, city }), {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 280,
      color: { dark: '#3b176f', light: '#ffffff' },
    })
      .then((dataUrl) => { if (active) setQrCode(dataUrl) })
      .catch((caught: unknown) => {
        if (active) setBadgeError(caught instanceof Error ? t(caught.message) : t('Impossible de générer le QR code.'))
      })
    return () => { active = false }
  }, [fullName, user.email, phone, city, t])

  async function downloadBadge() {
    setBadgeError('')
    setDownloadingBadge(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 900
      canvas.height = 1400
      const context = canvas.getContext('2d')
      if (!context) throw new Error(t('Impossible de préparer le badge.'))

      const logo = new Image()
      logo.src = tySyNdayLogo
      await logo.decode()
      let portrait: HTMLImageElement | null = null
      if (user.profile?.imageUrl) {
        portrait = new Image()
        portrait.src = user.profile.imageUrl
        await portrait.decode()
      }
      const qrDataUrl = await QRCode.toDataURL(buildAgentVCard({ fullName, email: user.email, phone, city }), {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 360,
        color: { dark: '#3b176f', light: '#ffffff' },
      })
      const qrImage = new Image()
      qrImage.src = qrDataUrl
      await qrImage.decode()
      drawAgentBadge(context, logo, qrImage, portrait, { fullName, email: user.email, phone, city }, language)

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error(t('Impossible de générer le fichier PNG.'))

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `badge-${fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (caught) {
      setBadgeError(caught instanceof Error ? t(caught.message) : t('Le téléchargement du badge a échoué.'))
    } finally {
      setDownloadingBadge(false)
    }
  }

  return <>
    <section className="page-heading profile-page-heading">
      <div>
        <p className="eyebrow">{t('MON ESPACE')}</p>
          <h1>{t('Mon profil')}</h1>
          <p className="intro">{t('Gérez votre identité professionnelle et partagez vos coordonnées.')}</p>
      </div>
      <span className="profile-member-id">{t('AGENT N°')} {String(user.id).padStart(5, '0')}</span>
    </section>
    <section className="profile-overview panel">
      <div className="profile-overview-banner">
        <div className="profile-brand-mark"><img src={tySyNdayLogo} alt="" /><span>TY SY NDAY <small>BUSINESS</small></span></div>
        <span className={`profile-account-status ${user.status === 'ACTIF' ? 'is-active' : ''}`}>
          <span />{user.status === 'ACTIF' ? t('Compte actif') : t(user.status)}
        </span>
      </div>
      <div className="profile-overview-content">
        <div className="profile-identity">
          <div className="profile-avatar-column">
            <div className="profile-large">{user.profile?.imageUrl ? <img src={user.profile.imageUrl} alt={`${t('Photo de profil de')} ${fullName}`} /> : initials}<AgentPresenceDot userId={user.id} /></div>
            <button className="profile-photo-action" type="button" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>
            <Camera size={14} />{uploadingPhoto ? t('Enregistrement...') : user.profile?.imageUrl ? t('Modifier la photo') : t('Ajouter une photo')}
            </button>
            <input ref={photoInputRef} className="profile-photo-input" type="file" aria-label={t('Choisir une photo de profil')} accept="image/jpeg,image/png,image/webp" onChange={(event) => void handlePhotoChange(event)} />
            {photoError && <p className="profile-photo-message is-error" role="alert">{photoError}</p>}
            {photoMessage && <p className="profile-photo-message is-success" role="status">{photoMessage}</p>}
          </div>
          <div>
            <p className="profile-overline">{t('AGENT COMMERCIAL')}</p>
            <h2><span className="profile-name-text">{fullName}</span>{isSubscriber && <SubscriberBadge />}</h2>
            {badgeStatusError && <p className="profile-photo-message is-error" role="status">{badgeStatusError}</p>}
            <span className="profile-verified"><BadgeCheck size={15} /> {t('Membre de l’équipe')}</span>
          </div>
        </div>
        <div className="profile-contact-section">
          <div className="profile-section-heading">
            <div><span className="section-kicker">{t('MES COORDONNÉES')}</span><h3>{t('Informations professionnelles')}</h3></div>
          </div>
          <div className="profile-contact-grid">
            <div className="profile-contact-item"><span className="profile-contact-icon"><Mail size={17} /></span><span><small>{t('Email professionnel')}</small><strong>{user.email}</strong></span></div>
            <div className="profile-contact-item"><span className="profile-contact-icon"><Phone size={17} /></span><span><small>{t('Téléphone')}</small><strong>{phone || t('Non renseigné')}</strong></span></div>
            <div className="profile-contact-item"><span className="profile-contact-icon"><MapPin size={17} /></span><span><small>{t('Ville')}</small><strong>{city || t('Non renseignée')}</strong></span></div>
          </div>
        </div>
      </div>
    </section>
    <section className="badge-generator panel">
      <div className="badge-generator-copy">
        <span className="badge-generator-icon"><QrCode size={21} /></span>
        <p className="eyebrow">{t('VOTRE IDENTITÉ, PARTOUT AVEC VOUS')}</p>
        <h2>{t('Un badge à votre image')}</h2>
        <p>{t('Partagez facilement vos coordonnées professionnelles grâce à votre badge personnalisé et son QR code.')}</p>
        <div className="badge-generator-benefit"><BadgeCheck size={16} /><span>{t('Vos coordonnées prêtes à être enregistrées en un scan')}</span></div>
        {badgeError && <p className="badge-generator-error" role="alert">{badgeError}</p>}
        <button className="primary-button" type="button" onClick={() => void downloadBadge()} disabled={downloadingBadge}>
          <Download size={17} />{downloadingBadge ? t('Génération du badge...') : t('Télécharger mon badge')}
        </button>
      </div>
      <div className="badge-preview-wrap" aria-label={t('Aperçu du badge personnalisé')}>
        <article className="agent-badge">
          <div className="agent-badge-header">
            <div className="agent-badge-logo"><img src={tySyNdayLogo} alt="Ty sy Nday Business" /></div>
          </div>
          {user.profile?.imageUrl && <img className="agent-badge-portrait" src={user.profile.imageUrl} alt="" />}
          <div className="agent-badge-content">
            <span className="agent-badge-label">{t('ÉQUIPE')}</span>
            <strong className="agent-badge-name">{fullName}</strong>
            <span className="agent-badge-role">{t('Agent commercial')}</span>
            <div className="agent-badge-details">
              {phone && <span>☎ {phone}</span>}
              <span>✉ {user.email}</span>
              {city && <span>⌖ {city}</span>}
            </div>
            {qrCode && <div className="agent-badge-qr"><img src={qrCode} alt={t('QR code pour enregistrer les coordonnées de l’agent')} /><span>{t('Scanner pour enregistrer')}</span></div>}
          </div>
          <div className="agent-badge-footer">{t('Ensemble pour vos projets')}</div>
        </article>
        <span className="badge-preview-caption">{t('APERÇU DE VOTRE BADGE')}</span>
      </div>
    </section>
  </>
}

function drawAgentBadge(
  context: CanvasRenderingContext2D,
  logo: HTMLImageElement,
  qrCode: HTMLImageElement,
  portrait: HTMLImageElement | null,
  details: { fullName: string; email: string; phone: string; city: string },
  language: 'fr' | 'en',
) {
  const width = 900
  const height = 1400
  context.clearRect(0, 0, width, height)
  context.save()
  context.beginPath()
  context.roundRect(0, 0, width, height, 48)
  context.clip()

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  const header = context.createLinearGradient(0, 0, width, 380)
  header.addColorStop(0, '#c86be8')
  header.addColorStop(1, '#4f72ff')
  context.fillStyle = header
  context.fillRect(0, 0, width, 380)
  context.beginPath()
  context.moveTo(500, 0)
  context.lineTo(width, 0)
  context.lineTo(width, 310)
  context.lineTo(720, 245)
  context.closePath()
  context.fillStyle = 'rgba(255,255,255,0.12)'
  context.fill()

  context.fillStyle = '#ffffff'
  context.beginPath()
  context.roundRect(280, 75, 340, 340, 40)
  context.fill()
  context.drawImage(logo, 305, 100, 290, 290)

  if (portrait) {
    context.save()
    context.beginPath()
    context.arc(width / 2, 430, 64, 0, Math.PI * 2)
    context.fillStyle = '#ffffff'
    context.fill()
    context.beginPath()
    context.arc(width / 2, 430, 57, 0, Math.PI * 2)
    context.clip()
    context.drawImage(portrait, width / 2 - 57, 373, 114, 114)
    context.restore()
  }

  context.textAlign = 'center'
  context.fillStyle = '#4f72ff'
  context.font = '700 30px Arial'
  context.fillText(language === 'en' ? 'TEAM' : 'ÉQUIPE', width / 2, portrait ? 525 : 510)
  context.fillStyle = '#1e1b4b'
  drawFittedBadgeText(context, details.fullName, width / 2, portrait ? 595 : 580, 780, 68, 42, 'Archivo, sans-serif')
  context.fillStyle = '#6b7280'
  context.font = '28px Arial'
  context.fillText(language === 'en' ? 'Sales agent' : 'Agent commercial', width / 2, portrait ? 650 : 635)

  context.strokeStyle = '#e5e1fa'
  context.lineWidth = 3
  context.beginPath()
  context.moveTo(125, portrait ? 705 : 690)
  context.lineTo(775, portrait ? 705 : 690)
  context.stroke()

  const contactLines = [details.phone, details.email, details.city].filter(Boolean)
  context.fillStyle = '#37315f'
  context.font = '24px Arial'
  contactLines.forEach((line, index) => {
    drawFittedBadgeText(context, line, width / 2, (portrait ? 755 : 740) + index * 38, 740, 22, 16)
  })

  context.fillStyle = '#ffffff'
  context.beginPath()
  context.roundRect(335, portrait ? 870 : 855, 230, 230, 20)
  context.fill()
  context.drawImage(qrCode, 350, portrait ? 885 : 870, 200, 200)
  context.fillStyle = '#6b7280'
  context.font = '18px Arial'
  context.fillText(language === 'en' ? 'Scan to save' : 'Scanner pour enregistrer', width / 2, portrait ? 1125 : 1110)

  const footer = context.createLinearGradient(0, 1160, width, height)
  footer.addColorStop(0, '#c86be8')
  footer.addColorStop(1, '#4f72ff')
  context.beginPath()
  context.moveTo(0, 1210)
  context.bezierCurveTo(240, 1125, 550, 1300, width, 1140)
  context.lineTo(width, height)
  context.lineTo(0, height)
  context.closePath()
  context.fillStyle = footer
  context.fill()
  context.fillStyle = '#ffffff'
  context.font = 'italic 34px Arial'
  context.fillText(language === 'en' ? 'Together for your projects' : 'Ensemble pour vos projets', width / 2, 1320)
  context.restore()
}

function buildAgentVCard(details: { fullName: string; email: string; phone: string; city: string }) {
  const escapeValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([;,])/g, '\\$1')
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeValue(details.fullName)}`,
    `N:${escapeValue(details.fullName)}`,
    'ORG:Ty sy Nday Business',
    `EMAIL;TYPE=WORK:${escapeValue(details.email)}`,
  ]
  if (details.phone) lines.push(`TEL;TYPE=WORK,VOICE:${escapeValue(details.phone)}`)
  if (details.city) lines.push(`ADR;TYPE=WORK:;;${escapeValue(details.city)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

function drawFittedBadgeText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  initialSize: number,
  minimumSize: number,
  fontFamily = 'Arial',
) {
  let fontSize = initialSize
  context.fillStyle = '#3b176f'
  context.font = `800 ${fontSize}px ${fontFamily}`
  while (context.measureText(text).width > maxWidth && fontSize > minimumSize) {
    fontSize -= 1
    context.font = `800 ${fontSize}px ${fontFamily}`
  }
  context.fillText(text, x, y, maxWidth)
}

export function WalletPage() {
  const { language, t } = useI18n()
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function refresh() { setStats(await api.agentStats()) }
  useEffect(() => { refresh().catch((caught) => setError(caught instanceof Error ? t(caught.message) : t('Impossible de charger le portefeuille.'))) }, [t])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      await api.createWithdrawal({ amount: Number(form.get('amount')), operator: String(form.get('operator')), phoneNumber: String(form.get('phoneNumber')) })
      setWithdrawOpen(false)
      setError('')
      void Swal.fire({
        icon: 'success',
        title: t('Demande envoyée'),
        text: t('Votre demande de retrait a été enregistrée et transmise à l’administration.'),
        confirmButtonText: t('Continuer'),
        width: '22rem',
        padding: '1rem',
        customClass: { popup: 'withdrawal-success-alert' },
      })
      try {
        await refresh()
      } catch {
        setError(t('Votre retrait est enregistré, mais le portefeuille n’a pas pu être actualisé. Rechargez la page pour voir le solde à jour.'))
      }
    } catch (caught) {
      setError(caught instanceof Error ? t(caught.message) : t('Impossible de créer la demande de retrait.'))
    } finally {
      setSaving(false)
    }
  }

  const history = [
    ...(stats?.transactions ?? []).map((item) => ({ id: `t-${item.id}`, type: 'transaction', amount: item.amount, label: item.note || (item.reportName ? `${t('Gain rapport :')} ${item.reportName}` : t('Transaction')), createdAt: item.createdAt, status: item.type })),
    ...(stats?.withdrawals ?? []).map((item) => ({ id: `w-${item.id}`, type: 'withdrawal', amount: -item.amount, label: `${t('Retrait')} ${item.operator} · ${item.phoneNumber}`, createdAt: item.createdAt, status: item.status })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

  return <>
    <section className="page-heading"><div><p className="eyebrow">{t('MES FINANCES')}</p><h1>{t('Portefeuille')}</h1><p className="intro">{t('Vos commissions disponibles sont créditées ici. Demandez un retrait lorsque vous le souhaitez.')}</p></div><button className="primary-button" disabled={!stats || stats.availableBalance < stats.withdrawalMinimum} onClick={() => { setError(''); setWithdrawOpen(true) }}>{t('Demander un retrait')}</button></section>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="wallet-grid"><article className="wallet-balance"><span>{t('Solde disponible')}</span><strong>{stats ? money(stats.availableBalance, language) : '—'} <small>Ar</small></strong><p>{t('Après retraits en attente; minimum :')} {stats ? money(stats.withdrawalMinimum, language) : '—'} Ar</p></article><article className="metric"><span className="metric-label">{t('Retraits en attente')}</span><div className="metric-value"><strong>{stats ? money(stats.pendingWithdrawals, language) : '—'}</strong><small>Ar</small></div><span className="metric-note">{t('Demandés ou approuvés')}</span></article><article className="metric"><span className="metric-label">{t('Total retiré')}</span><div className="metric-value"><strong>{stats ? money(stats.totalWithdrawn, language) : '—'}</strong><small>Ar</small></div><span className="metric-note">{t('Paiements confirmés')}</span></article></div>
    <section className="panel reports-panel"><div className="panel-heading"><h2>{t('Historique du portefeuille')}</h2></div>{history.length ? <div className="transaction-list">{history.map((item) => <div key={item.id}><span className={`transaction-icon ${item.type === 'transaction' ? 'gain' : 'withdrawal'}`}>{item.type === 'transaction' ? '＋' : '↗'}</span><strong>{item.label}<small>{new Date(item.createdAt).toLocaleDateString(language === 'en' ? 'en-US' : 'fr-FR')} · {t(item.status)}</small></strong><b className={item.amount >= 0 ? 'gain-text' : ''}>{item.amount > 0 ? '+' : ''}{money(item.amount, language)} Ar</b></div>)}</div> : <div className="empty-state">{t('Aucune transaction ni demande de retrait enregistrée.')}</div>}</section>
    {withdrawOpen && <div className="modal-backdrop withdrawal-modal-backdrop" onClick={() => { if (!saving) setWithdrawOpen(false) }}><form className="modal withdrawal-modal" role="dialog" aria-modal="true" aria-labelledby="withdrawal-modal-title" onSubmit={submit} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" aria-label={t('Fermer la demande de retrait')} disabled={saving} onClick={() => setWithdrawOpen(false)}>×</button><p className="eyebrow">{t('PORTEFEUILLE')}</p><h2 id="withdrawal-modal-title">{t('Demander un retrait')}</h2><label>{t('Montant (Ar)')}<input name="amount" type="number" min={stats?.withdrawalMinimum ?? 1} max={stats?.availableBalance ?? 0} step="1" required /></label><label>{t('Opérateur')}<select name="operator" required><option value="MVola">MVola</option><option value="Orange Money">Orange Money</option><option value="Airtel Money">Airtel Money</option></select></label><label>{t('Numéro de paiement')}<input name="phoneNumber" type="tel" minLength={7} maxLength={30} required /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="outline-button" disabled={saving} onClick={() => setWithdrawOpen(false)}>{t('Annuler')}</button><button className="primary-button" disabled={saving}>{saving ? t('Envoi...') : t('Envoyer la demande')}</button></div></form></div>}
  </>
}