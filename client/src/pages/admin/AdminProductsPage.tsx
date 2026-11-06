import { useEffect, useState, type FormEvent } from 'react'
import api, { type AdminProduct } from '../../api/client'
import { notify } from '../../utils/toast'
import { confirmAction } from '../../utils/confirmation'
import { LoadingState } from '../../components/ui/LoadingState'

const initialForm = { title: '', description: '', targetAudience: '', salesPitch: '', status: 'BROUILLON' }

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyProductId, setBusyProductId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('TOUS')
  const [query, setQuery] = useState('')

  async function loadProducts() {
    try { setProducts(await api.adminProducts()); setError('') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de charger le catalogue.') }
    finally { setLoading(false) }
  }
  useEffect(() => { loadProducts() }, [])

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.createProduct(form)
      setForm(initialForm)
      await loadProducts()
      notify(form.status === 'PUBLIE' ? 'Produit publié et agents notifiés.' : 'Brouillon enregistré.', 'success')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Impossible de créer le produit.'
      setError(message)
      notify(message, 'error')
    } finally { setSaving(false) }
  }

  async function changeStatus(product: AdminProduct, status: 'BROUILLON' | 'PUBLIE' | 'ARCHIVE') {
    if (status === 'ARCHIVE' || status === 'PUBLIE') {
      const confirmed = await confirmAction({
        title: status === 'ARCHIVE' ? 'Archiver ce produit ?' : 'Publier ce produit ?',
        message: status === 'ARCHIVE'
          ? `${product.title} ne sera plus proposé aux agents. Les rapports existants restent conservés.`
          : `${product.title} sera visible par les agents${product.status !== 'PUBLIE' ? ', qui seront notifiés' : ''}.`,
        confirmLabel: status === 'ARCHIVE' ? 'Archiver' : 'Publier',
        destructive: status === 'ARCHIVE',
      })
      if (!confirmed) return
    }
    setBusyProductId(product.id)
    try {
      const updated = await api.updateProductStatus(product.id, status)
      setProducts((current) => current.map((item) => item.id === updated.id ? updated : item))
      notify(status === 'PUBLIE' ? 'Produit publié. Les agents actifs ont été notifiés.' : 'Statut du produit mis à jour.', 'success')
    } catch (caught) { notify(caught instanceof Error ? caught.message : 'Impossible de modifier le produit.', 'error') }
    finally { setBusyProductId(null) }
  }

  const counts = {
    PUBLIE: products.filter((product) => product.status === 'PUBLIE').length,
    BROUILLON: products.filter((product) => product.status === 'BROUILLON').length,
    ARCHIVE: products.filter((product) => product.status === 'ARCHIVE').length,
  }
  const visibleProducts = products.filter((product) => (filter === 'TOUS' || product.status === filter) && product.title.toLowerCase().includes(query.toLowerCase()))

  return <div className="admin-products-page">
    <section className="page-heading admin-catalog-heading"><div><p className="eyebrow">OFFRE COMMERCIALE</p><h1>Catalogue produits</h1><p className="intro">Gérez les offres visibles par les agents et suivez leur statut de publication.</p></div><span className="catalog-total">{products.length} produit{products.length === 1 ? '' : 's'}</span></section>
    <section className="admin-catalog-stats" aria-label="Résumé du catalogue"><article><span>Publiés</span><strong>{counts.PUBLIE}</strong></article><article><span>Brouillons</span><strong>{counts.BROUILLON}</strong></article><article><span>Archivés</span><strong>{counts.ARCHIVE}</strong></article></section>
    <form className="panel settings-panel admin-product-form" onSubmit={createProduct}><div className="panel-heading"><div><span className="section-kicker">NOUVELLE OFFRE</span><h2>Ajouter un produit</h2></div><span className="form-required-note">Les champs marqués * sont obligatoires</span></div>
      <div className="admin-product-fields"><label>Nom du produit *<input required minLength={2} maxLength={200} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Ex. Accompagnement cloud" /></label>
      <label>Public cible *<input required value={form.targetAudience} onChange={(event) => setForm((current) => ({ ...current, targetAudience: event.target.value }))} placeholder="PME, grandes entreprises..." /></label>
      <label>Description *<textarea required minLength={10} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Présentez brièvement le produit et ses bénéfices." /></label>
      <label>Argumentaire commercial *<textarea required minLength={5} value={form.salesPitch} onChange={(event) => setForm((current) => ({ ...current, salesPitch: event.target.value }))} placeholder="Les points clés à présenter aux prospects." /></label></div>
      <div className="admin-product-form-footer"><label>Publication<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="BROUILLON">Enregistrer en brouillon</option><option value="PUBLIE">Publier et notifier les agents</option></select></label><button className="primary-button" disabled={saving}>{saving ? 'Enregistrement...' : form.status === 'PUBLIE' ? 'Publier le produit' : 'Enregistrer le brouillon'}</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
    <section className="panel admin-table-panel admin-catalog-list"><div className="panel-heading"><div><span className="section-kicker">CATALOGUE</span><h2>Produits</h2></div><button className="outline-button" onClick={() => { setLoading(true); loadProducts() }}>Actualiser</button></div>
      <div className="filter-row admin-catalog-filters">{['TOUS', 'PUBLIE', 'BROUILLON', 'ARCHIVE'].map((status) => <button key={status} type="button" className={`filter ${filter === status ? 'active' : ''}`} onClick={() => setFilter(status)}>{status === 'TOUS' ? 'Tous' : status.toLowerCase()} <b>{status === 'TOUS' ? products.length : counts[status as keyof typeof counts]}</b></button>)}<input className="catalog-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un produit" /></div>
      {loading ? <LoadingState label="Chargement du catalogue…" /> : products.length === 0 ? <div className="empty-state">Aucun produit. Créez-en un ci-dessus.</div> : visibleProducts.length === 0 ? <div className="empty-state">Aucun produit ne correspond à ces filtres.</div> : <table><thead><tr><th>PRODUIT</th><th>PUBLIC CIBLE</th><th>STATUT</th><th>ACTION</th></tr></thead><tbody>{visibleProducts.map((product) => <tr key={product.id}><td><strong>{product.title}</strong><small className="table-subtext">{product.description}</small></td><td>{product.targetAudience}</td><td><span className={`status ${product.status.toLowerCase()}`}>{product.status.toLowerCase()}</span></td><td><div className="action-group">{product.status !== 'PUBLIE' && <button className="approve-button" disabled={busyProductId !== null} onClick={() => void changeStatus(product, 'PUBLIE')}>{busyProductId === product.id ? 'Publication…' : 'Publier'}</button>}{product.status === 'PUBLIE' && <button className="reject-button" disabled={busyProductId !== null} onClick={() => void changeStatus(product, 'ARCHIVE')}>{busyProductId === product.id ? 'Archivage…' : 'Archiver'}</button>}{product.status === 'ARCHIVE' && <button className="outline-button compact" disabled={busyProductId !== null} onClick={() => void changeStatus(product, 'BROUILLON')}>{busyProductId === product.id ? 'Réactivation…' : 'Réactiver en brouillon'}</button>}</div></td></tr>)}</tbody></table>}
    </section>
  </div>
}