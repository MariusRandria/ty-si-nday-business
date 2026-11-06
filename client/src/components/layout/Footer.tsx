import { Mail, MapPin, Phone, Globe } from 'lucide-react'
import { Brand } from './Brand'
import './brand.css'

export function Footer() {
  return (
    <footer className="brand-footer" id="contact">
      <div className="brand-footer-inner">
        <div><Brand inverted /><p>Des solutions pour votre avenir. Ensemble pour vos projets.</p></div>
        <div><h3>Services</h3><p>Conseil & Accompagnement</p><p>Formation</p><p>Innovation</p><p>Développement</p></div>
        <div><h3>Contact</h3><a href="tel:+26134123456"><Phone size={17} /> +261 34 12 34 56</a><a href="mailto:contact@tysynday.com"><Mail size={17} /> contact@tysynday.com</a><a href="https://www.tysynday.com"><Globe size={17} /> www.tysynday.com</a><span><MapPin size={17} /> Madagascar</span></div>
      </div>
      <p className="brand-footer-copy">© {new Date().getFullYear()} Ty sy Nday Business</p>
    </footer>
  )
}
