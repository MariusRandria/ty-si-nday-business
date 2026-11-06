import { ArrowRight } from 'lucide-react'
import { Button } from '../ui/Button'
import './brand.css'
import tySyNdayLogo from '../../assets/TD.png'

export function Hero() {
  return (
    <section className="brand-hero" id="accueil">
      <div className="brand-hero-inner">
        <div>
          <p>TY SY NDAY BUSINESS</p>
          <h1>Des solutions pour votre avenir <span className="brand-hero-script">Ensemble pour vos projets</span></h1>
          <p>Conseil, formation, innovation et développement pour accompagner durablement vos ambitions.</p>
          <div className="brand-hero-actions">
            <Button variant="secondary" onClick={() => document.querySelector('#services')?.scrollIntoView({ behavior: 'smooth' })}>Découvrir nos services</Button>
            <Button variant="primary" onClick={() => document.querySelector('#contact')?.scrollIntoView({ behavior: 'smooth' })}>Démarrer un projet <ArrowRight size={18} /></Button>
          </div>
        </div>
        <img className="brand-hero-visual" src={tySyNdayLogo} alt="Logo Ty sy Nday Business" />
      </div>
      <svg className="brand-hero-wave" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true"><path fill="currentColor" d="M0 75 C280 5 480 120 760 55 C1040-10 1230 65 1440 28 L1440 120 L0 120Z" /></svg>
    </section>
  )
}
