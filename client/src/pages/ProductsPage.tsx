import { useEffect, useMemo, useState } from 'react'
import { PackageOpen } from 'lucide-react'
import api, { type Product } from '../api/client'
import { useI18n } from '../i18n'
import './ProductsPage.css'

function ProductCard({ product, tone, onOpen }: { product: Product; tone: string; onOpen: () => void }) {
  const { t } = useI18n()

  return (
    <article className={`product-card ${tone}`}>
      <div className="product-art"><span>◈</span></div>
      <div className="product-body">
        <span className="product-tag">{t(product.id === 1 ? 'SOLUTION PHARE' : product.id === 2 ? 'NOUVEAU' : 'EXPERTISE')}</span>
        <h2>{product.title}</h2>
        <p>{product.description}</p>
        <button type="button" className="text-button" onClick={onOpen}>{t('Voir le produit')} <span>→</span></button>
      </div>
    </article>
  )
}

export default function ProductsPage() {
  const { t } = useI18n()
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)

  useEffect(() => {
    api.products().then((items) => {
      if (items.length) setProducts(items)
    }).catch(() => undefined)
  }, [])

  const filtered = useMemo(
    () => products.filter((product) => product.title.toLowerCase().includes(query.toLowerCase())),
    [products, query],
  )

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">{t('RESSOURCES COMMERCIALES')}</p>
          <h1>{t('Catalogue produits')}</h1>
          <p className="intro">{t('Les solutions à découvrir et à faire connaître.')}</p>
        </div>
        <input
          className="catalog-search"
          aria-label={t('Rechercher')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`⌕ ${t('Rechercher')}`}
        />
      </section>
      <div className="product-grid">
        {filtered.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            tone={['coral', 'blue-card', 'green-card'][index % 3]}
            onOpen={() => setSelected(product)}
          />
        ))}
      </div>
      {selected && (
        <div className="modal-backdrop product-detail-backdrop" onClick={() => setSelected(null)}>
          <section
            className="modal product-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="modal-close" aria-label={t('Fermer')} onClick={() => setSelected(null)}>×</button>
            <div className="product-detail-heading">
              <span className="product-detail-icon" aria-hidden="true"><PackageOpen size={22} /></span>
              <div>
                <p className="eyebrow">{t('FICHE PRODUIT')}</p>
                <h2 id="product-detail-title">{selected.title}</h2>
              </div>
            </div>
            <p className="modal-intro">{selected.description}</p>
            <div className="product-detail-sections">
              <section className="product-detail-section">
                <h3>{t('Pour qui ?')}</h3>
                <p>{selected.targetAudience}</p>
              </section>
              <section className="product-detail-section">
                <h3>{t('Argumentaire')}</h3>
                <p>{selected.salesPitch}</p>
              </section>
            </div>
            <div className="product-detail-actions">
              <button type="button" className="primary-button" onClick={() => setSelected(null)}>{t('J’ai compris')}</button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
