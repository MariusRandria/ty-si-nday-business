import { useEffect, useState, type ReactNode } from 'react'
import { io } from 'socket.io-client'
import { AgentPresenceContext, type AgentPresenceState } from './AgentPresenceContext'

type PresenceSnapshot = { onlineAgentIds: number[] }
type PresenceUpdate = { userId: number; isOnline: boolean; lastActiveAt: string | null }

export function AgentPresenceProvider({ userId, token, children }: { userId: number; token: string; children: ReactNode }) {
  const [presence, setPresence] = useState<Record<number, AgentPresenceState>>({})

  useEffect(() => {
    const socket = io({ auth: { token } })
    socket.on('presence:snapshot', (snapshot: PresenceSnapshot) => {
      if (!Array.isArray(snapshot.onlineAgentIds)) return
      setPresence((current) => {
        const next = { ...current }
        Object.keys(next).forEach((id) => {
          const numericId = Number(id)
          next[numericId] = { ...next[numericId], isOnline: false }
        })
        snapshot.onlineAgentIds.forEach((onlineId) => {
          if (!Number.isSafeInteger(onlineId)) return
          next[onlineId] = { isOnline: true, lastActiveAt: current[onlineId]?.lastActiveAt ?? null }
        })
        return next
      })
    })
    socket.on('presence:update', (update: PresenceUpdate) => {
      if (!Number.isSafeInteger(update.userId) || typeof update.isOnline !== 'boolean') return
      setPresence((current) => ({
        ...current,
        [update.userId]: {
          isOnline: update.isOnline,
          lastActiveAt: update.lastActiveAt ?? current[update.userId]?.lastActiveAt ?? null,
        },
      }))
    })
    socket.on('connect_error', (error: Error) => {
      console.error('Unable to connect to agent presence:', error)
    })
    return () => { socket.disconnect() }
  }, [token, userId])

  return <AgentPresenceContext.Provider value={presence}>{children}</AgentPresenceContext.Provider>
}
