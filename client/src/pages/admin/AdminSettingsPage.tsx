import { useEffect, useState } from 'react'
import api, { type Setting } from '../../api/client'

const defaults = [
	{ key: 'report_lead_amount', label: 'Apport de contact (Lead)', description: 'Commission après signature du contrat conclu par notre équipe.', value: '50000', unit: 'Ar', step: '1000' },
	{ key: 'report_sale_amount', label: 'Vente d’un contact fourni', description: 'Commission après signature du contrat conclu par l’agent.', value: '100000', unit: 'Ar', step: '1000' },
	{ key: 'withdrawal_minimum', label: 'Seuil minimum de retrait', description: 'Montant minimal qu’un agent peut demander.', value: '100000', unit: 'Ar', step: '1000' },
	{ key: 'duplicate_delay_days', label: 'Fenêtre de détection des doublons', description: 'Période utilisée pour repérer une entreprise déjà signalée.', value: '90', unit: 'jours', step: '1' },
	{ key: 'badge_price', label: 'Prix de l’abonnement badge', description: 'Montant payé par l’agent pour obtenir le badge.', value: '', unit: 'Ar', step: '1000' },
	{ key: 'badge_duration_days', label: 'Durée du badge', description: 'Durée de validité après confirmation du paiement.', value: '', unit: 'jours', step: '1' },
	{ key: 'badge_payment_operator', label: 'Opérateur Mobile Money', description: 'Ex. MVola, Orange Money ou Airtel Money.', value: '', unit: '', step: '' },
	{ key: 'badge_payment_name', label: 'Nom du bénéficiaire', description: 'Nom affiché au moment du paiement.', value: '', unit: '', step: '' },
	{ key: 'badge_payment_number', label: 'Numéro Mobile Money', description: 'Numéro auquel l’agent doit envoyer le paiement.', value: '', unit: '', step: '' },
]
type LocalSetting = Setting & (typeof defaults)[number]

export default function AdminSettingsPage() {
	const [settings, setSettings] = useState<LocalSetting[]>(defaults.map((item, index) => ({ ...item, id: index })))
	const [saved, setSaved] = useState(false)
	const [error, setError] = useState('')
	const [saving, setSaving] = useState(false)

	useEffect(() => {
		api.settings().then((remoteSettings) => {
			setSettings(defaults.map((item, index) => ({ ...item, id: remoteSettings.find((remote) => remote.key === item.key)?.id ?? index, value: remoteSettings.find((remote) => remote.key === item.key)?.value ?? item.value })))
		}).catch((caught) => setError(caught instanceof Error ? caught.message : 'Impossible de charger les paramètres.'))
	}, [])

	function update(key: string, value: string) {
		setSaved(false)
		setSettings((current) => current.map((item) => item.key === key ? { ...item, value } : item))
	}

	async function save() {
		setSaving(true)
		setError('')
		setSaved(false)
		try {
			await Promise.all(settings.map((item) => api.updateSetting(item.key, item.value)))
			const persistedSettings = await api.settings()
			setSettings((current) => current.map((item) => {
				const persisted = persistedSettings.find((setting) => setting.key === item.key)
				return persisted ? { ...item, id: persisted.id, value: persisted.value } : item
			}))
			setSaved(true)
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Impossible d’enregistrer les paramètres.')
		} finally { setSaving(false) }
	}

	const financialSettings = settings.filter((setting) => setting.key === 'report_lead_amount' || setting.key === 'report_sale_amount' || setting.key === 'withdrawal_minimum')
	const qualitySettings = settings.filter((setting) => setting.key === 'duplicate_delay_days')
	const badgeSettings = settings.filter((setting) => setting.key.startsWith('badge_'))
	const leadAmount = Number(settings.find((setting) => setting.key === 'report_lead_amount')?.value ?? 50000)
	const saleAmount = Number(settings.find((setting) => setting.key === 'report_sale_amount')?.value ?? 100000)

	return <div className="admin-settings-page">
		<section className="page-heading admin-settings-heading"><div><p className="eyebrow">CONFIGURATION PLATEFORME</p><h1>Paramètres</h1><p className="intro">Configurez les rémunérations par type de collaboration, les retraits et le contrôle qualité.</p></div><button className="primary-button" onClick={save} disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer les changements'}</button></section>
		{saved && <div className="success-banner" role="status">Paramètres enregistrés dans la base de données.</div>}
		{error && <div className="settings-error" role="alert">{error}</div>}
		<div className="admin-settings-grid">
			<section className="panel settings-panel admin-setting-group"><div className="panel-heading"><div><span className="section-kicker">RÉMUNÉRATION</span><h2>Commissions par type de collaboration</h2></div><span className="settings-group-mark">Ar</span></div>
				{financialSettings.map((setting) => <SettingControl key={setting.key} setting={setting} onChange={update} />)}
				<div className="admin-setting-derived"><span><strong>Prospection + vente</strong><small>Type 1 + Type 2 · calcul automatique</small></span><b>{(leadAmount + saleAmount).toLocaleString('fr-FR')} Ar</b></div>
			</section>
			<div className="admin-settings-secondary">
				<section className="panel settings-panel admin-setting-group"><div className="panel-heading"><div><span className="section-kicker">CONTRÔLE QUALITÉ</span><h2>Détection des doublons</h2></div><span className="settings-group-mark">⌕</span></div>
					{qualitySettings.map((setting) => <SettingControl key={setting.key} setting={setting} onChange={update} />)}
				</section>
				<section className="panel settings-panel admin-setting-group"><div className="panel-heading"><div><span className="section-kicker">BADGE ABONNÉ</span><h2>Abonnement et paiement</h2></div><span className="settings-group-mark">★</span></div>
					<p className="settings-note">Le paiement est vérifié manuellement. Les agents accèdent aux prospects après validation et tant que leur badge est actif.</p>
					{badgeSettings.map((setting) => <SettingControl key={setting.key} setting={setting} onChange={update} />)}
				</section>
				<section className="panel admin-security-panel"><div className="panel-heading"><div><span className="section-kicker">SÉCURITÉ</span><h2>Variables sensibles</h2></div><span className="security-mark">✓</span></div><p className="settings-note">Les secrets JWT, les mots de passe administrateur et les connexions SMTP restent configurés dans les variables d’environnement du serveur.</p></section>
			</div>
		</div>
	</div>
}

function SettingControl({ setting, onChange }: { setting: LocalSetting; onChange: (key: string, value: string) => void }) {
	const numeric = setting.key === 'badge_price' || setting.key === 'badge_duration_days' || setting.key === 'report_lead_amount' || setting.key === 'report_sale_amount' || setting.key === 'withdrawal_minimum' || setting.key === 'duplicate_delay_days'
	return <label className="admin-setting-control"><span className="setting-description"><strong>{setting.label}</strong><small>{setting.description}</small></span><span className="setting-input-wrap"><input type={numeric ? 'number' : 'text'} min={numeric ? '0' : undefined} step={numeric ? setting.step : undefined} value={setting.value} onChange={(event) => onChange(setting.key, event.target.value)} /><b>{setting.unit}</b></span></label>
}
