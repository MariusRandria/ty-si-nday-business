import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, BadgeCheck, Building2, CalendarDays, CarFront, Compass, MapPin, Phone, Search, UserRound } from 'lucide-react'
import api, { type ProspectContact } from '../api/client'
import { LoadingState } from '../components/ui/LoadingState'
import './admin/ProspectPages.css'

type GeoPoint = [longitude: number, latitude: number]
type RouteOrigin = { coordinates: GeoPoint; updatedAt: number }

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? ''

function googleMapUrl(prospect: ProspectContact, origin?: GeoPoint) {
  const params = new URLSearchParams({ key: googleMapsApiKey, language: 'fr', region: 'MG' })
  if (origin) {
    params.set('origin', `${origin[1]},${origin[0]}`)
    params.set('destination', `${prospect.latitude},${prospect.longitude}`)
    params.set('mode', 'driving')
    params.set('units', 'metric')
    return `https://www.google.com/maps/embed/v1/directions?${params}`
  }
  params.set('q', `${prospect.latitude},${prospect.longitude}`)
  params.set('center', `${prospect.latitude},${prospect.longitude}`)
  params.set('zoom', '16')
  return `https://www.google.com/maps/embed/v1/place?${params}`
}

function distanceBetween(first: GeoPoint, second: GeoPoint) {
  const radians = (value: number) => value * Math.PI / 180
  const latitudeDelta = radians(second[1] - first[1])
  const longitudeDelta = radians(second[0] - first[0])
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first[1])) * Math.cos(radians(second[1])) * Math.sin(longitudeDelta / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function contactLink(contact: string) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`
  const phone = contact.replace(/[^\d+]/g, '')
  if (/^\+?\d{6,}$/.test(phone)) return `tel:${phone}`
  return null
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function ProspectsPage({ onSubscribe }: { onSubscribe: () => void }) {
  const [prospects, setProspects] = useState<ProspectContact[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [badgeActive, setBadgeActive] = useState<boolean | null>(null)
  const [badgeExpiresAt, setBadgeExpiresAt] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeTracking, setRouteTracking] = useState(false)
  const [routeMessage, setRouteMessage] = useState('')
  const [routeOrigin, setRouteOrigin] = useState<RouteOrigin | null>(null)
  const locationWatchId = useRef<number | null>(null)
  const lastRouteOrigin = useRef<RouteOrigin | null>(null)

  useEffect(() => {
    let active = true
    api.subscriptionOverview()
      .then(async (overview) => {
        if (!active) return
        const hasBadge = Boolean(overview.current)
        setBadgeActive(hasBadge)
        setBadgeExpiresAt(overview.current?.expiresAt ? new Date(overview.current.expiresAt).getTime() : null)
        if (!hasBadge) return
        const data = await api.agentProspects()
        if (!active) return
        setProspects(data)
        setSelectedId(data[0]?.id ?? null)
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger les contacts prospects.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const filteredProspects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('fr')
    if (!normalizedQuery) return prospects
    return prospects.filter((prospect) => [
      prospect.companyName,
      prospect.responsibleName,
      prospect.address,
      prospect.contact,
    ].some((value) => value?.toLocaleLowerCase('fr').includes(normalizedQuery)))
  }, [prospects, query])
  const selectedProspect = filteredProspects.find((prospect) => prospect.id === selectedId) ?? filteredProspects[0] ?? null
  const mappedCount = prospects.filter((prospect) => prospect.latitude !== null && prospect.longitude !== null).length

  function stopLocationTracking() {
    if (locationWatchId.current !== null) {
      navigator.geolocation.clearWatch(locationWatchId.current)
      locationWatchId.current = null
    }
    setRouteTracking(false)
    setRouteBusy(false)
  }

  useEffect(() => () => {
    if (locationWatchId.current !== null) navigator.geolocation.clearWatch(locationWatchId.current)
  }, [])
  useEffect(() => {
    if (!badgeActive || badgeExpiresAt === null) return
    let timeout: number | undefined
    const checkExpiry = () => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      const remaining = badgeExpiresAt - Date.now()
      if (remaining <= 0) {
        setBadgeActive(false)
        return
      }
      timeout = window.setTimeout(checkExpiry, Math.min(remaining, 60_000))
    }
    checkExpiry()
    window.addEventListener('focus', checkExpiry)
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout)
      window.removeEventListener('focus', checkExpiry)
    }
  }, [badgeActive, badgeExpiresAt])

  if (loading) return <LoadingState label="Vérification de votre badge abonné…" />
  if (badgeActive === false) return <div className="prospect-page">
    <header className="page-heading prospect-heading"><div><p className="eyebrow">AVANTAGES TY SY NDAY</p><h1>Contacts prospects</h1><p className="intro">L’accès aux contacts partagés par l’administration est réservé aux agents disposant d’un badge abonné actif.</p></div></header>
    <section className="panel badge-prospect-locked">
      <span><BadgeCheck size={30} /></span>
      <h2>Débloquez les contacts prospects</h2>
      <p>Obtenez un badge par abonnement payant pour consulter les coordonnées détaillées et préparer vos visites. Votre accès sera activé après vérification manuelle du paiement.</p>
      <button className="primary-button" type="button" onClick={onSubscribe}>Découvrir le badge abonné</button>
    </section>
  </div>
  if (badgeActive === null) return <div className="prospect-page">
    <header className="page-heading prospect-heading"><div><p className="eyebrow">VOTRE PORTEFEUILLE COMMERCIAL</p><h1>Contacts prospects</h1></div></header>
    <div className="prospect-error" role="alert">{error || 'Impossible de vérifier le statut de votre badge.'}</div>
    <button className="outline-button" type="button" onClick={() => window.location.reload()}>Réessayer</button>
  </div>

  function selectProspect(prospectId: number) {
    stopLocationTracking()
    setRouteOrigin(null)
    lastRouteOrigin.current = null
    setRouteMessage('')
    setSelectedId(prospectId)
  }

  function toggleRouteTracking() {
    if (!selectedProspect || selectedProspect.latitude === null || selectedProspect.longitude === null) return
    if (routeTracking || routeBusy) {
      stopLocationTracking()
      return
    }
    setRouteMessage('')
    setRouteOrigin(null)
    lastRouteOrigin.current = null
    if (!googleMapsApiKey) {
      setRouteMessage('Google Maps n’est pas encore configuré. Ajoutez VITE_GOOGLE_MAPS_API_KEY dans client/.env, activez la Maps Embed API, puis redémarrez Vite.')
      return
    }
    if (!navigator.geolocation) {
      setRouteMessage('La géolocalisation n’est pas prise en charge par ce navigateur.')
      return
    }

    setRouteBusy(true)
    locationWatchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const origin: GeoPoint = [coords.longitude, coords.latitude]
        const now = Date.now()
        const previous = lastRouteOrigin.current
        if (!previous || distanceBetween(previous.coordinates, origin) >= 30 || now - previous.updatedAt >= 15000) {
          const nextOrigin = { coordinates: origin, updatedAt: now }
          lastRouteOrigin.current = nextOrigin
          setRouteOrigin(nextOrigin)
        }
        setRouteBusy(false)
        setRouteTracking(true)
        setRouteMessage('')
      },
      (geolocationError) => {
        setRouteBusy(false)
        setRouteTracking(false)
        if (locationWatchId.current !== null) {
          navigator.geolocation.clearWatch(locationWatchId.current)
          locationWatchId.current = null
        }
        if (geolocationError.code === geolocationError.PERMISSION_DENIED) {
          setRouteMessage('Autorisez la géolocalisation dans votre navigateur pour suivre votre itinéraire en direct.')
        } else if (geolocationError.code === geolocationError.POSITION_UNAVAILABLE) {
          setRouteMessage('Votre position actuelle est indisponible. Vérifiez le GPS ou les réglages de localisation de votre appareil.')
        } else {
          setRouteMessage('La localisation prend trop de temps. Vérifiez le GPS et réessayez.')
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
    )
  }

  return <div className="prospect-agent-page prospect-page">
    <header className="page-heading prospect-heading">
      <div><p className="eyebrow">VOTRE PORTEFEUILLE COMMERCIAL</p><h1>Contacts prospects</h1><p className="intro">Retrouvez les entreprises à contacter et préparez votre prochaine prise de contact.</p></div>
      <div className="prospect-heading-badge"><UserRound size={17} /> Contacts partagés par l’administration</div>
    </header>

    <section className="prospect-summary agent-prospect-summary" aria-label="Résumé de vos prospects">
      <article><span>Contacts disponibles</span><strong>{prospects.length}</strong><small>Réservés aux badges actifs</small></article>
      <article><span>Adresses cartographiées</span><strong>{mappedCount}</strong><small>Repères GPS renseignés</small></article>
      <article><span>À votre disposition</span><strong><Compass size={23} /></strong><small>Coordonnées pour faciliter vos visites</small></article>
    </section>

    {error && <div className="prospect-error" role="alert">{error}</div>}
    {loading ? <LoadingState label="Chargement des contacts prospects…" /> : prospects.length === 0
      ? <section className="panel prospect-empty prospect-agent-empty"><span><Building2 size={26} /></span><strong>Aucun contact prospect pour le moment</strong><p>Les nouveaux contacts ajoutés par l’administration apparaîtront ici. Vous recevrez une notification à chaque ajout.</p></section>
      : <section className="prospect-workspace">
        <aside className="panel prospect-directory">
          <div className="prospect-directory-heading"><div><span className="section-kicker">RÉPERTOIRE</span><h2>Entreprises</h2></div><span className="prospect-count">{filteredProspects.length}</span></div>
          <label className="prospect-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un prospect…" /></label>
          <div className="prospect-directory-list">
            {filteredProspects.map((prospect) => <button type="button" className={`prospect-directory-item ${selectedProspect?.id === prospect.id ? 'active' : ''}`} key={prospect.id} onClick={() => selectProspect(prospect.id)}>
              <span className="prospect-card-mark"><Building2 size={18} /></span>
              <span className="prospect-directory-copy"><strong>{prospect.companyName}</strong><small>{prospect.responsibleName || 'Responsable non renseigné'}</small><small className="prospect-directory-location"><MapPin size={12} />{prospect.address || (prospect.latitude !== null ? 'Localisation GPS disponible' : 'Adresse à préciser')}</small></span>
              <ArrowUpRight size={16} className="prospect-directory-arrow" />
            </button>)}
            {filteredProspects.length === 0 && <p className="prospect-no-results">Aucun prospect ne correspond à cette recherche.</p>}
          </div>
        </aside>

        {selectedProspect && <article className="panel prospect-detail">
          <div className="prospect-detail-heading">
            <span className="prospect-detail-icon"><Building2 size={23} /></span>
            <div><span className="section-kicker">FICHE PROSPECT</span><h2>{selectedProspect.companyName}</h2><p><CalendarDays size={14} /> Ajouté le {dateLabel(selectedProspect.createdAt)}</p></div>
          </div>
          <div className="prospect-detail-grid">
            <section className="prospect-info-card"><span className="prospect-info-icon"><UserRound size={17} /></span><div><small>RESPONSABLE</small><strong>{selectedProspect.responsibleName || 'Non renseigné'}</strong></div></section>
            <section className="prospect-info-card"><span className="prospect-info-icon"><Phone size={17} /></span><div><small>CONTACT DIRECT</small>{selectedProspect.contact ? <strong>{contactLink(selectedProspect.contact) ? <a href={contactLink(selectedProspect.contact)!}>{selectedProspect.contact}</a> : selectedProspect.contact}</strong> : <strong>Non renseigné</strong>}</div></section>
            <section className="prospect-info-card prospect-address-card"><span className="prospect-info-icon"><MapPin size={17} /></span><div><small>ADRESSE</small><strong>{selectedProspect.address || 'Adresse non renseignée'}</strong></div></section>
          </div>

          <section className="prospect-map-section">
            <div className="prospect-map-heading"><div><span className="section-kicker">LOCALISATION</span><h3>Emplacement du prospect</h3></div>{selectedProspect.latitude !== null && selectedProspect.longitude !== null && <span className="prospect-coordinate-chip"><MapPin size={13} /> {selectedProspect.latitude.toFixed(5)}, {selectedProspect.longitude.toFixed(5)}</span>}</div>
            {selectedProspect.latitude !== null && selectedProspect.longitude !== null
              ? <>
                {googleMapsApiKey
                  ? <div className="prospect-map">
                    <iframe
                      title={routeOrigin ? `Itinéraire Google Maps vers ${selectedProspect.companyName}` : `Carte Google Maps de ${selectedProspect.companyName}`}
                      src={googleMapUrl(selectedProspect, routeOrigin?.coordinates)}
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                    {routeTracking && <span className="prospect-route-label"><span className="prospect-live-dot" /> Itinéraire actualisé en direct</span>}
                    {!routeTracking && routeOrigin && <span className="prospect-route-label"><CarFront size={14} /> Dernière position connue</span>}
                  </div>
                  : <div className="prospect-map-missing"><MapPin size={22} /><div><strong>Google Maps n’est pas encore configuré</strong><p>Ajoutez VITE_GOOGLE_MAPS_API_KEY dans client/.env, activez Maps Embed API, puis redémarrez Vite.</p></div></div>}
                <div className="prospect-route-actions">
                  <button type="button" className={`prospect-route-button ${routeTracking ? 'is-tracking' : ''}`} onClick={toggleRouteTracking} disabled={routeBusy}>
                    <span className="prospect-route-icon"><CarFront size={19} /></span>
                    <span className="prospect-route-copy">
                      <strong>{routeBusy ? 'Recherche de votre position…' : routeTracking ? 'Arrêter le suivi en direct' : routeOrigin ? 'Reprendre le suivi en direct' : 'Démarrer l’itinéraire en direct'}</strong>
                      <small>{routeBusy ? 'Autorisez la géolocalisation si le navigateur le demande' : routeTracking ? 'Le trajet Google Maps suit votre position' : 'Votre position est demandée uniquement au démarrage'}</small>
                    </span>
                    {routeTracking ? <span className="prospect-live-indicator"><span className="prospect-live-dot" /> EN DIRECT</span> : <ArrowUpRight className="prospect-route-arrow" size={18} />}
                  </button>
                  {routeMessage && <p className="prospect-route-message" role="status">{routeMessage}</p>}
                </div>
              </>
              : <div className="prospect-map-missing"><MapPin size={22} /><div><strong>Coordonnées GPS non disponibles</strong><p>{selectedProspect.address ? 'Utilisez l’adresse indiquée pour localiser cette entreprise.' : 'Contactez l’administration pour obtenir la localisation du prospect.'}</p></div></div>}
          </section>
        </article>}
      </section>}
  </div>
}
