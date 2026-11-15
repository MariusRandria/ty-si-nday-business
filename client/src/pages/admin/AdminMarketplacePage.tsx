import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { BadgeCheck, ImagePlus, Package, Pencil, Plus, RefreshCw, ShoppingBag, Truck, X } from 'lucide-react'
import api, {
  type AdminMarketplacePaymentSettings,
  type MarketplaceOrder,
  type MarketplaceOrderStatus,
  type MarketplaceProduct,
  type MarketplaceProductInput,
  type MarketplaceProductStatus,
} from '../../api/client'
import { AdminTotpCodeField } from '../../components/admin/AdminTotpCodeField'
import { LoadingState } from '../../components/ui/LoadingState'
import { notify } from '../../utils/toast'
import { confirmAction } from '../../utils/confirmation'
import './AdminMarketplacePage.css'

type FormVariant = { id?: number; label: string; stock: string }

type ProductForm = {
  title: string
  category: string
  description: string
  price: string
  status: MarketplaceProductStatus
  imageUrl: string | null
  variants: FormVariant[]
}

const blankPaymentSettings: AdminMarketplacePaymentSettings = {
  mvolaNumber: null,
  mvolaAccountName: null,
  orangeMoneyNumber: null,
  orangeMoneyName: null,
  airtelMoneyNumber: null,
  airtelMoneyName: null,
  instructions: '',
}

const blankForm: ProductForm = {
  title: '',
  category: '',
  description: '',
  price: '',
  status: 'BROUILLON',
  imageUrl: null,
  variants: [{ label: 'Taille unique', stock: '0' }],
}

const statuses: MarketplaceOrderStatus[] = ['DEMANDEE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EXPEDIEE', 'LIVREE', 'ANNULEE']
const nextStatuses: Record<MarketplaceOrderStatus, MarketplaceOrderStatus[]> = {
  DEMANDEE: ['CONFIRMEE', 'ANNULEE'],
  CONFIRMEE: ['EN_PREPARATION', 'ANNULEE'],
  EN_PREPARATION: ['PRETE', 'ANNULEE'],
  PRETE: ['EXPEDIEE', 'LIVREE', 'ANNULEE'],
  EXPEDIEE: ['LIVREE'],
  LIVREE: [],
  ANNULEE: [],
}
const statusLabels: Record<MarketplaceOrderStatus, string> = {
  DEMANDEE: 'Demandée',
  CONFIRMEE: 'Confirmée',
  EN_PREPARATION: 'En préparation',
  PRETE: 'Prête',
  EXPEDIEE: 'Expédiée',
  LIVREE: 'Livrée',
  ANNULEE: 'Annulée',
}

function formatAr(amount: string) {
  return `${BigInt(amount).toLocaleString('fr-FR')} Ar`
}

function productInput(form: ProductForm): MarketplaceProductInput {
  return {
    title: form.title.trim(),
    category: form.category.trim(),
    description: form.description.trim(),
    price: Number(form.price),
    status: form.status,
    variants: form.variants.map((variant) => ({
      ...(variant.id === undefined ? {} : { id: variant.id }),
      label: variant.label.trim(),
      stock: Number(variant.stock),
    })),
  }
}

