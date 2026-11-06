import './ui.css'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Props = { page: number; pageCount: number; onChange: (page: number) => void }
export function Pagination({ page, pageCount, onChange }: Props) {
  if (pageCount <= 1) return null
  return (
    <nav className="ui-pagination" aria-label="Pagination">
      <button className="ui-page-button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Page précédente"><ChevronLeft size={18} /></button>
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} className={`ui-page-button ${number === page ? 'ui-page-button-active' : ''}`} onClick={() => onChange(number)} aria-current={number === page ? 'page' : undefined}>{number}</button>)}
      <button className="ui-page-button" disabled={page >= pageCount} onClick={() => onChange(page + 1)} aria-label="Page suivante"><ChevronRight size={18} /></button>
    </nav>
  )
}
