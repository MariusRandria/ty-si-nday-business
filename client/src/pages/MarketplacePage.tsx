import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, ImageOff, Package, RefreshCw, ShoppingBag, ShoppingCart, Truck } from 'lucide-react'
import api, {
  type MarketplaceDeliveryMethod,
  type MarketplaceOrder,
  type MarketplaceMobilePaymentMethod,
  type MarketplacePaymentMethod,
  type MarketplacePaymentSettings,
  type MarketplaceProduct,
  type MarketplaceVariant,
} from '../api/client'
import { notify } from '../utils/toast'
import { useI18n } from '../i18n'
import './MarketplacePage.css'

type CartLine = {
  variantId: number
  productName: string
  variantLabel: string
  price: string
  quantity: number
}

const orderStatusLabels: Record<MarketplaceOrder['status'], string> = {
  DEMANDEE: 'En attente de confirmation',
  CONFIRMEE: 'Confirmée',
  EN_PREPARATION: 'En préparation',
  PRETE: 'Prête',
  EXPEDIEE: 'Expédiée',
  LIVREE: 'Livrée',
  ANNULEE: 'Annulée',
}

function formatAr(amount: string | bigint) {
  return `${BigInt(amount).toLocaleString('fr-FR')} Ar`
}

function paymentMethodLabel(method: MarketplacePaymentMethod | null) {
  if (method === 'MVOLA') return 'MVola'
  if (method === 'ORANGE_MONEY') return 'Orange Money'
  if (method === 'AIRTEL_MONEY') return 'Airtel Money'
  if (method === 'ESPECES') return 'Espèces au retrait'
  return 'Non renseigné'
}

function ProductCard({
  product,
  cartQuantities,
  onAdd,
}: {
  product: MarketplaceProduct
  cartQuantities: Map<number, number>
  onAdd: (product: MarketplaceProduct, variant: MarketplaceVariant, quantity: number) => void
}) {
  const { t } = useI18n()
  const [variantId, setVariantId] = useState(() => product.variants.find((variant) => variant.stock > 0)?.id ?? product.variants[0]?.id ?? 0)
  const [quantity, setQuantity] = useState(1)
  const variant = product.variants.find((item) => item.id === variantId)
  const remaining = variant ? Math.max(variant.stock - (cartQuantities.get(variant.id) ?? 0), 0) : 0

  return (
    <article className="marketplace-product-card">
      <div className="marketplace-product-image">
        {product.imageUrl
          ? <img src={product.imageUrl} alt={product.title} loading="lazy" />
          : <span aria-hidden="true"><ImageOff size={32} /></span>}
        <span className="marketplace-category">{product.category}</span>
      </div>
      <div className="marketplace-product-content">
        <div className="marketplace-product-title-row">
          <h2>{product.title}</h2>
          <strong>{formatAr(product.price)}</strong>
        </div>
        <p>{product.description}</p>
        <label className="marketplace-field">
          <span>{t('Taille / couleur')}</span>
          <select value={variantId} onChange={(event) => { setVariantId(Number(event.target.value)); setQuantity(1) }}>
            {product.variants.map((item) => {
              const stockLeft = Math.max(item.stock - (cartQuantities.get(item.id) ?? 0), 0)
              return <option key={item.id} value={item.id} disabled={stockLeft === 0}>{item.label} · {stockLeft > 0 ? `${stockLeft} ${t('disponible(s)')}` : t('Épuisé')}</option>
            })}
          </select>
        </label>
        <div className="marketplace-product-actions">
          <label className="marketplace-quantity">
            <span className="sr-only">{t('Quantité')}</span>
            <input type="number" min={1} max={remaining} value={quantity} disabled={!remaining} onChange={(event) => setQuantity(Math.max(1, Math.min(Number(event.target.value) || 1, remaining || 1)))} />
          </label>
          <button type="button" className="primary-button" disabled={!variant || !remaining || quantity > remaining} onClick={() => variant && onAdd(product, variant, quantity)}>
            <ShoppingCart size={17} /> {t('Ajouter au panier')}
          </button>
        </div>
      </div>
    </article>
  )
}

