import tySyNdayLogo from '../../assets/TD.png'

type Props = { compact?: boolean; inverted?: boolean }

export function Brand({ compact = false, inverted = false }: Props) {
  const content = (
    <>
      <img src={tySyNdayLogo} alt="" />
      {!compact && (
        <span className={inverted ? 'brand-copy brand-copy-inverted' : 'brand-copy'}>
          <strong>TY SY NDAY</strong>
          <small>Business</small>
        </span>
      )}
    </>
  )

  return <a className="brand-lockup" href="/" aria-label="Ty sy Nday Business - Accueil">{content}</a>
}
