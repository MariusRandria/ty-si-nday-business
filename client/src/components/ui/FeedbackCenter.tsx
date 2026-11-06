import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Info, X } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'
import { cancelPendingConfirmations, settleConfirmation, type ConfirmationOptions } from '../../utils/confirmation'
import type { ToastTone } from '../../utils/toast'
import './ui.css'

type ToastMessage = { message: string; tone: ToastTone; id: number }
type Confirmation = ConfirmationOptions & { id: number }

export function FeedbackCenter() {
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmationQueue, setConfirmationQueue] = useState<Confirmation[]>([])
  const toastId = useRef(0)
  const activeConfirmation = confirmationQueue[0]

  useEffect(() => {
    const handleToast = (event: Event) => {
      const { message, tone } = (event as CustomEvent<{ message: string; tone: ToastTone }>).detail
      if (tone === 'error') {
        setError(message)
        return
      }
      setToast({ message, tone, id: ++toastId.current })
    }
    const handleConfirmation = (event: Event) => {
      const request = (event as CustomEvent<Confirmation>).detail
      setConfirmationQueue((current) => [...current, request])
    }

    window.addEventListener('innovcom:toast', handleToast)
    window.addEventListener('innovcom:confirm', handleConfirmation)
    return () => {
      window.removeEventListener('innovcom:toast', handleToast)
      window.removeEventListener('innovcom:confirm', handleConfirmation)
      cancelPendingConfirmations()
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 4200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  function finishConfirmation(confirmed: boolean) {
    if (!activeConfirmation) return
    settleConfirmation(activeConfirmation.id, confirmed)
    setConfirmationQueue((current) => current.slice(1))
  }

  return <>
    {toast && <div className={`feedback-toast feedback-toast-${toast.tone}`} role="status" aria-live="polite">
      {toast.tone === 'success' ? <Check size={19} /> : <Info size={19} />}
      <span>{toast.message}</span>
      <button type="button" onClick={() => setToast(null)} aria-label="Fermer la notification"><X size={17} /></button>
    </div>}
    <Modal open={error !== null} title="Une erreur est survenue" onClose={() => setError(null)}
      footer={<Button onClick={() => setError(null)}>Compris</Button>}>
      <div className="feedback-error-content"><span><AlertTriangle size={22} /></span><p role="alert">{error}</p></div>
    </Modal>
    <Modal open={error === null && activeConfirmation !== undefined} title={activeConfirmation?.title ?? 'Confirmer l’action'} onClose={() => finishConfirmation(false)}
      footer={<><Button variant="secondary" onClick={() => finishConfirmation(false)}>{activeConfirmation?.cancelLabel ?? 'Annuler'}</Button><Button variant={activeConfirmation?.destructive ? 'danger' : 'primary'} onClick={() => finishConfirmation(true)}>{activeConfirmation?.confirmLabel ?? 'Confirmer'}</Button></>}>
      <p className="feedback-confirm-message">{activeConfirmation?.message}</p>
    </Modal>
  </>
}
