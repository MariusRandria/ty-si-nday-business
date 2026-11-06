import { LoaderCircle } from 'lucide-react'

export function LoadingState({ label = 'Chargement en cours…' }: { label?: string }) {
  return <div className="ui-loading-state" role="status" aria-live="polite" aria-busy="true">
    <LoaderCircle className="ui-loading-state-icon" size={22} />
    <span>{label}</span>
  </div>
}
