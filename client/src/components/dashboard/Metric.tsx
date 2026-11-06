export default function Metric({ label, value, suffix, note, trend }: { label: string; value: string; suffix: string; note: string; trend?: boolean }) {
  return <article className="metric"><span className="metric-label">{label}</span><div className="metric-value"><strong>{value}</strong><small>{suffix}</small></div><span className={trend ? 'metric-note positive' : 'metric-note'}>{trend && '↗ '}{note}</span></article>
}