export default function AdminMarketplacePage() {
  const [products, setProducts] = useState<MarketplaceProduct[]>([])
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [paymentSettings, setPaymentSettings] = useState<AdminMarketplacePaymentSettings>(blankPaymentSettings)
  const [section, setSection] = useState<'articles' | 'commandes' | 'paiement'>('articles')
  const [form, setForm] = useState<ProductForm>(blankForm)
  const [imageFile, setImageFile] = useState<File | undefined>()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPaymentSettings, setSavingPaymentSettings] = useState(false)
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [productFilter, setProductFilter] = useState<'TOUS' | MarketplaceProductStatus>('TOUS')
  const [orderFilter, setOrderFilter] = useState<'TOUS' | MarketplaceOrderStatus>('TOUS')
  const [paymentOrder, setPaymentOrder] = useState<MarketplaceOrder | null>(null)
  const [quoteOrder, setQuoteOrder] = useState<MarketplaceOrder | null>(null)
  const [deliveryFee, setDeliveryFee] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [totp, setTotp] = useState('')
  const [currentTime, setCurrentTime] = useState<number | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  async function loadMarketplace() {
    setError('')
    const [loadedProducts, loadedOrders, loadedPaymentSettings] = await Promise.all([
      api.adminMarketplaceProducts(),
      api.adminMarketplaceOrders(),
      api.adminMarketplacePaymentSettings(),
    ])
    setProducts(loadedProducts)
    setOrders(loadedOrders)
    setPaymentSettings(loadedPaymentSettings)
  }

  useEffect(() => {
    let active = true
    Promise.all([api.adminMarketplaceProducts(), api.adminMarketplaceOrders(), api.adminMarketplacePaymentSettings()])
      .then(([loadedProducts, loadedOrders, loadedPaymentSettings]) => {
        if (!active) return
        setProducts(loadedProducts)
        setOrders(loadedOrders)
        setPaymentSettings(loadedPaymentSettings)
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger la marketplace.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const updateTime = () => setCurrentTime(Date.now())
    updateTime()
    const timer = window.setInterval(updateTime, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const activeProducts = products.filter((product) => product.status === 'PUBLIE').length
  const totalStock = products.reduce((sum, product) => sum + (product.status === 'PUBLIE'
    ? product.variants.reduce((total, variant) => total + (variant.isActive === false ? 0 : variant.stock), 0)
    : 0), 0)
  const pendingQuotes = orders.filter((order) => order.totalAmount === null && order.deliveryMethod !== 'RECUPERATION' && order.status !== 'ANNULEE').length
  const awaitingPayments = orders.filter((order) => order.paymentStatus === 'A_CONFIRMER' && order.totalAmount !== null && order.status !== 'ANNULEE').length
  const visibleProducts = useMemo(() => products.filter((product) => productFilter === 'TOUS' || product.status === productFilter), [productFilter, products])
  const visibleOrders = useMemo(() => orders.filter((order) => orderFilter === 'TOUS' || order.status === orderFilter), [orderFilter, orders])

  function resetForm() {
    setForm(blankForm)
    setImageFile(undefined)
    if (imageInput.current) imageInput.current.value = ''
    setEditingId(null)
  }

  function startEditing(product: MarketplaceProduct) {
    setEditingId(product.id)
    setImageFile(undefined)
    if (imageInput.current) imageInput.current.value = ''
    const activeVariants = product.variants.filter((variant) => variant.isActive !== false)
    setForm({
      title: product.title,
      category: product.category,
      description: product.description,
      price: product.price,
      status: product.status,
      imageUrl: product.imageUrl,
      variants: activeVariants.length ? activeVariants.map((variant) => ({
        id: variant.id,
        label: variant.label,
        stock: String(variant.stock),
      })) : [{ label: 'Taille unique', stock: '0' }],
    })
    setSection('articles')
  }

  function updateVariant(index: number, patch: Partial<FormVariant>) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, rowIndex) => rowIndex === index ? { ...variant, ...patch } : variant),
    }))
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = productInput(form)
    if (!Number.isSafeInteger(input.price) || input.price < 1 || input.variants.some((variant) => !variant.label || !Number.isInteger(variant.stock) || variant.stock < 0)) {
      setError('Vérifiez le prix et les déclinaisons avant l’enregistrement.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await api.saveAdminMarketplaceProduct(input, imageFile, editingId ?? undefined)
      setProducts((current) => editingId
        ? current.map((product) => product.id === saved.id ? saved : product)
        : [saved, ...current])
      resetForm()
      notify(editingId ? 'Article mis à jour.' : 'Article créé.', 'success')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Impossible d’enregistrer l’article.'
      setError(message)
      notify(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function savePaymentSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^\d{6}$/.test(totp)) return
    setSavingPaymentSettings(true)
    try {
      const saved = await api.saveAdminMarketplacePaymentSettings(paymentSettings, totp)
      setPaymentSettings(saved)
      setTotp('')
      notify('Coordonnées de paiement enregistrées.', 'success')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Impossible d’enregistrer les coordonnées de paiement.'
      setError(message)
      notify(message, 'error')
    } finally {
      setSavingPaymentSettings(false)
      setTotp('')
    }
  }

  async function quoteOrderFees(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fee = Number(deliveryFee)
    if (!quoteOrder || !Number.isSafeInteger(fee) || fee < 0 || !/^\d{6}$/.test(totp)) return
    setBusyOrderId(quoteOrder.id)
    try {
      const updated = await api.quoteAdminMarketplaceOrder(quoteOrder.id, fee, totp)
      setOrders((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item))
      setQuoteOrder(null)
      setDeliveryFee('')
      setTotp('')
      notify(`Devis de la commande #${updated.id} envoyé à l’agent.`, 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Impossible de transmettre le devis.', 'error')
    } finally {
      setBusyOrderId(null)
      setTotp('')
    }
  }

  async function updateOrderStatus(order: MarketplaceOrder, status: MarketplaceOrderStatus) {
    if (status === 'ANNULEE') {
      const confirmed = await confirmAction({
        title: 'Annuler cette commande ?',
        message: 'Le stock réservé sera restitué. Une commande déjà payée ne peut pas être annulée ici.',
        confirmLabel: 'Annuler la commande',
        destructive: true,
      })
      if (!confirmed) return
    }
    setBusyOrderId(order.id)
    try {
      const updated = await api.updateAdminMarketplaceOrderStatus(order.id, status)
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...updated } : item))
      notify(`Commande #${order.id} : ${statusLabels[status].toLowerCase()}.`, 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Impossible de modifier la commande.', 'error')
    } finally {
      setBusyOrderId(null)
    }
  }

  async function confirmPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!paymentOrder || !/^\d{6}$/.test(totp)) return
    setBusyOrderId(paymentOrder.id)
    try {
      const updated = await api.confirmAdminMarketplacePayment(paymentOrder.id, paymentNote.trim(), totp)
      setOrders((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item))
      setPaymentOrder(null)
      setPaymentNote('')
      setTotp('')
      notify(`Paiement de la commande #${updated.id} confirmé.`, 'success')
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Impossible de confirmer le paiement.', 'error')
    } finally {
      setBusyOrderId(null)
      setTotp('')
    }
  }

  const deliveryLabel = (order: MarketplaceOrder) => order.deliveryMethod === 'LIVRAISON'
    ? 'Livraison'
    : order.deliveryMethod === 'COLIS' ? 'Colis' : 'Récupération'

  function updatePaymentSetting<K extends keyof AdminMarketplacePaymentSettings>(key: K, value: AdminMarketplacePaymentSettings[K]) {
    setPaymentSettings((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="admin-marketplace-page">
      <section className="page-heading admin-marketplace-heading">
        <div><p className="eyebrow">BOUTIQUE DES AGENTS</p><h1>Marketplace</h1><p className="intro">Gérez les articles de marque, les stocks et les commandes des agents.</p></div>
        <button type="button" className="outline-button" disabled={loading} onClick={() => { setLoading(true); void loadMarketplace().catch((caught) => setError(caught instanceof Error ? caught.message : 'Actualisation impossible.')).finally(() => setLoading(false)) }}><RefreshCw size={16} /> Actualiser</button>
      </section>

      <section className="admin-marketplace-metrics" aria-label="Résumé marketplace">
        <article><span>Articles publiés</span><strong>{activeProducts}</strong><small>sur {products.length} articles</small></article>
        <article><span>Stock disponible</span><strong>{totalStock}</strong><small>unités actives</small></article>
        <article><span>Devis à préparer</span><strong>{pendingQuotes}</strong><small>livraison ou colis</small></article>
        <article><span>Paiements à vérifier</span><strong>{awaitingPayments}</strong><small>confirmation manuelle</small></article>
      </section>

      <div className="admin-marketplace-tabs" role="tablist" aria-label="Gestion marketplace">
        <button type="button" role="tab" aria-selected={section === 'articles'} className={section === 'articles' ? 'active' : ''} onClick={() => setSection('articles')}><ShoppingBag size={17} /> Articles <span>{products.length}</span></button>
        <button type="button" role="tab" aria-selected={section === 'commandes'} className={section === 'commandes' ? 'active' : ''} onClick={() => setSection('commandes')}><Package size={17} /> Commandes <span>{orders.length}</span></button>
        <button type="button" role="tab" aria-selected={section === 'paiement'} className={section === 'paiement' ? 'active' : ''} onClick={() => setSection('paiement')}><BadgeCheck size={17} /> Paiement</button>
      </div>

      {error && <div className="admin-marketplace-error" role="alert">{error}</div>}
      {loading ? <LoadingState label="Chargement de la marketplace…" /> : section === 'articles' ? (
        <div className="admin-marketplace-content">
          <form className="panel admin-marketplace-form" onSubmit={(event) => void saveProduct(event)}>
            <div className="panel-heading"><div><span className="section-kicker">{editingId ? 'MODIFICATION' : 'NOUVEL ARTICLE'}</span><h2>{editingId ? 'Modifier un article' : 'Ajouter à la boutique'}</h2></div>{editingId && <button type="button" className="outline-button compact" onClick={resetForm}><X size={15} /> Annuler</button>}</div>
            <label className="admin-marketplace-image-upload">
              {!imageFile && form.imageUrl ? <img src={form.imageUrl} alt="Photo actuelle de l’article" /> : <span><ImagePlus size={22} /> {imageFile?.name ?? 'Ajouter une photo'}</span>}
              <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files?.[0])} />
              <small>JPEG, PNG ou WebP · 5 Mo maximum</small>
            </label>
            <div className="admin-marketplace-product-fields">
              <label>Nom de l’article *<input required minLength={2} maxLength={200} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Ex. Polo Ty sy Nday" /></label>
              <label>Catégorie *<input required minLength={2} maxLength={100} value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Vêtements, accessoires..." /></label>
              <label>Prix unitaire (Ar) *<input required type="number" min={1} step={1} value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} placeholder="Ex. 45000" /></label>
              <label>Publication<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as MarketplaceProductStatus }))}><option value="BROUILLON">Brouillon</option><option value="PUBLIE">Publié dans la boutique</option><option value="ARCHIVE">Archivé</option></select></label>
              <label className="wide">Description *<textarea required minLength={10} maxLength={5000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Décrivez l’article, sa matière ou son usage." /></label>
            </div>
            <div className="admin-marketplace-variants">
              <div className="admin-marketplace-variants-heading"><div><h3>Tailles, couleurs et stock</h3><p>Créez une déclinaison par combinaison, par exemple « M · Noir ».</p></div><button type="button" className="outline-button compact" onClick={() => setForm((current) => ({ ...current, variants: [...current.variants, { label: '', stock: '0' }] }))}><Plus size={15} /> Ajouter</button></div>
              {form.variants.map((variant, index) => <div className="admin-marketplace-variant-row" key={variant.id ?? `new-${index}`}>
                <label><span>Déclinaison *</span><input required maxLength={100} value={variant.label} onChange={(event) => updateVariant(index, { label: event.target.value })} placeholder="Taille M · Noir" /></label>
                <label><span>Stock *</span><input required type="number" min={0} max={100000} step={1} value={variant.stock} onChange={(event) => updateVariant(index, { stock: event.target.value })} /></label>
                <button type="button" className="admin-marketplace-remove-variant" disabled={form.variants.length === 1} aria-label="Retirer cette déclinaison" onClick={() => setForm((current) => ({ ...current, variants: current.variants.filter((_, rowIndex) => rowIndex !== index) }))}><X size={16} /></button>
              </div>)}
            </div>
            <div className="admin-marketplace-form-footer"><p>Les commandes réservent le stock immédiatement. Les frais de livraison ou d’envoi sont confirmés séparément.</p><button className="primary-button" disabled={saving}>{saving ? 'Enregistrement...' : editingId ? 'Enregistrer les modifications' : 'Créer l’article'}</button></div>
          </form>

          <section className="panel admin-marketplace-product-list">
            <div className="panel-heading"><div><span className="section-kicker">CATALOGUE</span><h2>Articles</h2></div><select aria-label="Filtrer les articles" value={productFilter} onChange={(event) => setProductFilter(event.target.value as typeof productFilter)}><option value="TOUS">Tous les statuts</option><option value="PUBLIE">Publiés</option><option value="BROUILLON">Brouillons</option><option value="ARCHIVE">Archivés</option></select></div>
            {visibleProducts.length ? <div className="admin-marketplace-products">
              {visibleProducts.map((product) => (
                <article className="admin-marketplace-product-row" key={product.id}>
                  <div className="admin-marketplace-product-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <ShoppingBag size={20} />}</div>
                  <div className="admin-marketplace-product-info"><div><strong>{product.title}</strong><span className={`admin-marketplace-product-status status-${product.status.toLowerCase()}`}>{product.status === 'PUBLIE' ? 'Publié' : product.status === 'ARCHIVE' ? 'Archivé' : 'Brouillon'}</span></div><small>{product.category} · {formatAr(product.price)}</small><small>{product.variants.filter((variant) => variant.isActive !== false).reduce((sum, variant) => sum + variant.stock, 0)} unités · {product.variants.filter((variant) => variant.isActive !== false).length} déclinaison(s)</small></div>
                  <button type="button" className="outline-button compact" onClick={() => startEditing(product)}><Pencil size={15} /> Modifier</button>
                </article>
              ))}
            </div> : <div className="admin-marketplace-empty"><ShoppingBag size={25} /><p>Aucun article pour ce filtre.</p></div>}
          </section>
        </div>
      ) : section === 'commandes' ? (
        <section className="panel admin-marketplace-orders">
          <div className="panel-heading"><div><span className="section-kicker">SUIVI DES VENTES</span><h2>Commandes des agents</h2></div><select aria-label="Filtrer les commandes" value={orderFilter} onChange={(event) => setOrderFilter(event.target.value as typeof orderFilter)}><option value="TOUS">Tous les statuts</option>{statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div>
          {visibleOrders.length ? <div className="admin-marketplace-order-list">
            {visibleOrders.map((order) => {
              const next = nextStatuses[order.status].filter((status) => status === 'ANNULEE'
                ? order.paymentStatus !== 'PAYE'
                : order.paymentStatus === 'PAYE')
              const agentName = order.agent?.agentProfile
                ? `${order.agent.agentProfile.firstName} ${order.agent.agentProfile.lastName}`
                : order.agent?.email ?? `Agent #${order.agentId}`
              return <article className="admin-marketplace-order" key={order.id}>
                <header><div><span className="admin-marketplace-order-id">Commande #{order.id}</span><span className={`admin-marketplace-product-status status-${order.status.toLowerCase()}`}>{statusLabels[order.status]}</span></div><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString('fr-FR')}</time></header>
                <div className="admin-marketplace-order-agent"><strong>{agentName}</strong><span>{order.agent?.agentProfile?.phone ?? order.agent?.email}</span><span>{order.agent?.agentProfile?.city}</span></div>
                <div className="admin-marketplace-order-lines">{order.items.map((item) => <div key={item.id}><strong>{item.productName} · {item.variantLabel}</strong><span>{item.quantity} × {formatAr(item.unitPrice)} = {formatAr(item.lineTotal)}</span></div>)}</div>
                <div className="admin-marketplace-order-delivery"><span><Truck size={15} /> {deliveryLabel(order)}</span>{order.deliveryAddress && <span>{order.deliveryAddress}</span>}</div>
                {order.agentNote && <p className="admin-marketplace-agent-note">Note de l’agent : {order.agentNote}</p>}
                <div className="admin-marketplace-order-totals">
                  <span>Articles</span><span>{formatAr(order.itemsAmount)}</span>
                  <span>Frais de remise</span><span>{order.deliveryFee === null ? 'À chiffrer' : formatAr(order.deliveryFee)}</span>
                  <strong>Total à payer</strong><strong>{order.totalAmount === null ? 'En attente du devis' : formatAr(order.totalAmount)}</strong>
                </div>
                <div className="admin-marketplace-order-payment">
                  <span>Mode de paiement : {order.paymentMethod === 'MVOLA' ? 'MVola' : order.paymentMethod === 'ORANGE_MONEY' ? 'Orange Money' : order.paymentMethod === 'AIRTEL_MONEY' ? 'Airtel Money' : order.paymentMethod === 'ESPECES' ? 'Espèces au retrait' : 'Non renseigné'}</span>
                  <span className={`admin-marketplace-payment ${order.paymentStatus === 'PAYE' ? 'paid' : ''}`}>
                    {order.paymentStatus === 'PAYE'
                      ? `Payé · ${order.paymentReference ?? 'confirmé'}`
                      : order.totalAmount === null
                        ? 'Devis de remise à transmettre'
                        : order.paymentReference ? `Référence reçue · ${order.paymentReference}` : 'En attente du paiement'}
                  </span>
                  {order.totalAmount === null && order.quoteExpiresAt && <small>Devis attendu avant le : {new Date(order.quoteExpiresAt).toLocaleString('fr-FR')}</small>}
                  {order.paymentExpiresAt && order.paymentStatus !== 'PAYE' && <small>Échéance : {new Date(order.paymentExpiresAt).toLocaleString('fr-FR')}</small>}
                </div>
                <div className="admin-marketplace-order-actions">
                  {next.map((status) => <button key={status} type="button" className={status === 'ANNULEE' ? 'reject-button' : 'outline-button compact'} disabled={busyOrderId === order.id} onClick={() => void updateOrderStatus(order, status)}>{busyOrderId === order.id ? 'Mise à jour...' : status === 'ANNULEE' ? 'Annuler la commande' : status === 'CONFIRMEE' ? 'Confirmer la commande' : status === 'EN_PREPARATION' ? 'Démarrer la préparation' : status === 'PRETE' ? 'Marquer prête' : status === 'EXPEDIEE' ? 'Marquer expédiée' : 'Marquer livrée'}</button>)}
                  {order.deliveryMethod !== 'RECUPERATION' && order.totalAmount === null && order.status !== 'ANNULEE' && order.status !== 'EXPEDIEE' && order.status !== 'LIVREE' && <button type="button" className="outline-button compact" disabled={busyOrderId === order.id} onClick={() => { setQuoteOrder(order); setDeliveryFee(''); setTotp('') }}><Truck size={15} /> Saisir les frais</button>}
                  {order.paymentStatus === 'A_CONFIRMER'
                    && order.totalAmount !== null
                    && order.status !== 'ANNULEE'
                    && (order.paymentMethod === 'ESPECES' || Boolean(order.paymentReference))
                    && Boolean(currentTime !== null && (order.paymentExpiresAt ? Date.parse(order.paymentExpiresAt) > currentTime : order.status === 'EXPEDIEE' || order.status === 'LIVREE'))
                    && <button type="button" className="approve-button" disabled={busyOrderId === order.id} onClick={() => { setPaymentOrder(order); setPaymentNote(''); setTotp('') }}><BadgeCheck size={15} /> Confirmer le paiement</button>}
                </div>
              </article>
            })}
          </div> : <div className="admin-marketplace-empty"><Package size={26} /><p>Aucune commande à afficher.</p></div>}
        </section>
      ) : (
        <form className="panel admin-marketplace-settings" onSubmit={(event) => void savePaymentSettings(event)}>
          <div className="panel-heading"><div><span className="section-kicker">PAIEMENT DES COMMANDES</span><h2>Coordonnées de paiement</h2><p>Seuls les modes renseignés seront proposés aux agents.</p></div></div>
          <div className="admin-marketplace-payment-settings-grid">
            <label>Numéro MVola<input maxLength={100} value={paymentSettings.mvolaNumber ?? ''} onChange={(event) => updatePaymentSetting('mvolaNumber', event.target.value || null)} placeholder="034 XX XXX XX" /></label>
            <label>Nom du bénéficiaire MVola<input maxLength={150} value={paymentSettings.mvolaAccountName ?? ''} onChange={(event) => updatePaymentSetting('mvolaAccountName', event.target.value || null)} placeholder="TY SY NDAY" /></label>
            <label>Numéro Orange Money<input maxLength={100} value={paymentSettings.orangeMoneyNumber ?? ''} onChange={(event) => updatePaymentSetting('orangeMoneyNumber', event.target.value || null)} placeholder="032 XX XXX XX" /></label>
            <label>Nom du bénéficiaire Orange Money<input maxLength={150} value={paymentSettings.orangeMoneyName ?? ''} onChange={(event) => updatePaymentSetting('orangeMoneyName', event.target.value || null)} placeholder="TY SY NDAY" /></label>
            <label>Numéro Airtel Money<input maxLength={100} value={paymentSettings.airtelMoneyNumber ?? ''} onChange={(event) => updatePaymentSetting('airtelMoneyNumber', event.target.value || null)} placeholder="033 XX XXX XX" /></label>
            <label>Nom du bénéficiaire Airtel Money<input maxLength={150} value={paymentSettings.airtelMoneyName ?? ''} onChange={(event) => updatePaymentSetting('airtelMoneyName', event.target.value || null)} placeholder="TY SY NDAY" /></label>
            <label className="wide">Instructions de paiement<textarea maxLength={2000} value={paymentSettings.instructions} onChange={(event) => updatePaymentSetting('instructions', event.target.value)} placeholder="Ex. indiquez le numéro de commande dans le motif du transfert." /></label>
          </div>
          <p className="admin-marketplace-settings-note">La récupération sur place reste gratuite et peut être réglée en espèces. Les coordonnées enregistrées seront affichées aux agents après validation du devis.</p>
          <AdminTotpCodeField label="Code administrateur" value={totp} onChange={setTotp} required />
          <div className="admin-marketplace-settings-actions"><button className="primary-button" disabled={savingPaymentSettings || totp.length !== 6}>{savingPaymentSettings ? 'Enregistrement...' : 'Enregistrer les coordonnées'}</button></div>
        </form>
      )}

      {paymentOrder && <div className="admin-marketplace-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && busyOrderId === null) setPaymentOrder(null) }}>
        <form className="admin-marketplace-payment-modal" role="dialog" aria-modal="true" aria-labelledby="marketplace-payment-title" onSubmit={(event) => void confirmPayment(event)}>
          <div className="admin-marketplace-payment-heading"><span><BadgeCheck size={22} /></span><div><p className="eyebrow">CONFIRMATION MANUELLE</p><h2 id="marketplace-payment-title">Confirmer le paiement</h2></div><button type="button" aria-label="Fermer" onClick={() => setPaymentOrder(null)}><X size={19} /></button></div>
          <p>{paymentOrder.paymentMethod === 'ESPECES'
            ? `Confirmez que les espèces de la commande #${paymentOrder.id} (${paymentOrder.totalAmount ? formatAr(paymentOrder.totalAmount) : ''}) ont été reçues au retrait.`
            : `Vérifiez la référence « ${paymentOrder.paymentReference} » et le règlement de la commande #${paymentOrder.id} (${paymentOrder.totalAmount ? formatAr(paymentOrder.totalAmount) : ''}).`}</p>
          {paymentOrder.paymentMethod === 'ESPECES' && <label className="admin-marketplace-payment-field">Note de réception (facultatif)<input maxLength={100} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Ex. reçu au bureau le 15/11" /></label>}
          <AdminTotpCodeField label="Code administrateur" value={totp} onChange={setTotp} required />
          <div className="admin-marketplace-payment-actions"><button type="button" className="outline-button" disabled={busyOrderId === paymentOrder.id} onClick={() => setPaymentOrder(null)}>Annuler</button><button className="primary-button" disabled={busyOrderId === paymentOrder.id || totp.length !== 6}>{busyOrderId === paymentOrder.id ? 'Vérification...' : 'Confirmer le paiement'}</button></div>
        </form>
      </div>}
      {quoteOrder && <div className="admin-marketplace-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && busyOrderId === null) setQuoteOrder(null) }}>
        <form className="admin-marketplace-payment-modal" role="dialog" aria-modal="true" aria-labelledby="marketplace-quote-title" onSubmit={(event) => void quoteOrderFees(event)}>
          <div className="admin-marketplace-payment-heading"><span><Truck size={22} /></span><div><p className="eyebrow">DEVIS DE REMISE</p><h2 id="marketplace-quote-title">Confirmer les frais</h2></div><button type="button" aria-label="Fermer" onClick={() => setQuoteOrder(null)}><X size={19} /></button></div>
          <p>Commande #{quoteOrder.id} · Articles : {formatAr(quoteOrder.itemsAmount)}. Le total à payer sera communiqué à l’agent avec un délai de 24 heures.</p>
          <label className="admin-marketplace-payment-field">Frais de {deliveryLabel(quoteOrder).toLowerCase()} (Ar)<input required type="number" min={0} step={1} value={deliveryFee} onChange={(event) => setDeliveryFee(event.target.value)} placeholder="0" /></label>
          {Number.isSafeInteger(Number(deliveryFee)) && Number(deliveryFee) >= 0 && <p className="admin-marketplace-quote-total">Total à payer : <strong>{formatAr((BigInt(quoteOrder.itemsAmount) + BigInt(deliveryFee || '0')).toString())}</strong></p>}
          <AdminTotpCodeField label="Code administrateur" value={totp} onChange={setTotp} required />
          <div className="admin-marketplace-payment-actions"><button type="button" className="outline-button" disabled={busyOrderId === quoteOrder.id} onClick={() => setQuoteOrder(null)}>Annuler</button><button className="primary-button" disabled={busyOrderId === quoteOrder.id || totp.length !== 6 || !Number.isSafeInteger(Number(deliveryFee)) || Number(deliveryFee) < 0}>{busyOrderId === quoteOrder.id ? 'Envoi...' : 'Envoyer le devis'}</button></div>
        </form>
      </div>}
    </div>
  )
}
