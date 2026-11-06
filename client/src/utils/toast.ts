export type ToastTone = 'success' | 'error' | 'info'

export function notify(message: string, tone: ToastTone = 'success') {
  window.dispatchEvent(new CustomEvent('innovcom:toast', { detail: { message, tone } }))
}