export default function MarketplacePage() {
  const { t } = useI18n()
  const [products, setProducts] = useState<MarketplaceProduct[]>([])
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [paymentSettings, setPaymentSettings] = useState<MarketplacePaymentSettings>({ providers: [], instructions: '' })
  const [cart, setCart] = useState<CartLine[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('TOUS')
  const [deliveryMethod, setDeliveryMethod] = useState<MarketplaceDeliveryMethod>('RECUPERATION')
  const [paymentMethod, setPaymentMethod] = useState<MarketplacePaymentMethod>('ESPECES')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [agentNote, setAgentNote] = useState('')
  const [paymentReferences, setPaymentReferences] = useState<Record<number, string>>({})
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState<Record<number, MarketplaceMobilePaymentMethod>>({})
  const [busyPaymentOrderId, setBusyPaymentOrderId] = useState<number | null>(null)
  const [refreshingOrders, setRefreshingOrders] = useState(false)
  const [activeTab, setActiveTab] = useState<'boutique' | 'commandes'>('boutique')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [currentTime, setCurrentTime] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([api.marketplaceProducts(), api.marketplaceOrders(), api.marketplacePaymentSettings()])
      .then(([loadedProducts, loadedOrders, loadedPaymentSettings]) => {
        if (!active) return
        setProducts(loadedProducts)
        setOrders(loadedOrders)
        setPaymentSettings(loadedPaymentSettings)
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : t('Impossible de charger la boutique.'))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [t])

  useEffect(() => {
    const updateTime = () => setCurrentTime(Date.now())
    updateTime()
    const timer = window.setInterval(updateTime, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const categories = useMemo(() => ['TOUS', ...new Set(products.map((product) => product.category))], [products])
  const filteredProducts = useMemo(() => products.filter((product) =>
    (category === 'TOUS' || product.category === category)
      && `${product.title} ${product.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ), [category, products, query])
  const cartQuantities = useMemo(() => new Map(cart.map(({ variantId, quantity }) => [variantId, quantity])), [cart])
  const cartTotal = useMemo(() => cart.reduce((total, item) => total + BigInt(item.price) * BigInt(item.quantity), 0n), [cart])

  function addToCart(product: MarketplaceProduct, variant: MarketplaceVariant, quantity: number) {
    setCart((current) => {
      const existing = current.find((item) => item.variantId === variant.id)
      if (existing) return current.map((item) => item.variantId === variant.id ? { ...item, quantity: item.quantity + quantity } : item)
      return [...current, { variantId: variant.id, productName: product.title, variantLabel: variant.label, price: product.price, quantity }]
    })
    notify(t('Article ajouté au panier.'), 'success')
  }

  function removeFromCart(variantId: number) {
    setCart((current) => current.filter((item) => item.variantId !== variantId))
  }

  function changeDeliveryMethod(method: MarketplaceDeliveryMethod) {
    setDeliveryMethod(method)
    if (method !== 'RECUPERATION' && paymentMethod === 'ESPECES') {
      setPaymentMethod(paymentSettings.providers.find((provider) => provider.account)?.method ?? 'MVOLA')
    }
  }

  async function refreshOrders() {
    setRefreshingOrders(true)
    try {
      setOrders(await api.marketplaceOrders())
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('Impossible d’actualiser les commandes.')
      notify(message, 'error')
    } finally {
      setRefreshingOrders(false)
    }
  }

  function orderPaymentMethod(order: MarketplaceOrder): MarketplacePaymentMethod | null {
    return order.paymentMethod
      ?? selectedPaymentMethods[order.id]
      ?? paymentSettings.providers.find((provider) => provider.account)?.method
      ?? null
  }

  function orderPaymentProvider(order: MarketplaceOrder) {
    const method = orderPaymentMethod(order)
    if (!method || method === 'ESPECES') return null
    return paymentSettings.providers.find((provider) => provider.method === method) ?? null
  }

  async function submitPaymentReference(order: MarketplaceOrder) {
    const paymentReference = (paymentReferences[order.id] ?? order.paymentReference ?? '').trim()
    const selectedMethod = orderPaymentMethod(order)
    const selectedMobileMethod = selectedMethod && selectedMethod !== 'ESPECES' ? selectedMethod : undefined
    if (paymentReference.length < 3) return
    if (!order.paymentMethod && !selectedMobileMethod) return
    setBusyPaymentOrderId(order.id)
    try {
      const updated = await api.submitMarketplacePaymentReference(
        order.id,
        paymentReference,
        order.paymentMethod ? undefined : selectedMobileMethod,
      )
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item))
      notify(t('Référence envoyée. L’administration vérifiera le paiement.'), 'success')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('Impossible d’envoyer la référence de paiement.')
      notify(message, 'error')
    } finally {
      setBusyPaymentOrderId(null)
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!cart.length) return
    setSubmitting(true)
    setError('')
    try {
      const createdOrder = await api.createMarketplaceOrder({
        items: cart.map(({ variantId, quantity }) => ({ variantId, quantity })),
        deliveryMethod,
        paymentMethod,
        ...(deliveryMethod === 'RECUPERATION' ? {} : { deliveryAddress: deliveryAddress.trim() }),
        agentNote: agentNote.trim() || undefined,
      })
      setCart([])
      setDeliveryAddress('')
      setAgentNote('')
      setOrders((current) => [createdOrder, ...current])
      setActiveTab('commandes')
      notify(t('Commande envoyée. Vous recevrez le total à payer et les instructions de règlement.'), 'success')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('Impossible d’enregistrer votre commande.')
      setError(message)
      notify(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="marketplace-page">
      <section className="marketplace-hero">
        <div className="marketplace-hero-icon"><ShoppingBag size={26} /></div>
        <div>
          <p className="eyebrow">{t('BOUTIQUE OFFICIELLE')}</p>
          <h1>{t('Portez la marque sur le terrain')}</h1>
          <p>{t('Équipez-vous avec les articles Ty sy Nday Business pour vos interventions auprès des clients.')}</p>
        </div>
        <div className="marketplace-hero-count"><strong>{products.length}</strong><span>{t('articles disponibles')}</span></div>
      </section>

      <div className="marketplace-tabs-row">
        <div className="marketplace-tabs" role="tablist" aria-label={t('Boutique et commandes')}>
          <button type="button" role="tab" aria-selected={activeTab === 'boutique'} className={activeTab === 'boutique' ? 'active' : ''} onClick={() => setActiveTab('boutique')}>
            <ShoppingBag size={17} /> {t('La boutique')} <span>{products.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'commandes'} className={activeTab === 'commandes' ? 'active' : ''} onClick={() => setActiveTab('commandes')}>
            <Package size={17} /> {t('Mes commandes')} <span>{orders.length}</span>
          </button>
        </div>
        {activeTab === 'commandes' && <button type="button" className="marketplace-refresh" disabled={refreshingOrders} onClick={() => void refreshOrders()}><RefreshCw size={15} /> {refreshingOrders ? t('Actualisation...') : t('Actualiser')}</button>}
      </div>

      {error && <div className="marketplace-alert" role="alert">{error}</div>}
      {loading ? <div className="marketplace-empty">{t('Chargement de la boutique...')}</div> : activeTab === 'boutique' ? (
        <div className="marketplace-layout">
          <section className="marketplace-catalog" aria-label={t('Articles disponibles')}>
            <div className="marketplace-toolbar">
              <label className="marketplace-search">
                <span className="sr-only">{t('Rechercher')}</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Rechercher un article')} />
              </label>
              <div className="marketplace-categories" aria-label={t('Catégories')}>
                {categories.map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item === 'TOUS' ? t('Tout') : item}</button>)}
              </div>
            </div>
            {filteredProducts.length ? <div className="marketplace-product-grid">
              {filteredProducts.map((product) => <ProductCard key={product.id} product={product} cartQuantities={cartQuantities} onAdd={addToCart} />)}
            </div> : <div className="marketplace-empty">{products.length ? t('Aucun article ne correspond à la recherche.') : t('La boutique sera bientôt disponible.')}</div>}
          </section>

          <aside className="marketplace-cart">
            <div className="marketplace-section-title"><div><p className="eyebrow">{t('VOTRE SÉLECTION')}</p><h2>{t('Panier')}</h2></div><span>{cart.length}</span></div>
            {cart.length ? (
              <form onSubmit={submitOrder}>
                <div className="marketplace-cart-lines">
                  {cart.map((item) => (
                    <div className="marketplace-cart-line" key={item.variantId}>
                      <div><strong>{item.productName}</strong><span>{item.variantLabel} · {item.quantity} × {formatAr(item.price)}</span></div>
                      <button type="button" aria-label={`${t('Retirer')} ${item.productName}`} onClick={() => removeFromCart(item.variantId)}>×</button>
                    </div>
                  ))}
                </div>
                <div className="marketplace-cart-total"><span>{t('Sous-total des articles')}</span><strong>{formatAr(cartTotal)}</strong></div>
                <label className="marketplace-field">
                  <span>{t('Mode de remise')}</span>
                  <select value={deliveryMethod} onChange={(event) => changeDeliveryMethod(event.target.value as MarketplaceDeliveryMethod)}>
                    <option value="LIVRAISON">{t('Livraison')}</option>
                    <option value="COLIS">{t('Colis')}</option>
                    <option value="RECUPERATION">{t('Récupération')}</option>
                  </select>
                </label>
                {deliveryMethod !== 'RECUPERATION' && <label className="marketplace-field">
                  <span>{deliveryMethod === 'COLIS' ? t('Adresse ou point relais') : t('Adresse de livraison')}</span>
                  <textarea required maxLength={1000} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder={t('Précisez le lieu de remise souhaité')} />
                </label>}
                <label className="marketplace-field">
                  <span>{t('Mode de paiement')}</span>
                  <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as MarketplacePaymentMethod)}>
                    {paymentSettings.providers.filter((provider) => provider.account).map((provider) => <option key={provider.method} value={provider.method}>{provider.label}</option>)}
                    {deliveryMethod === 'RECUPERATION' && <option value="ESPECES">{t('Espèces à la récupération')}</option>}
                  </select>
                </label>
                {paymentMethod === 'ESPECES'
                  ? <p className="marketplace-payment-note"><Truck size={16} /> {t('Le paiement en espèces sera effectué lors de la récupération de la commande.')}</p>
                  : (() => {
                    const provider = paymentSettings.providers.find((item) => item.method === paymentMethod && item.account)
                    return provider ? <div className="marketplace-payment-destination"><strong>{provider.label}</strong><span>{provider.account}</span>{provider.accountName && <small>{t('Bénéficiaire')}: {provider.accountName}</small>}{paymentSettings.instructions && <small>{paymentSettings.instructions}</small>}</div> : <p className="marketplace-alert">{t('Aucun compte Mobile Money n’est configuré. Contactez l’administration.')}</p>
                  })()}
                <label className="marketplace-field">
                  <span>{t('Note pour l’administration')} <small>{t('facultatif')}</small></span>
                  <textarea maxLength={1000} value={agentNote} onChange={(event) => setAgentNote(event.target.value)} placeholder={t('Taille, couleur ou précision utile...')} />
                </label>
                <p className="marketplace-payment-note"><Truck size={16} /> {deliveryMethod === 'RECUPERATION'
                  ? t('La récupération est gratuite. Vous avez 24 heures à partir de la commande pour régler.')
                  : t('L’administration confirme les frais de livraison ou de colis après la demande. Le délai de paiement de 24 heures commence à la réception du devis.')}</p>
                <button className="primary-button marketplace-submit" disabled={submitting || (paymentMethod !== 'ESPECES' && !paymentSettings.providers.some((provider) => provider.method === paymentMethod && provider.account))}>{submitting ? t('Envoi...') : <>{t('Envoyer la commande')} <ArrowRight size={17} /></>}</button>
              </form>
            ) : <div className="marketplace-cart-empty"><ShoppingCart size={25} /><p>{t('Ajoutez des articles pour préparer votre commande.')}</p></div>}
          </aside>
        </div>
      ) : (
        <section className="marketplace-orders">
          {orders.length ? orders.map((order) => (
            <article className="marketplace-order-card" key={order.id}>
              <header><div><span className="marketplace-order-number">#{order.id}</span><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleDateString('fr-FR')}</time></div><span className={`marketplace-status status-${order.status.toLowerCase()}`}>{order.status === 'DEMANDEE' && order.totalAmount === null ? t('En attente du devis') : t(orderStatusLabels[order.status])}</span></header>
              <div className="marketplace-order-items">{order.items.map((item) => <div key={item.id}><strong>{item.productName}</strong><span>{item.variantLabel} · {item.quantity} × {formatAr(item.unitPrice)}</span></div>)}</div>
              <div className="marketplace-order-totals">
                <span>{t('Articles')}</span><span>{formatAr(order.itemsAmount)}</span>
                <span>{t('Frais de remise')}</span><span>{order.deliveryFee === null ? t('À confirmer') : formatAr(order.deliveryFee)}</span>
                <strong>{t('Total à payer')}</strong><strong>{order.totalAmount === null ? t('En attente du devis') : formatAr(order.totalAmount)}</strong>
              </div>
              <footer><span>{t('Mode de remise')}: {t(order.deliveryMethod === 'RECUPERATION' ? 'Récupération' : order.deliveryMethod === 'LIVRAISON' ? 'Livraison' : 'Colis')}</span></footer>
              {order.deliveryAddress && <p className="marketplace-order-address">{order.deliveryAddress}</p>}
              {order.status === 'ANNULEE'
                ? <p className="marketplace-payment-status">{order.cancellationReason ?? t('Cette commande a été annulée.')}</p>
                : order.paymentStatus === 'PAYE'
                  ? <p className="marketplace-payment-status paid">{t('Paiement confirmé')} · {paymentMethodLabel(order.paymentMethod)}</p>
                  : order.totalAmount === null
                    ? <p className="marketplace-payment-status">{t('L’administration vous communiquera les frais de remise avant le paiement.')}{order.quoteExpiresAt && <> {t('Devis attendu avant le')} {new Date(order.quoteExpiresAt).toLocaleString('fr-FR')}.</>}</p>
                    : <div className="marketplace-order-payment">
                        <strong>{t('Paiement par')} {paymentMethodLabel(orderPaymentMethod(order))}</strong>
                      {order.paymentMethod === 'ESPECES'
                        ? <p>{t('Réglez en espèces lors de la récupération de votre commande.')}</p>
                        : <div className="marketplace-order-payment-info">
                            {!order.paymentMethod && <label className="marketplace-field">
                              <span>{t('Choisissez votre mode Mobile Money')}</span>
                              <select value={selectedPaymentMethods[order.id] ?? paymentSettings.providers.find((provider) => provider.account)?.method ?? ''} onChange={(event) => {
                                const method = event.target.value as MarketplaceMobilePaymentMethod
                                setSelectedPaymentMethods((current) => ({ ...current, [order.id]: method }))
                              }}>
                                <option value="" disabled>{t('Sélectionnez un mode')}</option>
                                {paymentSettings.providers.filter((provider) => provider.account).map((provider) => <option key={provider.method} value={provider.method}>{provider.label}</option>)}
                              </select>
                            </label>}
                            <span>{t('Envoyez le montant au')}: <strong>{order.paymentAccount ?? orderPaymentProvider(order)?.account ?? t('compte non configuré')}</strong></span>
                            {(order.paymentAccountName ?? orderPaymentProvider(order)?.accountName) && <span>{t('Bénéficiaire')}: {order.paymentAccountName ?? orderPaymentProvider(order)?.accountName}</span>}
                            {(order.paymentInstructions ?? paymentSettings.instructions) && <p>{order.paymentInstructions ?? paymentSettings.instructions}</p>}
                          <label className="marketplace-field">
                            <span>{t('Référence de transaction')}</span>
                            <input minLength={3} maxLength={100} value={paymentReferences[order.id] ?? order.paymentReference ?? ''} onChange={(event) => setPaymentReferences((current) => ({ ...current, [order.id]: event.target.value }))} placeholder={t('Saisissez la référence après le transfert')} />
                          </label>
                          <button type="button" className="primary-button" disabled={busyPaymentOrderId === order.id || currentTime === null || (!order.paymentExpiresAt && order.status !== 'EXPEDIEE' && order.status !== 'LIVREE') || Boolean(order.paymentExpiresAt && Date.parse(order.paymentExpiresAt) <= currentTime) || (!order.paymentMethod && !orderPaymentMethod(order)) || (paymentReferences[order.id] ?? order.paymentReference ?? '').trim().length < 3} onClick={() => void submitPaymentReference(order)}>
                            {busyPaymentOrderId === order.id ? t('Envoi...') : order.paymentReference ? t('Mettre à jour la référence') : t('Envoyer la référence')}
                          </button>
                        </div>}
                      {order.paymentExpiresAt && <small>{t('À régler avant le')} {new Date(order.paymentExpiresAt).toLocaleString('fr-FR')}</small>}
                      <p className="marketplace-payment-status">{t('L’administration vérifiera le paiement avant de confirmer la commande.')}</p>
                    </div>}
            </article>
          )) : <div className="marketplace-empty"><Package size={28} /><p>{t('Vous n’avez pas encore passé de commande.')}</p><button type="button" className="outline-button" onClick={() => setActiveTab('boutique')}>{t('Découvrir la boutique')}</button></div>}
        </section>
      )}
    </div>
  )
}
