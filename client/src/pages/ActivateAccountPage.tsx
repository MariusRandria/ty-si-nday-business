import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import api, { type SessionUser } from '../api/client'
import { Input } from '../components/ui/Input'
import authImage from '../assets/SUCCES.png'
import './auth-brand.css'

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

  return (
    <main className="auth-shell auth-agent auth-activation">
      <section className="auth-visual" aria-hidden="true">
        <img className="auth-visual-image" src={authImage} alt="" />
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-kicker">Activation sécurisée</span>
          <h2>Activer mon compte</h2>
          <p className="auth-intro">Définissez votre mot de passe pour accéder à Ty sy Nday Business.</p>
          <form onSubmit={submit}>
            <Input name="email" type="email" label="Email professionnel" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <Input name="password" label="Nouveau mot de passe" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
            <Input name="confirmation" label="Confirmer le mot de passe" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={loading}>{loading ? 'Activation...' : 'Activer et continuer'}</button>
          </form>
          <p className="auth-security"><ShieldCheck size={18} /> Un mot de passe robuste protège votre espace professionnel.</p>
        </div>
      </section>
    </main>
  )
}