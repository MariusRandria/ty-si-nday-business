import { useEffect, useState, type FormEvent } from 'react'
import api, { type NewReportInput, type Product, type SessionUser } from '../../api/client'
import type { ReportType } from '../../types/report'
import useCommissionAmounts from '../../hooks/useCommissionAmounts'
import { notify } from '../../utils/toast'
import { useI18n } from '../../i18n'

const REPORT_TYPES: { value: ReportType; label: string; description: string; requirement: string }[] = [
  {
    value: 'LEAD',
    label: 'Apport de contact (Lead)',
    description: 'Vous trouvez un prospect ; notre équipe négocie et conclut la vente.',
    requirement: '50 000 Ar après signature du contrat',
  },
  {
    value: 'PROVIDED_CONTACT',
    label: 'Vente d’un contact fourni',
    description: 'Vous vendez à un contact transmis par Ty sy Nday avec votre code promo.',
    requirement: '100 000 Ar après signature du contrat',
  },
  {
    value: 'FULL_CYCLE',
    label: 'Prospection + vente',
    description: 'Vous trouvez le prospect et réalisez vous-même la vente.',
    requirement: 'Type 1 + Type 2 · après signature du contrat',
  },
]

function getLocalDateTime() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

export default function CreateReportModal({ onClose, onSaved, user }: { onClose: () => void; onSaved: () => void; user: SessionUser }) {
  const { language, t } = useI18n()
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const commissionState = useCommissionAmounts()
  const [form, setForm] = useState<NewReportInput>({
    productId: 0,
    customServiceDescription: '',
    companyName: '',
    city: '',
    address: '',
    contactName: '',
    contactRole: '',
    contactPhone: '',
    contactEmail: '',
    contactType: 'PRESENTIEL',
    reportNature: 'CONTACT',
    reportType: 'LEAD',
    meetingAt: getLocalDateTime(),
    summary: '',
    interestLevel: 'MOYEN',
    nextStep: '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.products()
      .then((items) => {
        setProducts(items)
        if (items.length > 0) setForm((current) => current.productId === 0 ? { ...current, productId: items[0].id } : current)
      })
      .catch((caught) => setError(caught instanceof Error ? t(caught.message) : t('Impossible de charger les produits.')))
      .finally(() => setProductsLoading(false))
  }, [t])

  const selectedType = REPORT_TYPES.find((type) => type.value === form.reportType) ?? REPORT_TYPES[0]
  const estimatedCommission = commissionState.status === 'ready' ? commissionState.amounts[form.reportType] : null
  const promoCode = `TSN-${String(user.id).padStart(6, '0')}`

  function update(field: keyof NewReportInput, value: string | number | null) {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (form.productId === 0) {
      setError(t('Choisissez un produit du catalogue ou une prestation sur mesure.'))
      return
    }

    setSaving(true)
    setError('')
    try {
      await api.createReport({
        ...form,
        customServiceDescription: form.productId === null ? form.customServiceDescription?.trim() : undefined,
        companyName: form.companyName.trim(),
        contactPhone: form.contactPhone.trim(),
        contactEmail: form.contactEmail?.trim(),
        summary: form.summary.trim(),
        nextStep: form.nextStep?.trim() || undefined,
      })
      notify(t('Rapport enregistré avec succès.'), 'success')
      onSaved()
      onClose()
    } catch (caught) {
      const message = caught instanceof Error ? t(caught.message) : t('Une erreur est survenue.')
      notify(message, 'error')
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop report-modal-backdrop" onClick={() => !saving && onClose()}>
      <form className="modal report-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} disabled={saving} aria-label={t('Fermer')}>×</button>
        <p className="eyebrow">{t('NOUVELLE DÉMARCHE')}</p>
        <h2>{t('Créer un rapport')}</h2>
        <p className="modal-intro">{t('Choisissez le mode de collaboration utilisé pour cette vente. La rémunération est due après signature du contrat et validation par l’administration.')}</p>

        <fieldset className="report-nature-fieldset">
          <legend>{t('Type de collaboration')} *</legend>
          <div className="report-nature-options">
            {REPORT_TYPES.map((type) => (
              <label className={`report-nature-option${form.reportType === type.value ? ' selected' : ''}`} key={type.value}>
                <input
                  type="radio"
                  name="reportType"
                  value={type.value}
                  checked={form.reportType === type.value}
                  onChange={() => {
                    update('reportType', type.value)
                    update('reportNature', type.value === 'LEAD' ? 'CONTACT' : 'CONTRAT')
                  }}
                  required
                />
                <span className="report-nature-title">{t(type.label)}</span>
                <span className="report-nature-description">{t(type.description)}</span>
                <strong className="report-nature-amount">{commissionState.status !== 'ready' ? t('Montant indisponible') : `${commissionState.amounts[type.value].toLocaleString(language === 'en' ? 'en-US' : 'fr-FR')} Ar`}</strong>
                <small className="report-nature-description">{t(type.requirement)}</small>
              </label>
            ))}
          </div>
          {commissionState.status === 'error' && <p className="form-error" role="alert">{t(commissionState.error)}. {t('Le montant sera recalculé par le serveur à la validation.')}</p>}
          {commissionState.status === 'ready' && commissionState.error && <p className="form-error" role="alert">{t('Actualisation des commissions impossible :')} {t(commissionState.error)}. {t('Les derniers montants chargés restent affichés.')}</p>}
          <p className="commission-note">{t('La commission sera créditée au portefeuille après confirmation de la signature et validation admin.')}</p>
          {form.reportType !== 'LEAD' && <div className="report-promo-code"><span>{t('Votre code promo à utiliser sur la vente')}</span><strong>{promoCode}</strong></div>}
        </fieldset>

        <div className="report-form-section">
          <h3>{t('Client et offre')}</h3>
          <label>{t('Produit ou prestation')} *
            <select required value={form.productId === null ? 'CUSTOM' : form.productId || ''} onChange={(event) => {
              if (event.target.value === 'CUSTOM') {
                update('productId', null)
                return
              }
              update('productId', Number(event.target.value))
              update('customServiceDescription', '')
            }} disabled={productsLoading}>
              <option value="" disabled>{productsLoading ? t('Chargement des produits...') : t('Choisir un produit ou une prestation')}</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
              <option value="CUSTOM">{t('Prestation sur mesure')}</option>
            </select>
          </label>
          {form.productId === null && <label>{t('Décrivez la prestation sur mesure')} *
            <textarea required minLength={5} maxLength={2000} value={form.customServiceDescription ?? ''} onChange={(event) => update('customServiceDescription', event.target.value)} placeholder={t('Ex. développement d’une application métier adaptée aux besoins du client')} />
          </label>}
          <label>{t('Nom de l’entreprise')} *
            <input required minLength={2} maxLength={255} value={form.companyName} onChange={(event) => update('companyName', event.target.value)} placeholder={t('Ex. Atelier Miora')} />
          </label>
          <div className="form-row">
            <label>{t('Ville')} *<input required minLength={2} maxLength={100} value={form.city} onChange={(event) => update('city', event.target.value)} placeholder="Antananarivo" /></label>
            <label>{t('Type de contact')} *
              <select required value={form.contactType} onChange={(event) => update('contactType', event.target.value as NewReportInput['contactType'])}>
                <option value="PRESENTIEL">{t('Présentiel')}</option><option value="APPEL">{t('Appel')}</option><option value="VISIO">{t('Visio')}</option>
              </select>
            </label>
          </div>
          <label>{t('Adresse')} *<input required minLength={2} maxLength={255} value={form.address} onChange={(event) => update('address', event.target.value)} placeholder={t('Adresse ou lieu de rencontre')} /></label>
        </div>

        <div className="report-form-section">
          <h3>{t('Personne contactée')}</h3>
          <div className="form-row">
            <label>{t('Nom du contact')} *<input required minLength={2} maxLength={150} value={form.contactName} onChange={(event) => update('contactName', event.target.value)} /></label>
            <label>{t('Fonction')} *<input required minLength={2} maxLength={100} value={form.contactRole} onChange={(event) => update('contactRole', event.target.value)} placeholder={t('Ex. Responsable achats')} /></label>
          </div>
          <div className="form-row">
            <label>{t('Téléphone')} *<input required minLength={7} maxLength={30} value={form.contactPhone} onChange={(event) => update('contactPhone', event.target.value)} /></label>
            <label>{t('Email')}<input type="email" maxLength={255} value={form.contactEmail} onChange={(event) => update('contactEmail', event.target.value)} /></label>
          </div>
        </div>

        <div className="report-form-section">
          <h3>{t('Résultat de la démarche')}</h3>
          <div className="form-row">
            <label>{t('Date de la démarche')} *
              <input type="datetime-local" required value={form.meetingAt} onChange={(event) => update('meetingAt', event.target.value)} />
            </label>
            <label>{t('Niveau d’intérêt')} *
              <select required value={form.interestLevel} onChange={(event) => update('interestLevel', event.target.value as NewReportInput['interestLevel'])}>
                <option value="FAIBLE">{t('Faible')}</option><option value="MOYEN">{t('Moyen')}</option><option value="FORT">{t('Fort')}</option>
              </select>
            </label>
          </div>
          <label>{t('Compte rendu')} *
            <textarea required minLength={10} maxLength={5000} value={form.summary} onChange={(event) => update('summary', event.target.value)} placeholder={`${t('Décrivez la démarche et l’avancement pour le type')} « ${t(selectedType.label)} »...`} />
          </label>
          <label>{t('Prochaine étape')}
            <input maxLength={2000} value={form.nextStep ?? ''} onChange={(event) => update('nextStep', event.target.value)} placeholder={t('Ex. Rappeler le client mardi')} />
          </label>
        </div>

        <div className="commission-total"><span>{t('Commission potentielle')}</span><strong>{estimatedCommission === null ? t('Indisponible') : `${estimatedCommission.toLocaleString(language === 'en' ? 'en-US' : 'fr-FR')} Ar`}</strong></div>
        {products.length === 0 && !productsLoading && <p className="commission-note">{t('Aucun produit logiciel n’est publié pour le moment ; vous pouvez tout de même déclarer une prestation sur mesure.')}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="outline-button" onClick={onClose} disabled={saving}>{t('Annuler')}</button>
          <button className="primary-button" disabled={saving || productsLoading}>
            {saving ? t('Enregistrement...') : t('Enregistrer le rapport')}
          </button>
        </div>
      </form>
    </div>
  )
}