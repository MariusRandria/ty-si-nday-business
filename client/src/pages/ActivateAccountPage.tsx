import { useState } from 'react'
import api, { type SessionUser } from '../api/client'
import { Input } from '../components/ui/Input'

export default function ActivateAccountPage({ email: initialEmail, token, onLogin }: { email: string; token: string; onLogin: (token: string, user: SessionUser) => void }) {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères.'); return }
    if (password !== confirmation) { setError('Les mots de passe ne correspondent pas.'); return }
    setLoading(true)
    try {
      const session = await api.activateAccount(email, token, password)
      window.history.replaceState({}, '', window.location.pathname)
      onLogin(session.token, session.user)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Activation impossible.')
    } finally {
      setLoading(false)
    }
  }

  return <main className="auth-shell auth-agent"><section className="auth-panel"><div className="auth-card"><p className="eyebrow">ESPACE AGENT</p><h2>Activer mon compte</h2><p className="auth-intro">Choisissez votre mot de passe pour accéder à InnovCom.</p><form className="auth-form" onSubmit={submit}><label>Email professionnel<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><Input name="password" label="Nouveau mot de passe" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /><Input name="confirmation" label="Confirmer le mot de passe" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={loading}>{loading ? 'Activation...' : 'Activer et continuer'}</button></form></div></section></main>
}