import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './dashboard-brand.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<main role="status" style={{ padding: 32 }}>Chargement de Ty sy Nday Business…</main>}>
      <App />
    </Suspense>
  </StrictMode>,
)
