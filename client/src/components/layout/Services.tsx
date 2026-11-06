import { Compass, GraduationCap, Lightbulb, Code2 } from 'lucide-react'
import './brand.css'

const services = [
  { title: 'Conseil & Accompagnement', icon: Compass, text: 'Des stratégies claires, adaptées à vos objectifs et à votre contexte.' },
  { title: 'Formation', icon: GraduationCap, text: 'Des parcours pratiques pour monter en compétences et progresser.' },
  { title: 'Innovation', icon: Lightbulb, text: 'De nouvelles idées pour transformer vos défis en opportunités.' },
  { title: 'Développement', icon: Code2, text: 'Des solutions digitales fiables, utiles et conçues pour évoluer.' },
]

export function Services() {
  return (
    <section className="brand-services" id="services" aria-labelledby="services-title">
      <p>Nos expertises</p>
      <h2 id="services-title">Des solutions pensées avec vous</h2>
      <div className="brand-services-grid">
        {services.map(({ title, icon: Icon, text }) => <article className="brand-service-card" key={title}><span className="brand-service-card-icon"><Icon size={26} strokeWidth={1.7} /></span><h3>{title}</h3><p>{text}</p></article>)}
      </div>
    </section>
  )
}
