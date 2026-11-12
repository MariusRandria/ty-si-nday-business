import { useCallback, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import api, { type SessionUser } from '../api/client'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { GoogleSignInButton } from '../components/ui/GoogleSignInButton'
import tySyNdayLogo from '../assets/TD.png'
import './auth-brand.css'

type Props = { onLogin: (token: string, user: SessionUser) => boolean; portal: 'agent' | 'admin' }

export default function AuthPage({ onLogin, portal }: Props) {
  const [audience, setAudience] = useState<'agent' | 'admin'>(portal)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', phone: '', city: '', consent: false })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingRegistrationEmail, setPendingRegistrationEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [registrationStep, setRegistrationStep] = useState(1)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

  const update = (field: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (mode === 'register' && audience === 'agent' && !pendingRegistrationEmail && registrationStep === 1) {
      continueRegistration()
      return
    }
    setError('')
    setMessage('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const result = await api.login(form.email, form.password)
        if (!onLogin(result.token, result.user)) throw new Error(portal === 'admin' ? 'Ce compte n’a pas les droits administrateur.' : 'Connectez-vous avec un compte agent sur ce portail.')
      } else if (pendingRegistrationEmail) {
        const result = await api.verifyRegistrationOtp(pendingRegistrationEmail, otpCode.trim())
        setMessage(result)
        setPendingRegistrationEmail('')
        setOtpCode('')
        setMode('login')
      } else {
        if (form.phone.trim().length < 7) throw new Error('Le téléphone doit contenir au moins 7 caractères.')
        if (form.city.trim().length < 2) throw new Error('La ville est obligatoire.')
        if (!form.consent) throw new Error('Vous devez accepter les conditions d’utilisation.')
        const result = await api.register({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          city: form.city.trim(),
          password: form.password,
          consent: true,
        })
        setForm((current) => ({ ...current, password: '' }))
        setPendingRegistrationEmail(result.email)
        setMessage(result.message)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Une erreur est survenue.')
    } finally {
      setLoading(false)
    }
  }

  const submitGoogleCredential = useCallback(async (credential: string) => {
    if (loading) return
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const result = await api.googleAuth({
        credential,
        ...(mode === 'register' ? {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          city: form.city.trim(),
          consent: form.consent,
        } : {}),
      })
      if (result.kind === 'OTP_PENDING') {
        setPendingRegistrationEmail(result.email)
        setOtpCode('')
        setMessage(result.message)
        return
      }
      if (!onLogin(result.token, result.user)) {
        throw new Error(portal === 'admin' ? 'La connexion Google est réservée aux comptes agent.' : 'Ce compte n’a pas accès à cet espace.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Connexion Google impossible.')
    } finally {
      setLoading(false)
    }
  }, [form, loading, mode, onLogin, portal])

  async function resendRegistrationCode() {
    if (!pendingRegistrationEmail || loading) return
    setError('')
    setMessage('')
    setLoading(true)
    try {
      setMessage(await api.resendRegistrationOtp(pendingRegistrationEmail))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Le renvoi du code a échoué.')
    } finally {
      setLoading(false)
    }
  }

  function restartRegistration() {
    setPendingRegistrationEmail('')
    setOtpCode('')
    setMessage('')
    setError('')
    setRegistrationStep(1)
  }

  function continueRegistration() {
    setError('')
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('Le prénom et le nom sont obligatoires.')
      return
    }
    if (form.phone.trim().length < 7) {
      setError('Le téléphone doit contenir au moins 7 caractères.')
      return
    }
    if (form.city.trim().length < 2) {
      setError('La ville est obligatoire.')
      return
    }
    setRegistrationStep(2)
  }

  return (
    <main className={`auth-shell auth-${audience} auth-mode-${mode}`}>
      <section className="auth-visual" aria-label="Présentation Ty sy Nday Business">
        <a className="auth-brand" href="/" aria-label="Ty sy Nday Business"><img src={tySyNdayLogo} alt="" /><span><strong>TY SY NDAY</strong><small>BUSINESS</small></span></a>
        <div className="auth-visual-copy">
          <span className="auth-kicker">{audience === 'admin' ? 'Espace de pilotage' : 'Votre espace professionnel'}</span>
          <h1>{audience === 'admin' ? 'Pilotez vos projets avec confiance.' : 'Construisons vos réussites ensemble.'}</h1>
          <p>{audience === 'admin' ? 'Centralisez les candidatures, les rapports et les opérations dans un environnement sécurisé.' : 'Accédez à vos activités, suivez vos résultats et développez vos opportunités.'}</p>
          <strong className="auth-script">Ensemble pour vos projets</strong>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-audience" role="tablist" aria-label="Choisir le portail">
            <button type="button" role="tab" aria-selected={audience === 'agent'} className={audience === 'agent' ? 'active' : ''} onClick={() => { setAudience('agent'); setMode('login'); restartRegistration() }}>Espace agent</button>
            <button type="button" role="tab" aria-selected={audience === 'admin'} className={audience === 'admin' ? 'active' : ''} onClick={() => { setAudience('admin'); setMode('login'); restartRegistration() }}>Administration</button>
          </div>
          {audience === 'agent' && <div className="auth-tabs" role="tablist" aria-label="Connexion ou inscription"><button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setRegistrationStep(1) }}>Connexion</button><button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setRegistrationStep(1) }}>Inscription agent</button></div>}
          <span className="auth-kicker">{audience === 'admin' ? 'Accès administrateur' : mode === 'login' ? 'Espace sécurisé' : pendingRegistrationEmail ? 'Vérifier votre adresse email' : `Inscription · étape ${registrationStep} sur 2`}</span>
          <h2>{audience === 'admin' ? 'Connexion administration' : mode === 'login' ? 'Ravi de vous revoir' : pendingRegistrationEmail ? 'Confirmez votre email' : registrationStep === 1 ? 'Vos informations' : 'Sécurisez votre compte'}</h2>
          <p className="auth-intro">{audience === 'admin' ? 'Réservé aux administrateurs autorisés.' : mode === 'login' ? 'Connectez-vous à votre espace professionnel.' : pendingRegistrationEmail ? `Saisissez le code à 6 chiffres envoyé à ${pendingRegistrationEmail}.` : registrationStep === 1 ? 'Renseignez vos coordonnées pour commencer.' : 'Ajoutez votre email et choisissez un mot de passe.'}</p>
          <form onSubmit={submit}>
            {mode === 'register' && audience === 'agent' && !pendingRegistrationEmail ? <>
              {registrationStep === 1 ? <>
                <div className="auth-row"><Input name="firstName" label="Prénom" value={form.firstName} onChange={(event) => update('firstName', event.target.value)} required /><Input name="lastName" label="Nom" value={form.lastName} onChange={(event) => update('lastName', event.target.value)} required /></div>
                <div className="auth-row"><Input name="phone" label="Téléphone" value={form.phone} onChange={(event) => update('phone', event.target.value)} required /><Input name="city" label="Ville" value={form.city} onChange={(event) => update('city', event.target.value)} required /></div>
                {error && <Alert tone="error">{error}</Alert>}
                <Button type="button" className="auth-submit" onClick={continueRegistration}>Continuer</Button>
              </> : <>
                <button type="button" className="auth-back-link" onClick={() => { setRegistrationStep(1); setError('') }}>Modifier mes coordonnées</button>
                <Input name="email" type="email" label="Email professionnel" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} required />
                <Input name="password" type="password" label="Mot de passe" autoComplete="new-password" minLength={8} value={form.password} onChange={(event) => update('password', event.target.value)} required />
                <label className="auth-check"><input type="checkbox" checked={form.consent} onChange={(event) => update('consent', event.target.checked)} required /> J’accepte les conditions d’utilisation.</label>
                {error && <Alert tone="error">{error}</Alert>}
                <Button type="submit" loading={loading} className="auth-submit">Recevoir un code de vérification</Button>
              </>}
            </> : <>
              {mode === 'register' && pendingRegistrationEmail
                ? <Input name="otpCode" label="Code de vérification" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
                : <>
                  <Input name="email" type="email" label="Email professionnel" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} required />
                  <Input name="password" type="password" label="Mot de passe" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} value={form.password} onChange={(event) => update('password', event.target.value)} required />
                </>}
              {error && <Alert tone="error">{error}</Alert>}
              {message && <Alert tone="success">{message}</Alert>}
              <Button type="submit" loading={loading} className="auth-submit">{audience === 'admin' ? 'Ouvrir l’administration' : mode === 'login' ? 'Se connecter' : pendingRegistrationEmail ? 'Vérifier et confirmer' : 'Recevoir un code de vérification'}</Button>
            </>}
          </form>
          {audience === 'agent' && mode === 'register' && pendingRegistrationEmail && <>
            <Button type="button" variant="secondary" disabled={loading} className="auth-submit" onClick={() => void resendRegistrationCode()}>Renvoyer le code</Button>
            <Button type="button" variant="secondary" disabled={loading} className="auth-submit" onClick={restartRegistration}>Modifier mes informations</Button>
          </>}
          {audience === 'agent' && !pendingRegistrationEmail && (mode === 'login' || registrationStep === 2) && <>
            <div className="auth-divider"><span>ou continuer avec</span></div>
            {googleClientId
              ? mode === 'register' && (!form.firstName.trim() || !form.lastName.trim() || form.phone.trim().length < 7 || form.city.trim().length < 2 || !form.consent)
                ? <Button type="button" variant="secondary" disabled className="google-signin-placeholder">Acceptez les conditions pour continuer avec Google</Button>
                : <GoogleSignInButton clientId={googleClientId} mode={mode} onCredential={(credential) => void submitGoogleCredential(credential)} onError={setError} />
              : <Button type="button" variant="secondary" disabled className="google-signin-placeholder">Connexion Google indisponible</Button>}
          </>}
          <p className="auth-security"><ShieldCheck size={18} /> {audience === 'admin' ? 'Les comptes administrateurs sont créés par la plateforme.' : 'Connexion sécurisée à vos informations professionnelles.'}</p>
        </div>
      </section>
    </main>
  )
}
