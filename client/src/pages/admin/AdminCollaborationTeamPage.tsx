import { useState, type FormEvent } from 'react'
import { LoaderCircle, MailPlus, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react'
import api, { ApiRequestError, type AdminCollaborationTeamMember } from '../../api/client'
import { AdminTotpCodeField } from '../../components/admin/AdminTotpCodeField'
import './AdminCollaborationReviewPage.css'

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof TypeError) return 'Erreur réseau. Vérifiez la connexion puis réessayez.'
  return error instanceof Error ? error.message : 'Une erreur est survenue. Réessayez.'
}

function roleLabel(role: AdminCollaborationTeamMember['role']): string {
  return role === 'SALES_REVIEWER' ? 'Vérificateur' : 'Signataire'
}

function statusLabel(status: string): string {
  if (status === 'ACTIF') return 'Actif'
  if (status === 'SUSPENDU') return 'Suspendu'
  return 'Invitation en attente'
}

export default function AdminCollaborationTeamPage() {
  const [members, setMembers] = useState<AdminCollaborationTeamMember[]>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [totp, setTotp] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AdminCollaborationTeamMember['role']>('SALES_REVIEWER')
  const [resendUserId, setResendUserId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || busy) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez un nouveau code administrateur à 6 chiffres.')
      return
    }
    setTotp('')
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      setMembers(await api.adminCollaborationTeam(code))
      setHasLoaded(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || busy) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez un nouveau code administrateur à 6 chiffres.')
      return
    }
    setTotp('')
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const invited = await api.inviteAdminCollaborationTeamMember(code, { email, role })
      setMembers((current) => [{
        ...invited,
        totpEnabled: false,
        createdAt: new Date().toISOString(),
        lastActiveAt: null,
        name: invited.email,
        reviewLoad: 0,
        signLoad: 0,
      }, ...current])
      setEmail('')
      setSuccess(`Invitation envoyée à ${invited.email}. Le lien est valable 24 heures.`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function resendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (resendUserId === null || loading || busy) return
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez un nouveau code administrateur à 6 chiffres.')
      return
    }
    setTotp('')
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await api.resendAdminCollaborationTeamInvitation(code, resendUserId)
      const member = members.find(({ id }) => id === resendUserId)
      setSuccess(member ? `Nouvelle invitation envoyée à ${member.email}.` : 'Nouvelle invitation envoyée.')
      setResendUserId(null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-collaboration">
      <header className="page-heading">
        <div>
          <p className="eyebrow">COLLABORATION · ORGANISATION</p>
          <h1>Équipe de traitement des ventes</h1>
          <p className="intro">Invitez des vérificateurs et des signataires. Les dossiers seront répartis automatiquement selon la charge active.</p>
        </div>
      </header>

      <section className="admin-collab-panel">
        <div className="admin-collab-panel-heading"><div><ShieldCheck size={20} /><h2>Accès administrateur</h2></div></div>
        <form className="admin-collab-totp-form" onSubmit={(event) => void loadTeam(event)}>
          <p>Un code TOTP frais est requis pour chaque action de gestion.</p>
          <div className="admin-collab-inline-form">
            <AdminTotpCodeField id="sales-team-load-totp" label="Code administrateur" value={totp} onChange={setTotp} />
            <button className="primary-button" type="submit" disabled={loading || busy}>{loading ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Charger / actualiser</button>
          </div>
        </form>
        {error && <p className="admin-collab-error" role="alert">{error}</p>}
        {success && <p className="admin-collab-confirmation is-confirmed" role="status">{success}</p>}
      </section>

      {hasLoaded && <>
        <section className="admin-collab-panel">
          <div className="admin-collab-panel-heading"><div><MailPlus size={20} /><h2>Inviter un membre</h2></div></div>
          <form className="admin-collab-totp-form" onSubmit={(event) => void inviteMember(event)}>
            <label htmlFor="sales-team-email">Adresse email</label>
            <input id="sales-team-email" type="email" autoComplete="email" required maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} />
            <label htmlFor="sales-team-role">Rôle</label>
            <select id="sales-team-role" value={role} onChange={(event) => setRole(event.target.value === 'SALES_SIGNER' ? 'SALES_SIGNER' : 'SALES_REVIEWER')}>
              <option value="SALES_REVIEWER">Vérificateur des ventes</option>
              <option value="SALES_SIGNER">Signataire des ventes</option>
            </select>
            <div className="admin-collab-inline-form">
              <AdminTotpCodeField id="sales-team-invite-totp" label="Code administrateur" value={totp} onChange={setTotp} />
              <button className="primary-button" type="submit" disabled={busy || loading}>{busy ? <LoaderCircle className="spin" size={18} /> : <MailPlus size={18} />}Envoyer l’invitation</button>
            </div>
            <p className="admin-collab-muted">Le membre reçoit un lien sécurisé pour définir son mot de passe. Le lien expire après 24 heures; il doit aussi activer son TOTP avant de recevoir des dossiers.</p>
          </form>
        </section>

        <section className="admin-collab-panel">
          <div className="admin-collab-panel-heading"><div><UsersRound size={20} /><h2>Membres · {members.length}</h2></div></div>
          {members.length === 0 ? <p className="admin-collab-muted">Aucun vérificateur ni signataire n’est encore enregistré.</p> : (
            <div className="admin-collab-agent-list">
              {members.map((member) => (
                <article className="admin-collab-agent-card" key={member.id}>
                  <strong>{member.name}</strong>
                  <span>{member.email} · {roleLabel(member.role)} · {statusLabel(member.status)}</span>
                  <span>{member.totpEnabled ? 'TOTP activé' : 'TOTP à configurer'}</span>
                  <span>Charge active : {member.role === 'SALES_REVIEWER' ? member.reviewLoad : member.signLoad} dossier(s)</span>
                  {member.status === 'EN_ATTENTE_ACTIVATION' && (
                    resendUserId === member.id ? (
                      <form className="admin-collab-totp-form" onSubmit={(event) => void resendInvitation(event)}>
                        <div className="admin-collab-inline-form">
                          <AdminTotpCodeField id={`sales-team-resend-totp-${member.id}`} label="Code administrateur" value={totp} onChange={setTotp} />
                          <button className="primary-button" type="submit" disabled={busy || loading}>{busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Renvoyer</button>
                          <button className="outline-button" type="button" disabled={busy} onClick={() => { setResendUserId(null); setTotp('') }}>Annuler</button>
                        </div>
                      </form>
                    ) : <button className="outline-button" type="button" onClick={() => { setResendUserId(member.id); setTotp(''); setError(''); setSuccess('') }}>Renvoyer l’invitation</button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </>}
    </div>
  )
}
