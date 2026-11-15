import { useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, Download, FileCheck2, FileWarning, LoaderCircle, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import api, {
  ApiRequestError,
  type AdminCollaborationPage,
  type AdminSignedContract,
  type AdminSignedContractsFilters,
  type AdminSignedContractStatus,
} from '../../api/client'
import { antananarivoDayBoundaryToIso } from '../../utils/admin-collaboration-workflows'
import { AdminTotpCodeField } from '../../components/admin/AdminTotpCodeField'
import './AdminSignedContractsPage.css'

type ContractFilters = {
  q: string
  status: 'ALL' | AdminSignedContractStatus
  from: string
  to: string
}

const EMPTY_FILTERS: ContractFilters = { q: '', status: 'ALL', from: '', to: '' }

const STATUS_LABELS: Record<AdminSignedContractStatus, string> = {
  CONTRACT_SIGNED: 'Contrat signé',
  COMMISSIONS_PAID: 'Commissions payées',
  DISPUTED: 'En litige',
}

function formatDate(value: string | null): string {
  if (!value) return 'Non renseignée'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date invalide'
    : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Indian/Antananarivo' }).format(date)
}

function formatAmount(value: string | null): string {
  if (value === null) return 'Non renseigné'
  if (!/^\d+$/.test(value)) return 'Montant invalide'
  return `${BigInt(value).toLocaleString('fr-FR')} Ar`
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof TypeError) return 'Erreur réseau. Vérifiez la connexion puis réessayez.'
  return error instanceof Error ? error.message : 'Une erreur est survenue. Réessayez.'
}

function queryFilters(filters: ContractFilters): AdminSignedContractsFilters {
  return {
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.status !== 'ALL' ? { status: filters.status } : {}),
    ...(filters.from ? { from: antananarivoDayBoundaryToIso(filters.from, false) } : {}),
    ...(filters.to ? { to: antananarivoDayBoundaryToIso(filters.to, true) } : {}),
  }
}

