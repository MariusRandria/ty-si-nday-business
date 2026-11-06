export type ConfirmationOptions = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmationRequest = ConfirmationOptions & { id: number }

const resolvers = new Map<number, (confirmed: boolean) => void>()
let nextRequestId = 0

export function confirmAction(options: ConfirmationOptions): Promise<boolean> {
  const id = ++nextRequestId
  return new Promise((resolve) => {
    resolvers.set(id, resolve)
    window.dispatchEvent(new CustomEvent<ConfirmationRequest>('innovcom:confirm', { detail: { ...options, id } }))
  })
}

export function settleConfirmation(id: number, confirmed: boolean) {
  const resolve = resolvers.get(id)
  if (!resolve) return
  resolvers.delete(id)
  resolve(confirmed)
}

export function cancelPendingConfirmations() {
  for (const [id, resolve] of resolvers) {
    resolvers.delete(id)
    resolve(false)
  }
}
