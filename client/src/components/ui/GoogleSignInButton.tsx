import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (container: HTMLElement, options: {
            theme: 'outline'
            size: 'large'
            text: 'continue_with' | 'signup_with'
            shape: 'pill'
            width: number
            locale: 'fr'
          }) => void
        }
      }
    }
  }
}

let googleScriptPromise: Promise<void> | null = null
let initializedGoogleClientId: string | null = null
let activeCredentialHandler: ((credential: string) => void) | null = null

function loadGoogleIdentityServices() {
  if (window.google?.accounts.id) return Promise.resolve()
  if (googleScriptPromise) return googleScriptPromise

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity-services]')
    const script = existing ?? document.createElement('script')
    const onLoad = () => window.google?.accounts.id ? resolve() : reject(new Error('Le service Google ne s’est pas initialisé.'))
    const onError = () => reject(new Error('Impossible de charger le service de connexion Google.'))

    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.googleIdentityServices = 'true'
      document.head.appendChild(script)
    }
  }).catch((error: unknown) => {
    googleScriptPromise = null
    throw error
  })

  return googleScriptPromise
}

export function GoogleSignInButton({
  clientId,
  mode,
  onCredential,
  onError,
}: {
  clientId: string
  mode: 'login' | 'register'
  onCredential: (credential: string) => void
  onError: (message: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbackRef = useRef(onCredential)
  const errorRef = useRef(onError)

  useEffect(() => { callbackRef.current = onCredential }, [onCredential])
  useEffect(() => { errorRef.current = onError }, [onError])

  useEffect(() => {
    let active = true
    const handleCredential = (credential: string) => callbackRef.current(credential)
    activeCredentialHandler = handleCredential
    void loadGoogleIdentityServices().then(() => {
      const google = window.google
      if (!active || !containerRef.current || !google) return
      const container = containerRef.current
      container.replaceChildren()
      if (!initializedGoogleClientId) {
        google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => activeCredentialHandler?.(credential),
        })
        initializedGoogleClientId = clientId
      } else if (initializedGoogleClientId !== clientId) {
        throw new Error('Le Client ID Google a changé. Rechargez la page pour continuer.')
      }
      google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        text: mode === 'register' ? 'signup_with' : 'continue_with',
        shape: 'pill',
        width: Math.max(220, Math.min(440, Math.floor(container.getBoundingClientRect().width))),
        locale: 'fr',
      })
    }).catch((error: unknown) => {
      if (active) errorRef.current(error instanceof Error ? error.message : 'Connexion Google indisponible.')
    })
    return () => {
      active = false
      if (activeCredentialHandler === handleCredential) activeCredentialHandler = null
    }
  }, [clientId, mode])

  return <div ref={containerRef} className="google-signin-button" aria-label="Continuer avec Google" />
}
