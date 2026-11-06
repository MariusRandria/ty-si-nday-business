import type { TableHTMLAttributes } from 'react'
import './ui.css'

export function Table(props: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="ui-table-wrap"><table {...props} className={`ui-table ${props.className ?? ''}`} /></div>
}
