import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Brand } from './Brand'
import { Button } from '../ui/Button'
import './brand.css'

const links = [
  ['Accueil', '#accueil'],
  ['Services', '#services'],
  ['À propos', '#apropos'],
  ['Contact', '#contact'],
] as const

export function Navbar() {
  const [open, setOpen] = useState(false)
  return (
    <nav className="brand-navbar" aria-label="Navigation principale">
      <Brand />
      <button className="brand-navbar-toggle" type="button" aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {open ? <X /> : <Menu />}
      </button>
      <div className={`brand-navbar-links ${open ? 'open' : ''}`}>
        {links.map(([label, href], index) => <a key={href} className={index === 0 ? 'active' : ''} href={href} onClick={() => setOpen(false)}>{label}</a>)}
        <Button variant="primary" onClick={() => document.querySelector('#contact')?.scrollIntoView({ behavior: 'smooth' })}>Nous contacter</Button>
      </div>
    </nav>
  )
}
