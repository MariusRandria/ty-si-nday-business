import tySyNdayLogo from '../../assets/LOGO.png'
import navLogo from '../../assets/LOGO-NAV.png'

type Props = { compact?: boolean; inverted?: boolean; navbar?: boolean }

export function Brand({ compact = false, inverted = false, navbar = false }: Props) {
  const content = (
    <>
      <img src={navbar ? navLogo : tySyNdayLogo} alt="" />
      {!compact && !navbar && (
        <span className={inverted ? 'brand-copy brand-copy-inverted' : 'brand-copy'}>
          <strong>TY SY NDAY</strong>
          <small>Business</small>
        </span>
      )}
    </>
  )

  return <a className={`brand-lockup${navbar ? ' brand-lockup-nav' : ''}`} href="/" aria-label="Ty sy Nday Business - Accueil">{content}</a>
}
