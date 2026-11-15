import { createContext, useContext } from 'react'

export type AgentPresenceState = { isOnline: boolean; lastActiveAt: string | null }

export const AgentPresenceContext = createContext<Readonly<Record<number, AgentPresenceState>>>({})

export function useAgentPresence(userId: number, fallbackLastActiveAt?: string | null) {
  const presence = useContext(AgentPresenceContext)[userId]
  return {
    isOnline: presence?.isOnline ?? false,
    lastActiveAt: presence?.lastActiveAt ?? fallbackLastActiveAt ?? null,
  }
}