export default function AdminSignedContractsPage() {
  const [draftFilters, setDraftFilters] = useState<ContractFilters>(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<ContractFilters | null>(null)
  const [contracts, setContracts] = useState<AdminSignedContract[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloadingFileId, setDownloadingFileId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const requestLock = useRef(false)
  const downloadLock = useRef(false)
  const pageSize = 50
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const missingContractCount = contracts.filter((contract) => contract.contractFiles.length === 0).length

  async function loadContracts(event: FormEvent<HTMLFormElement>, nextPage = 1) {
    event.preventDefault()
    if (requestLock.current) return
    if (draftFilters.from && draftFilters.to && draftFilters.from > draftFilters.to) {
      setError('La date « Du » doit précéder ou être égale à la date « Au ».')
      return
    }
    const code = totp.trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez un nouveau code administrateur à 6 chiffres.')
      return
    }
    requestLock.current = true
    setTotp('')
    setBusy(true)
    setLoaded(false)
    setError('')
    setDownloadError('')
    try {
      const filters = queryFilters(draftFilters)
      const result: AdminCollaborationPage<AdminSignedContract> = await api.adminSignedContracts(code, nextPage, pageSize, filters)
      setContracts(result.data)
      setTotal(result.pagination.total)
      setPage(nextPage)
      setAppliedFilters({ ...draftFilters })
      setLoaded(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      requestLock.current = false
      setBusy(false)
    }
  }

  async function downloadFile(file: AdminSignedContract['contractFiles'][number]) {
    if (requestLock.current || downloadLock.current) return
    downloadLock.current = true
    setDownloadingFileId(file.id)
    setDownloadError('')
    try {
      const response = await fetch(file.downloadUrl, { cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) {
        throw new Error(response.status === 403
          ? 'Le lien sécurisé a expiré. Rechargez la liste pour obtenir un nouveau lien.'
          : 'Le fichier du contrat est indisponible.')
      }
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = file.fileName
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (caught) {
      setDownloadError(errorMessage(caught))
    } finally {
      downloadLock.current = false
      setDownloadingFileId(null)
    }
  }

  function changeFilters(update: (current: ContractFilters) => ContractFilters) {
    setDraftFilters(update)
    setPage(1)
    setError('')
  }

  const filtersChanged = appliedFilters !== null && JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters)

  return (
    <div className="admin-signed-contracts">
      <header className="admin-signed-contracts-hero">
        <div className="admin-signed-contracts-hero-icon"><FileCheck2 size={26} /></div>
        <div className="admin-signed-contracts-hero-copy">
          <div className="admin-signed-contracts-eyebrow">
            <span>ADMINISTRATION <i /> CONTRÔLE DES VENTES</span>
            <span className="admin-signed-contracts-secure"><ShieldCheck size={15} /> Accès sécurisé</span>
          </div>
          <h1>Registre des contrats signés</h1>
          <p>Contrôlez les ventes finalisées, les signataires et les pièces justificatives depuis une seule vue.</p>
        </div>
        <div className="admin-signed-contracts-hero-note">
          <strong>Suivi opérationnel</strong>
          <span>Les contrats les plus récents s’affichent en premier.</span>
        </div>
      </header>

      {loaded && (
        <section className="admin-signed-contracts-summary" aria-label="Résumé des résultats">
          <article>
            <span className="admin-signed-contracts-summary-icon"><FileCheck2 size={18} /></span>
            <div><strong>{total.toLocaleString('fr-FR')}</strong><span>Dossiers correspondants</span></div>
          </article>
          <article>
            <span className="admin-signed-contracts-summary-icon"><Search size={18} /></span>
            <div><strong>{contracts.length}</strong><span>Affichés sur cette page</span></div>
          </article>
          <article className={missingContractCount > 0 ? 'is-warning' : 'is-complete'}>
            <span className="admin-signed-contracts-summary-icon">{missingContractCount > 0 ? <FileWarning size={18} /> : <CheckCircle2 size={18} />}</span>
            <div><strong>{missingContractCount}</strong><span>Sans fichier sur cette page</span></div>
          </article>
        </section>
      )}

      <section className="admin-signed-contracts-panel">
        <div className="admin-signed-contracts-heading">
          <div><span className="admin-signed-contracts-section-icon"><Search size={18} /></span><div><h2>Recherche et filtres</h2><p>Affinez la liste avant de charger les dossiers.</p></div></div>
          {loaded && <span>{total.toLocaleString('fr-FR')} résultat{total === 1 ? '' : 's'} · Page {page}/{pageCount}</span>}
        </div>
        <form className="admin-signed-contracts-filters" onSubmit={(event) => void loadContracts(event, page)}>
          <label className="admin-signed-contracts-search">Recherche
            <input
              type="search"
              maxLength={100}
              placeholder="Client, projet, n° de vente ou dossier"
              value={draftFilters.q}
              onChange={(event) => changeFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label>État de la vente
            <select value={draftFilters.status} onChange={(event) => changeFilters((current) => ({ ...current, status: event.target.value as ContractFilters['status'] }))}>
              <option value="ALL">Tous les contrats signés</option>
              <option value="CONTRACT_SIGNED">Contrat signé</option>
              <option value="COMMISSIONS_PAID">Commissions payées</option>
              <option value="DISPUTED">En litige</option>
            </select>
          </label>
          <label>Signé du
            <input type="date" value={draftFilters.from} onChange={(event) => changeFilters((current) => ({ ...current, from: event.target.value }))} />
          </label>
          <label>Signé au
            <input type="date" value={draftFilters.to} onChange={(event) => changeFilters((current) => ({ ...current, to: event.target.value }))} />
          </label>
          <AdminTotpCodeField className="admin-signed-contracts-totp" label="Code administrateur" value={totp} onChange={setTotp} autoComplete="one-time-code" />
          <div className="admin-signed-contracts-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}
              {loaded ? 'Appliquer les filtres' : 'Afficher les contrats'}
            </button>
            <button type="button" className="outline-button" disabled={busy} onClick={() => changeFilters(() => EMPTY_FILTERS)}>Effacer les filtres</button>
          </div>
        </form>
        {filtersChanged && <p className="admin-signed-contracts-pending">Les filtres ont changé. Appliquez-les avec un nouveau code administrateur pour actualiser les résultats.</p>}
      </section>

      {error && <p className="admin-signed-contracts-error" role="alert">{error}</p>}
      {downloadError && <p className="admin-signed-contracts-error" role="alert">{downloadError}</p>}

      {loaded && (
        <section className="admin-signed-contracts-panel">
          <div className="admin-signed-contracts-heading">
            <div><span className="admin-signed-contracts-section-icon"><FileCheck2 size={18} /></span><div><h2>Ventes avec contrat signé</h2><p>Documents, équipes et dates de signature.</p></div></div>
            <span>Résultats {total === 0 ? '0' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} sur {total.toLocaleString('fr-FR')}</span>
          </div>
          {contracts.length === 0 ? (
            <div className="admin-signed-contracts-empty"><CheckCircle2 size={26} /><div><strong>Aucun contrat ne correspond à ces critères.</strong><p>Modifiez la recherche ou la période, puis réessayez.</p></div></div>
          ) : (
            <>
              <p className="admin-signed-contracts-scroll-hint">Faites défiler le tableau horizontalement pour consulter toutes les colonnes.</p>
              <div className="admin-signed-contracts-table-wrap">
                <table className="admin-signed-contracts-table">
                  <colgroup>
                    <col className="column-sale" />
                    <col className="column-client" />
                    <col className="column-project" />
                    <col className="column-team" />
                    <col className="column-signatory" />
                    <col className="column-dates" />
                    <col className="column-amount" />
                    <col className="column-contract" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Vente</th>
                      <th scope="col">Client</th>
                      <th scope="col">Projet / travaux</th>
                      <th scope="col">Équipe</th>
                      <th scope="col">Signataire</th>
                      <th scope="col">Dates</th>
                      <th scope="col">Montant</th>
                      <th scope="col">Contrat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.map((contract) => (
                      <tr key={contract.id} className={contract.contractFiles.length === 0 ? 'has-missing-contract' : undefined}>
                        <td>
                          <strong className="admin-signed-contracts-sale-number">{contract.saleNumber}</strong>
                          <span className="admin-signed-contracts-record">Dossier #{contract.id}</span>
                          <span className={`admin-signed-contracts-status status-${contract.status.toLowerCase()}`}>
                            {STATUS_LABELS[contract.status as AdminSignedContractStatus] ?? contract.status}
                          </span>
                        </td>
                        <td>
                          <strong>{contract.client.companyName}</strong>
                          <span>{contract.client.contactName}</span>
                        </td>
                        <td>
                          <strong>{contract.project}</strong>
                          {contract.projectDetails && <span>{contract.projectDetails}</span>}
                          {contract.closingDetails && <details><summary>Détails des travaux</summary><p>{contract.closingDetails}</p></details>}
                        </td>
                        <td>
                          <strong>{contract.supplier}</strong>
                          <span className="admin-signed-contracts-role">Fournisseur</span>
                          <strong>{contract.closer ?? 'Non renseigné'}</strong>
                          <span className="admin-signed-contracts-role">Closeur</span>
                        </td>
                        <td>
                          <strong>{contract.signatory ?? 'Non renseigné'}</strong>
                          <span className="admin-signed-contracts-signatory-note">
                            {contract.signatory ? 'Signature enregistrée par l’équipe' : 'Signataire absent de l’historique'}
                          </span>
                        </td>
                        <td>
                          <strong className="admin-signed-contracts-date">Signé <span>{formatDate(contract.contractSignedAt)}</span></strong>
                          <span className="admin-signed-contracts-sale-date">Vente : {formatDate(contract.saleDate)}</span>
                        </td>
                        <td className="admin-signed-contracts-amount">
                          <strong className={contract.contractAmount === null ? 'is-missing' : undefined}>{formatAmount(contract.contractAmount)}</strong>
                          <span>{contract.contractAmount === null ? 'Montant final non renseigné' : 'Montant final au contrat'}</span>
                          {contract.reportedAmount !== null && <small>Déclaré par le closeur : {formatAmount(contract.reportedAmount)}</small>}
                        </td>
                        <td>
                          <strong>{contract.contractReference ?? 'Référence non renseignée'}</strong>
                          {contract.contractFiles.length === 0
                            ? <span className="admin-signed-contracts-missing"><AlertTriangle size={15} />Fichier manquant</span>
                            : contract.contractFiles.map((file) => (
                              <div className="admin-signed-contracts-file" key={file.id}>
                                <button
                                  type="button"
                                  className="admin-signed-contracts-download"
                                  disabled={downloadingFileId === file.id}
                                  onClick={() => void downloadFile(file)}
                                >
                                  {downloadingFileId === file.id ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
                                  {file.fileName}
                                </button>
                                <span>Déposé le {formatDate(file.createdAt)} · {(file.fileSize / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko</span>
                                <details><summary>Empreinte SHA-256</summary><code>{file.sha256}</code></details>
                              </div>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-signed-contracts-pagination">
                <button type="button" className="outline-button" disabled={page <= 1 || busy} onClick={() => { setPage((current) => current - 1); setLoaded(false); setTotp('') }}>Précédent</button>
                <span>Page {page} / {pageCount}</span>
                <button type="button" className="outline-button" disabled={page >= pageCount || busy} onClick={() => { setPage((current) => current + 1); setLoaded(false); setTotp('') }}>Suivant</button>
              </div>
            </>
          )}
        </section>
      )}
      {!loaded && !busy && !error && <section className="admin-signed-contracts-hint"><Clock3 size={18} /><p>Les résultats sont triés du contrat le plus récent au plus ancien. Une recherche ou un changement de page exige un nouveau code administrateur.</p></section>}
    </div>
  )
}
