import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Building2, MapPin, Pencil, Phone, Plus, Search, Trash2, UserRound, X } from 'lucide-react'
import api, { type ProspectContact } from '../../api/client'
import { LoadingState } from '../../components/ui/LoadingState'
import { notify } from '../../utils/toast'
import { confirmAction } from '../../utils/confirmation'
import './ProspectPages.css'

const emptyForm = {
  companyName: '',
  responsibleName: '',
  latitude: '',
  longitude: '',
  address: '',
  contact: '',
}

export default function AdminProspectsPage() {
  const [prospects, setProspects] = useState<ProspectContact[]>([])
  const [form, setForm] = useState(emptyForm)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingProspect, setEditingProspect] = useState<ProspectContact | null>(null)
  const [busyProspectId, setBusyProspectId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api.adminProspects()
      .then((data) => {
        if (!active) return
        setProspects(data)
        setError('')
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger les prospects.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  function editProspect(prospect: ProspectContact) {
    setEditingProspect(prospect)
    setError('')
    setForm({
      companyName: prospect.companyName,
      responsibleName: prospect.responsibleName ?? '',
      latitude: prospect.latitude?.toString() ?? '',
      longitude: prospect.longitude?.toString() ?? '',
      address: prospect.address ?? '',
      contact: prospect.contact ?? '',
    })
  }

  function cancelEdit() {
    setEditingProspect(null)
    setForm(emptyForm)
    setError('')
  }

  async function saveProspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const hasLatitude = form.latitude.trim() !== ''
    const hasLongitude = form.longitude.trim() !== ''
    if (hasLatitude !== hasLongitude) {
      setError('Renseignez la latitude et la longitude ensemble pour afficher le prospect sur la carte.')
      return
    }
    const latitude = hasLatitude ? Number(form.latitude) : null
    const longitude = hasLongitude ? Number(form.longitude) : null
    if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
      setError('Les coordonnées GPS saisies ne sont pas valides.')
      return
    }

    setSaving(true)
    try {
      const input = {
        companyName: form.companyName.trim(),
        responsibleName: form.responsibleName.trim() || null,
        latitude,
        longitude,
        address: form.address.trim() || null,
        contact: form.contact.trim() || null,
      }
      if (editingProspect) {
        const updated = await api.updateProspect(editingProspect.id, input)
        setProspects((current) => current.map((prospect) => prospect.id === updated.id ? updated : prospect))
        notify('Prospect modifié. Les abonnés actifs ont été notifiés.', 'success')
      } else {
        const created = await api.createProspect(input)
        setProspects((current) => [created, ...current])
        notify('Prospect ajouté. Les abonnés actifs ont été notifiés.', 'success')
      }
      setEditingProspect(null)
      setForm(emptyForm)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Impossible d’enregistrer le prospect.'
      setError(message)
      notify(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function removeProspect(prospect: ProspectContact) {
    const confirmed = await confirmAction({
      title: 'Supprimer ce prospect ?',
      message: `${prospect.companyName} sera supprimé de la liste partagée. Les abonnés actifs seront notifiés. Cette action est définitive.`,
      confirmLabel: 'Supprimer le prospect',
      destructive: true,
    })
    if (!confirmed) return
    setBusyProspectId(prospect.id)
    try {
      await api.deleteProspect(prospect.id)
      setProspects((current) => current.filter((item) => item.id !== prospect.id))
      if (editingProspect?.id === prospect.id) cancelEdit()
      notify('Prospect supprimé. Les abonnés actifs ont été notifiés.', 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Impossible de supprimer le prospect.', 'error')
    } finally {
      setBusyProspectId(null)
    }
  }

  const visibleProspects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('fr')
    if (!normalizedQuery) return prospects
    return prospects.filter((prospect) => [
      prospect.companyName,
      prospect.responsibleName,
      prospect.address,
      prospect.contact,
    ].some((value) => value?.toLocaleLowerCase('fr').includes(normalizedQuery)))
  }, [prospects, query])
  const mappedCount = prospects.filter((prospect) => prospect.latitude !== null && prospect.longitude !== null).length

  return <div className="prospect-admin-page prospect-page">
    <header className="page-heading prospect-heading">
      <div><p className="eyebrow">DÉVELOPPEMENT COMMERCIAL</p><h1>Contacts prospects</h1><p className="intro">Centralisez les pistes commerciales et partagez-les avec les agents abonnés.</p></div>
      <div className="prospect-heading-badge"><UserRound size={17} /> Réservé aux badges actifs</div>
    </header>

    <section className="prospect-summary" aria-label="Résumé des prospects">
      <article><span>Total des contacts</span><strong>{prospects.length}</strong><small>Prospects partagés</small></article>
      <article><span>Localisés sur la carte</span><strong>{mappedCount}</strong><small>Coordonnées GPS disponibles</small></article>
      <article><span>Agents notifiés</span><strong>✓</strong><small>À chaque nouveau contact</small></article>
    </section>

    <div className="prospect-admin-layout">
      <form className="panel prospect-form" onSubmit={(event) => void saveProspect(event)}>
        <div className="prospect-panel-heading"><span className="prospect-icon">{editingProspect ? <Pencil size={18} /> : <Plus size={19} />}</span><div><span className="section-kicker">{editingProspect ? 'MODIFICATION' : 'NOUVEAU PROSPECT'}</span><h2>{editingProspect ? 'Modifier le contact' : 'Ajouter un contact'}</h2></div></div>
        <p className="prospect-form-intro">{editingProspect ? 'Les informations mises à jour seront partagées avec les abonnés actifs.' : 'Les informations seront visibles par les agents disposant d’un badge actif.'}</p>
        <label>Nom de l’entreprise <span>*</span><input required minLength={2} maxLength={200} value={form.companyName} onChange={(event) => setForm((current) => ({ ...current, companyName: event.target.value }))} placeholder="Ex. Société commerciale" /></label>
        <label>Nom du responsable<input maxLength={150} value={form.responsibleName} onChange={(event) => setForm((current) => ({ ...current, responsibleName: event.target.value }))} placeholder="Ex. Mme Rasoanaivo" /></label>
        <div className="prospect-form-row">
          <label>Latitude<input type="number" step="any" min="-90" max="90" value={form.latitude} onChange={(event) => setForm((current) => ({ ...current, latitude: event.target.value }))} placeholder="-18.8792" /></label>
          <label>Longitude<input type="number" step="any" min="-180" max="180" value={form.longitude} onChange={(event) => setForm((current) => ({ ...current, longitude: event.target.value }))} placeholder="47.5079" /></label>
        </div>
        <small className="prospect-field-hint">Les deux coordonnées sont nécessaires pour placer le repère sur la carte.</small>
        <label>Adresse<input maxLength={500} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="Quartier, rue, ville…" /></label>
        <label>Contact téléphone ou e-mail<input maxLength={255} value={form.contact} onChange={(event) => setForm((current) => ({ ...current, contact: event.target.value }))} placeholder="+261… ou contact@entreprise.mg" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="prospect-form-actions">
          <button className="primary-button prospect-submit" type="submit" disabled={saving || busyProspectId !== null}>{saving ? 'Enregistrement…' : editingProspect ? <><Pencil size={16} /> Enregistrer les modifications</> : <><Plus size={17} /> Ajouter et notifier les agents</>}</button>
          {editingProspect && <button className="outline-button prospect-cancel-edit" type="button" disabled={saving} onClick={cancelEdit}><X size={15} /> Annuler</button>}
        </div>
      </form>

      <section className="panel prospect-admin-list">
        <div className="prospect-list-heading"><div><span className="section-kicker">BASE COMMERCIALE</span><h2>Prospects enregistrés</h2></div><span className="prospect-count">{prospects.length}</span></div>
        <label className="prospect-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une entreprise, un contact…" /></label>
        {loading ? <LoadingState label="Chargement des prospects…" /> : visibleProspects.length === 0
          ? <div className="prospect-empty"><span><Building2 size={24} /></span><strong>{prospects.length ? 'Aucun résultat' : 'Aucun prospect pour le moment'}</strong><p>{prospects.length ? 'Essayez un autre terme de recherche.' : 'Ajoutez un premier contact pour le partager avec les agents.'}</p></div>
          : <div className="prospect-admin-cards">{visibleProspects.map((prospect) => <article className="prospect-admin-card" key={prospect.id}>
            <span className="prospect-card-mark"><Building2 size={18} /></span>
            <div className="prospect-admin-card-main"><strong>{prospect.companyName}</strong><span>{prospect.responsibleName || 'Responsable non renseigné'}</span><small><MapPin size={13} /> {prospect.address || (prospect.latitude !== null ? `${prospect.latitude}, ${prospect.longitude}` : 'Localisation non renseignée')}</small></div>
            {prospect.contact && <span className="prospect-card-contact"><Phone size={14} />{prospect.contact}</span>}
            <div className="prospect-card-actions">
              <button type="button" className="prospect-edit-button" aria-label={`Modifier ${prospect.companyName}`} title="Modifier ce prospect" disabled={busyProspectId !== null || saving} onClick={() => editProspect(prospect)}><Pencil size={15} /></button>
              <button type="button" className="prospect-delete-button" aria-label={`Supprimer ${prospect.companyName}`} title="Supprimer ce prospect" disabled={busyProspectId !== null || saving} onClick={() => void removeProspect(prospect)}>{busyProspectId === prospect.id ? <span className="prospect-delete-spinner" /> : <Trash2 size={16} />}</button>
            </div>
          </article>)}</div>}
      </section>
    </div>
  </div>
}
