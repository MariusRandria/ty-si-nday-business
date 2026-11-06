import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Copy, ShieldCheck } from 'lucide-react'
import api from '../../api/client'
import { Input } from '../../components/ui/Input'

type TotpEnrollment = { secret: string; uri: string }

export default function AdminTotpPage() {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [qrCode, setQrCode] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [starting, setStarting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!enrollment) return
    let active = true
    void QRCode.toDataURL(enrollment.uri, { errorCorrectionLevel: 'M', margin: 2, width: 240 })
      .then((dataUrl) => { if (active) setQrCode(dataUrl) })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Impossible de générer le QR code.')
      })
    return () => { active = false }
  }, [enrollment])

  async function startEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (starting) return
    setStarting(true)
    setError('')
    setSuccess('')
    try {
      setEnrollment(await api.startAdminTotpEnrollment(password))
      setPassword('')
      setCode('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de démarrer la configuration.')
    } finally {
      setStarting(false)
    }
  }

  async function verifyEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!enrollment || verifying) return
    setVerifying(true)
    setError('')
    try {
      await api.verifyAdminTotpEnrollment(code)
      setEnrollment(null)
      setQrCode('')
      setCode('')
      setCopied(false)
      setSuccess('La double authentification est activée. Utilisez un nouveau code de votre application pour chaque action de vérification des ventes.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Le code n’a pas pu être vérifié.')
    } finally {
      setVerifying(false)
    }
  }

  async function copySecret() {
    if (!enrollment) return
    setError('')
    try {
      await navigator.clipboard.writeText(enrollment.secret)
      setCopied(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de copier la clé. Vous pouvez la sélectionner et la copier manuellement.')
    }
  }

  function cancelEnrollment() {
    setEnrollment(null)
    setQrCode('')
    setCode('')
    setCopied(false)
    setError('')
  }

  return <div className="admin-totp-page">
    <section className="page-heading">
      <div>
        <p className="eyebrow">SÉCURITÉ ADMINISTRATION</p>
        <h1>Code administrateur</h1>
        <p className="intro">Configurez l’application qui génère les codes temporaires requis pour vérifier les ventes.</p>
      </div>
    </section>

    {success && <div className="success-banner" role="status"><CheckCircle2 size={18} />{success}</div>}
    {error && <div className="settings-error" role="alert">{error}</div>}

    <section className="panel admin-totp-panel">
      <div className="panel-heading">
        <div><span className="section-kicker">AUTHENTIFICATION À DEUX FACTEURS</span><h2>Application d’authentification</h2></div>
        <span className="settings-group-mark"><ShieldCheck size={18} /></span>
      </div>
      <p className="admin-totp-intro">L’application crée les codes à 6 chiffres; la plateforme ne peut pas les afficher à votre place. Utilisez une application compatible TOTP sur votre téléphone.</p>

      {!enrollment ? (
        <form className="admin-totp-form" onSubmit={(event) => void startEnrollment(event)}>
          <Input id="admin-totp-password" name="admin-totp-password" label="Mot de passe actuel de votre compte administrateur" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <p>Après vérification, un QR code de configuration s’affichera. Scannez-le avec votre application, puis saisissez le code généré pour activer la protection.</p>
          <button className="primary-button" type="submit" disabled={starting}>{starting ? 'Vérification...' : 'Configurer mon application'}</button>
        </form>
      ) : (
        <div className="admin-totp-setup">
          <div className="admin-totp-steps">
            <p><strong>1.</strong> Scannez ce QR code dans votre application d’authentification.</p>
            {qrCode
              ? <img className="admin-totp-qr" src={qrCode} alt="QR code de configuration TOTP administrateur" />
              : <p className="admin-totp-muted">Génération du QR code…</p>}
            <p>Si le scan ne fonctionne pas, entrez cette clé manuellement dans l’application :</p>
            <div className="admin-totp-secret">
              <code>{enrollment.secret}</code>
              <button type="button" className="outline-button" onClick={() => void copySecret()}>{copied ? 'Copiée' : <><Copy size={15} /> Copier</>}</button>
            </div>
            <p className="admin-totp-warning">Gardez cette clé privée. Ne la partagez pas. Elle ne sera plus affichée après la validation.</p>
          </div>
          <form className="admin-totp-form" onSubmit={(event) => void verifyEnrollment(event)}>
            <label htmlFor="admin-totp-enrollment-code">2. Saisissez le code à 6 chiffres affiché par l’application</label>
            <input id="admin-totp-enrollment-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
            <div className="admin-totp-actions">
              <button className="primary-button" type="submit" disabled={verifying || code.length !== 6}>{verifying ? 'Vérification...' : 'Activer la double authentification'}</button>
              <button className="outline-button" type="button" disabled={verifying} onClick={cancelEnrollment}>Annuler</button>
            </div>
          </form>
        </div>
      )}
    </section>
  </div>
}
