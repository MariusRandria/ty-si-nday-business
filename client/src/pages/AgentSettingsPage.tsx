import { useEffect, useState, type FormEvent } from 'react'
import { Bell, BellOff, Check, Globe2, KeyRound, LockKeyhole, MapPin, Mic, Moon, ShieldCheck, Sun } from 'lucide-react'
import api, { type SessionUser } from '../api/client'
import { useI18n } from '../i18n'
import './AgentSettingsPage.css'

type Theme = 'light' | 'dark'
type PermissionValue = PermissionState | 'unavailable' | 'loading'

export default function AgentSettingsPage({ user, theme, onToggleTheme }: { user: SessionUser; theme: Theme; onToggleTheme: () => void }) {
  const { language, setLanguage, t } = useI18n()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [pushState, setPushState] = useState<'loading' | 'enabled' | 'disabled' | 'unsupported' | 'denied'>('loading')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')
  const [pushMessage, setPushMessage] = useState('')
  const [permissions, setPermissions] = useState<{ geolocation: PermissionValue; microphone: PermissionValue }>({
    geolocation: 'loading',
    microphone: 'loading',
  })

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPushState('unsupported')
      return
    }

    let active = true
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (active) setPushState(Notification.permission === 'denied' ? 'denied' : subscription ? 'enabled' : 'disabled')
      })
      .catch((caught: unknown) => {
        if (!active) return
        setPushState('disabled')
        setPushError(caught instanceof Error ? caught.message : t('Impossible de préparer les notifications système.'))
      })
    return () => { active = false }
  }, [t])

  useEffect(() => {
    if (!navigator.permissions) {
      setPermissions({ geolocation: 'unavailable', microphone: 'unavailable' })
      return
    }

    let active = true
    const subscriptions: PermissionStatus[] = []
    const watchPermission = async (name: 'geolocation' | 'microphone') => {
      try {
        const status = await navigator.permissions.query({ name })
        if (!active) return
        subscriptions.push(status)
        setPermissions((current) => ({ ...current, [name]: status.state }))
        status.onchange = () => setPermissions((current) => ({ ...current, [name]: status.state }))
      } catch {
        if (active) setPermissions((current) => ({ ...current, [name]: 'unavailable' }))
      }
    }
    void watchPermission('geolocation')
    void watchPermission('microphone')
    return () => {
      active = false
      subscriptions.forEach((status) => { status.onchange = null })
    }
  }, [])

  async function togglePushNotifications() {
    setPushBusy(true)
    setPushError('')
    setPushMessage('')
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js')
      const currentSubscription = await registration.pushManager.getSubscription()
      if (currentSubscription) {
        await api.removePushSubscription(currentSubscription.endpoint)
        await currentSubscription.unsubscribe()
        setPushState('disabled')
        setPushMessage(t('Les notifications système sont désactivées sur cet appareil.'))
        return
      }

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushState(permission === 'denied' ? 'denied' : 'disabled')
        if (permission === 'denied') throw new Error(t('Autorisez les notifications dans les paramètres de votre navigateur pour les activer.'))
        return
      }

      const publicKey = await api.webPushPublicKey()
      const base64Key = publicKey.replace(/-/g, '+').replace(/_/g, '/')
      const paddedKey = base64Key + '='.repeat((4 - base64Key.length % 4) % 4)
      const applicationServerKey = Uint8Array.from(atob(paddedKey), (character) => character.charCodeAt(0))
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
      try {
        await api.savePushSubscription(subscription)
      } catch (caught) {
        await subscription.unsubscribe()
        throw caught
      }
      setPushState('enabled')
      setPushMessage(t('Les notifications système sont activées sur cet appareil.'))
    } catch (caught) {
      setPushError(caught instanceof Error ? t(caught.message) : t('Impossible de modifier les notifications système.'))
    } finally {
      setPushBusy(false)
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    if (newPassword !== confirmPassword) {
      setPasswordError(t('Les mots de passe ne correspondent pas.'))
      return
    }
    if (currentPassword === newPassword) {
      setPasswordError(t('Le nouveau mot de passe doit être différent du mot de passe actuel.'))
      return
    }

    setPasswordBusy(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage(t('Mot de passe mis à jour.'))
    } catch (caught) {
      setPasswordError(caught instanceof Error ? t(caught.message) : t('Impossible de préparer la modification du mot de passe.'))
    } finally {
      setPasswordBusy(false)
    }
  }

  const permissionLabel = (value: PermissionValue) => {
    if (value === 'loading') return t('Vérification...')
    if (value === 'unavailable') return t('Indisponible')
    if (value === 'granted') return t('Autorisé')
    if (value === 'denied') return t('Bloqué')
    return t('À la demande')
  }

  const fullName = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ')
  const accountName = fullName || user.email

  return (
    <div className="agent-settings-page">
      <header className="page-heading agent-settings-heading">
        <div>
          <p className="eyebrow">{t('MON ESPACE')}</p>
          <h1>{t('Paramètres du compte')}</h1>
          <p className="intro">{t('Gérez vos préférences, votre sécurité et les autorisations de cet appareil.')}</p>
        </div>
        <span className="agent-settings-account-chip"><ShieldCheck size={16} />{t('Compte actif')}</span>
      </header>

      <section className="agent-settings-section" aria-labelledby="settings-preferences-title">
        <div className="agent-settings-section-heading">
          <span className="agent-settings-section-icon"><Sun size={19} /></span>
          <div><p className="section-kicker">{t('Préférences')}</p><h2 id="settings-preferences-title">{t('Personnalisez votre espace')}</h2></div>
        </div>
        <div className="agent-settings-grid">
          <article className="panel agent-settings-card">
            <div className="agent-settings-card-heading"><span className="agent-settings-icon"><Moon size={18} /></span><div><h3>{t('Apparence')}</h3><p>{t('Choisissez le thème qui vous convient.')}</p></div></div>
            <div className="agent-settings-choice-list" role="radiogroup" aria-label={t('Apparence')}>
              <button type="button" role="radio" aria-checked={theme === 'light'} className={`agent-settings-choice${theme === 'light' ? ' is-selected' : ''}`} onClick={() => { if (theme !== 'light') onToggleTheme() }}>
                <Sun size={19} /><span><strong>{t('Thème clair')}</strong><small>{t('Un affichage lumineux, idéal en journée.')}</small></span>{theme === 'light' && <Check size={18} />}
              </button>
              <button type="button" role="radio" aria-checked={theme === 'dark'} className={`agent-settings-choice${theme === 'dark' ? ' is-selected' : ''}`} onClick={() => { if (theme !== 'dark') onToggleTheme() }}>
                <Moon size={19} /><span><strong>{t('Thème sombre')}</strong><small>{t('Un affichage reposant en faible luminosité.')}</small></span>{theme === 'dark' && <Check size={18} />}
              </button>
            </div>
          </article>

          <article className="panel agent-settings-card">
            <div className="agent-settings-card-heading"><span className="agent-settings-icon"><Globe2 size={18} /></span><div><h3>{t('Langue de l’application')}</h3><p>{t('Choisissez la langue de votre espace agent.')}</p></div></div>
            <div className="agent-settings-language-list" role="group" aria-label={t('Langue de l’application')}>
              {(['fr', 'en'] as const).map((option) => (
                <button key={option} type="button" aria-pressed={language === option} className={`agent-settings-language${language === option ? ' is-selected' : ''}`} onClick={() => setLanguage(option)}>
                  <span>{option === 'fr' ? 'Français' : 'English'}</span>{language === option && <Check size={18} />}
                </button>
              ))}
            </div>
            <p className="agent-settings-language-note" role="status">{t(language === 'en' ? 'Votre espace agent s’affiche en anglais.' : 'Votre espace agent s’affiche en français.')}</p>
          </article>
        </div>
      </section>

      <section className="agent-settings-section" aria-labelledby="settings-security-title">
        <div className="agent-settings-section-heading">
          <span className="agent-settings-section-icon"><LockKeyhole size={19} /></span>
          <div><p className="section-kicker">{t('Sécurité du compte')}</p><h2 id="settings-security-title">{t('Protégez votre accès')}</h2></div>
        </div>
        <div className="panel agent-settings-card agent-settings-security-card">
          <div className="agent-settings-card-heading"><span className="agent-settings-icon"><KeyRound size={18} /></span><div><h3>{t('Modifier le mot de passe')}</h3><p>{t('Au moins 8 caractères.')}</p></div></div>
          <form className="agent-settings-password-form" onSubmit={(event) => void handlePasswordSubmit(event)}>
            <label>{t('Mot de passe actuel')}<input type="password" autoComplete="current-password" minLength={8} maxLength={128} required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            <label>{t('Nouveau mot de passe')}<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label>{t('Confirmer le nouveau mot de passe')}<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            {passwordError && <p className="agent-settings-message is-error" role="alert">{passwordError}</p>}
            {passwordMessage && <p className="agent-settings-message is-success" role="status">{passwordMessage}</p>}
            <button type="submit" className="primary-button" disabled={passwordBusy}>{passwordBusy ? t('Enregistrement...') : t('Mettre à jour le mot de passe')}</button>
          </form>
        </div>
      </section>

      <section className="agent-settings-section" aria-labelledby="settings-notifications-title">
        <div className="agent-settings-section-heading">
          <span className="agent-settings-section-icon"><Bell size={19} /></span>
          <div><p className="section-kicker">{t('Notifications et autorisations')}</p><h2 id="settings-notifications-title">{t('Gérez les alertes et les accès de votre navigateur.')}</h2></div>
        </div>
        <div className="agent-settings-grid">
          <article className="panel agent-settings-card">
            <div className="agent-settings-card-heading"><span className="agent-settings-icon">{pushState === 'enabled' ? <Bell size={18} /> : <BellOff size={18} />}</span><div><h3>{t('Notifications système')}</h3><p>{t('Recevez les alertes de la plateforme même lorsque vous ne l’utilisez pas. Ce réglage concerne uniquement cet appareil.')}</p></div></div>
            {pushState === 'unsupported' && <p className="agent-settings-note">{t('Les notifications système ne sont pas prises en charge par ce navigateur.')}</p>}
            {pushState === 'denied' && <p className="agent-settings-note">{t('Les notifications sont bloquées dans les paramètres du navigateur.')}</p>}
            {pushError && <p className="agent-settings-message is-error" role="alert">{pushError}</p>}
            {pushMessage && <p className="agent-settings-message is-success" role="status">{pushMessage}</p>}
            {pushState !== 'unsupported' && <button className={pushState === 'enabled' ? 'outline-button' : 'primary-button'} type="button" disabled={pushBusy || pushState === 'loading'} onClick={() => void togglePushNotifications()}>
              {pushBusy ? t('Enregistrement...') : pushState === 'enabled' ? t('Désactiver sur cet appareil') : t('Activer les notifications')}
            </button>}
          </article>

          <article className="panel agent-settings-card">
            <div className="agent-settings-card-heading"><span className="agent-settings-icon"><ShieldCheck size={18} /></span><div><h3>{t('Autorisations du navigateur')}</h3><p>{t('La position et le micro sont demandés uniquement quand vous utilisez la carte ou les messages vocaux.')}</p></div></div>
            <div className="agent-settings-permission-list">
              <div><span><MapPin size={16} />{t('Position')}</span><strong className={`permission-state is-${permissions.geolocation}`}>{permissionLabel(permissions.geolocation)}</strong></div>
              <div><span><Mic size={16} />{t('Microphone')}</span><strong className={`permission-state is-${permissions.microphone}`}>{permissionLabel(permissions.microphone)}</strong></div>
            </div>
            <p className="agent-settings-note">{t('Pour modifier une autorisation, ouvrez les paramètres du site dans votre navigateur.')}</p>
          </article>
        </div>
      </section>

      <section className="panel agent-settings-account-card">
        <div className="agent-settings-account-mark"><ShieldCheck size={19} /></div>
        <div><p className="section-kicker">{t('Informations du compte')}</p><h2>{accountName}</h2><p>{t('Connecté en tant que')} <strong>{user.email}</strong></p></div>
      </section>
    </div>
  )
}
