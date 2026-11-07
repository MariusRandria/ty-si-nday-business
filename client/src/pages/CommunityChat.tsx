import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { io, type Socket } from 'socket.io-client'
import api, { type ChatAgent, type ChatConversation, type ChatMessage, type CommunityAuthor } from '../api/client'
import { Archive, ArchiveRestore, ArrowLeft, AudioLines, FileText, Maximize2, MessageCircle, Mic, MoreHorizontal, Paperclip, Pause, Phone, PhoneCall, PhoneOff, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, Search, Send, ShieldCheck, Square, SquarePen, Trash2, X } from 'lucide-react'
import { SubscriberBadge } from '../components/ui/SubscriberBadge'

function nameOf(agent: CommunityAuthor) {
  return agent.agentProfile
    ? `${agent.agentProfile.firstName} ${agent.agentProfile.lastName}`
    : `Agent #${agent.id}`
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

function avatarContent(agent: CommunityAuthor, name: string) {
  return agent.agentProfile?.imageUrl
    ? <img src={agent.agentProfile.imageUrl} alt="" loading="lazy" />
    : initials(name)
}

function timeOf(value: string) {
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

type VoiceCallState = {
  callId: string;
  conversationId: number;
  peerName: string;
  direction: 'incoming' | 'outgoing';
  status: 'incoming' | 'outgoing' | 'connecting' | 'active';
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function callLog(content: string) {
  if (content.startsWith('Appel passé · ')) return { label: content, type: 'completed' as const }
  if (content === 'Appel manqué') return { label: content, type: 'missed' as const }
  if (content === 'Appel refusé') return { label: content, type: 'declined' as const }
  if (content === 'Appel annulé') return { label: content, type: 'cancelled' as const }
  if (content === 'Appel interrompu') return { label: content, type: 'interrupted' as const }
  return null
}

function CallLogMessage({ content }: { content: string }) {
  const entry = callLog(content)
  if (!entry) return <p>{content}</p>
  const Icon = entry.type === 'missed'
    ? PhoneMissed
    : entry.type === 'completed'
      ? PhoneOutgoing
      : entry.type === 'declined' || entry.type === 'cancelled'
        ? PhoneOff
        : PhoneCall
  return <div className={`chat-call-log ${entry.type}`}><Icon size={16} aria-hidden="true" /><span>{entry.label}</span></div>
}

function audioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const finish = (duration?: number) => {
      URL.revokeObjectURL(url)
      audio.onloadedmetadata = null
      audio.onerror = null
      if (duration === undefined) reject(new Error('Impossible de lire la durée de ce fichier audio.'))
      else resolve(duration)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(audio.duration)
    audio.onerror = () => finish()
    audio.src = url
  })
}

function formatAudioTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(safeSeconds / 60)}:${(safeSeconds % 60).toString().padStart(2, '0')}`
}

function ChatAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackError, setPlaybackError] = useState('')
  const waveform = [4, 7, 11, 6, 14, 9, 17, 11, 6, 13, 19, 9, 15, 7, 12, 18, 8, 14, 5, 11, 17, 9, 13, 6, 16, 10, 7, 12, 5, 9]
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio) return
    setPlaybackError('')
    if (!audio.paused) {
      audio.pause()
      return
    }
    try {
      await audio.play()
    } catch {
      setPlaybackError('La lecture de ce message vocal est impossible.')
    }
  }

  function seekAudio(value: number) {
    const audio = audioRef.current
    if (!audio || duration <= 0) return
    audio.currentTime = value
    setCurrentTime(value)
  }

  return <div className="chat-audio-player">
    <audio
      ref={audioRef}
      className="chat-audio-element"
      src={src}
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      onLoadedMetadata={(event) => {
        const loadedDuration = event.currentTarget.duration
        if (Number.isFinite(loadedDuration)) setDuration(loadedDuration)
      }}
      onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); setCurrentTime(0) }}
      onError={() => setPlaybackError('Impossible de charger le message vocal.')}
    />
    <button
      className="chat-audio-play"
      type="button"
      aria-label={playing ? 'Mettre le message vocal en pause' : 'Lire le message vocal'}
      onClick={() => void togglePlayback()}
    >
      {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
    </button>
    <div className="chat-audio-content">
      <div className="chat-audio-heading">
        <span><AudioLines size={14} aria-hidden="true" /> Message vocal</span>
        <time>{formatAudioTime(currentTime)} <i>/</i> {formatAudioTime(duration)}</time>
      </div>
      <div className="chat-audio-waveform" aria-hidden="true">
        {waveform.map((height, index) => <i
          key={index}
          className={index / waveform.length <= progress / 100 ? 'played' : ''}
          style={{ height: `${height}px` }}
        />)}
      </div>
      <input
        className="chat-audio-seek"
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration)}
        aria-label="Position dans le message vocal"
        disabled={!duration}
        onChange={(event) => seekAudio(Number(event.currentTarget.value))}
      />
      {playbackError && <span className="chat-audio-error" role="alert">{playbackError}</span>}
    </div>
  </div>
}

function ChatMedia({ message }: { message: ChatMessage }) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState('')

  useEffect(() => {
    if (!message.mediaUrl) return
    let active = true
    let objectUrl: string | null = null
    api.communityChatMedia(message.mediaUrl)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (active) setMediaUrl(objectUrl)
        else URL.revokeObjectURL(objectUrl)
      })
      .catch((caught) => {
        if (active) setMediaError(caught instanceof Error ? caught.message : 'Impossible de charger le média.')
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [message.mediaUrl])

  if (mediaError) return <p className="chat-media-error" role="alert">{mediaError}</p>
  if (!mediaUrl) return <span className="chat-media-loading">Chargement du média…</span>
  if (message.mediaMimeType?.startsWith('audio/')) {
    return <ChatAudioPlayer src={mediaUrl} />
  }
  return message.mediaMimeType?.startsWith('video/')
    ? <video className="chat-video" src={mediaUrl} controls preload="metadata" playsInline aria-label="Vidéo envoyée dans le chat" />
    : <img className="chat-image" src={mediaUrl} alt="Image envoyée dans le chat" loading="lazy" />
}

export default function CommunityChat({ currentUserId, initialConversationId }: { currentUserId: number; initialConversationId?: number }) {
  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [recording, setRecording] = useState(false)
  const [startingRecording, setStartingRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [voiceCall, setVoiceCall] = useState<VoiceCallState | null>(null)
  const [callSeconds, setCallSeconds] = useState(0)
  const [ringtoneBlocked, setRingtoneBlocked] = useState(false)
  const [conversationFilter, setConversationFilter] = useState<'all' | 'unread' | 'archived'>('all')
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false)
  const [openMessageMenuId, setOpenMessageMenuId] = useState<number | null>(null)
  const [messageMenuPosition, setMessageMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [conversationActionBusy, setConversationActionBusy] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [error, setError] = useState(() => window.localStorage.getItem('innovcom-token')
    ? ''
    : 'Votre session a expiré. Reconnectez-vous pour accéder au chat.')
  const socketRef = useRef<Socket | null>(null)
  const activeIdRef = useRef<number | null>(null)
  const conversationsRef = useRef<ChatConversation[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef(0)
  const recordingTimerRef = useRef<number | null>(null)
  const recordingConversationIdRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const voiceCallRef = useRef<VoiceCallState | null>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const localCallStreamRef = useRef<MediaStream | null>(null)
  const remoteCallStreamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const callStartedAtRef = useRef(0)
  const ringtoneContextRef = useRef<AudioContext | null>(null)
  const ringtoneTimerRef = useRef<number | null>(null)
  const activeMessages = messages.filter((message) => message.conversationId === activeId)

  function updateVoiceCall(next: VoiceCallState | null) {
    voiceCallRef.current = next
    setVoiceCall(next)
  }

  function closeVoiceConnection() {
    peerConnectionRef.current?.close()
    peerConnectionRef.current = null
    localCallStreamRef.current?.getTracks().forEach((track) => track.stop())
    localCallStreamRef.current = null
    remoteCallStreamRef.current = null
    pendingIceCandidatesRef.current = []
    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause()
      remoteAudioRef.current.srcObject = null
    }
  }

  function stopRingtone() {
    if (ringtoneTimerRef.current !== null) {
      window.clearInterval(ringtoneTimerRef.current)
      ringtoneTimerRef.current = null
    }
    const context = ringtoneContextRef.current
    ringtoneContextRef.current = null
    if (context && context.state !== 'closed') void context.close()
  }

  function playTelephoneBurst(context: AudioContext, startAt: number, duration: number, volume: number) {
    for (const frequency of [440, 480]) {
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      envelope.gain.setValueAtTime(0.0001, startAt)
      envelope.gain.exponentialRampToValueAtTime(volume / 2, startAt + 0.035)
      envelope.gain.setValueAtTime(volume / 2, startAt + duration - 0.06)
      envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
      oscillator.connect(envelope)
      envelope.connect(context.destination)
      oscillator.start(startAt)
      oscillator.stop(startAt + duration + 0.01)
    }
  }

  function playCallTone(context: AudioContext, direction: 'incoming' | 'outgoing') {
    const now = context.currentTime + 0.02
    if (direction === 'incoming') {
      playTelephoneBurst(context, now, 0.38, 0.12)
      playTelephoneBurst(context, now + 0.58, 0.38, 0.12)
      return
    }
    playTelephoneBurst(context, now, 1, 0.07)
  }

  async function startRingtone() {
    stopRingtone()
    const call = voiceCallRef.current
    if (!call) return
    const direction = call.status
    if (direction !== 'incoming' && direction !== 'outgoing') return
    try {
      const context = new AudioContext()
      ringtoneContextRef.current = context
      await context.resume()
      if (ringtoneContextRef.current !== context || voiceCallRef.current?.callId !== call.callId) return
      if (context.state !== 'running') throw new Error('Audio context remains suspended.')
      setRingtoneBlocked(false)
      playCallTone(context, direction)
      ringtoneTimerRef.current = window.setInterval(() => {
        if (context.state === 'running' && voiceCallRef.current?.callId === call.callId) {
          playCallTone(context, direction)
        }
      }, direction === 'incoming' ? 2400 : 4000)
    } catch {
      const context = ringtoneContextRef.current
      if (context && context.state !== 'closed') void context.close()
      ringtoneContextRef.current = null
      if (mountedRef.current) setRingtoneBlocked(true)
    }
  }

  async function createVoicePeerConnection(callId: string) {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      throw new Error('Les appels vocaux ne sont pas pris en charge par ce navigateur.')
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (!mountedRef.current || voiceCallRef.current?.callId !== callId) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error('L’appel a été terminé.')
    }
    closeVoiceConnection()
    localCallStreamRef.current = stream
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    peerConnectionRef.current = peer
    stream.getTracks().forEach((track) => peer.addTrack(track, stream))
    peer.ontrack = (event) => {
      const [remoteStream] = event.streams
      if (!remoteStream) return
      remoteCallStreamRef.current = remoteStream
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream
        void remoteAudioRef.current.play().catch(() => {
          setError('Appuyez sur lecture pour activer le son de l’appel.')
        })
      }
    }
    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      socketRef.current?.emit('voice-call:signal', {
        callId,
        type: 'ice',
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment,
        },
      }, (result?: { error?: string }) => {
        if (result?.error) setError(result.error)
      })
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        callStartedAtRef.current = Date.now()
        const current = voiceCallRef.current
        if (current?.callId === callId) updateVoiceCall({ ...current, status: 'active' })
        socketRef.current?.emit('voice-call:connected', { callId }, (result?: { error?: string }) => {
          if (result?.error) setError(result.error)
        })
      } else if (peer.connectionState === 'failed') {
        setError('La connexion audio a échoué. Vérifiez le réseau puis réessayez.')
        socketRef.current?.emit('voice-call:end', { callId })
        closeVoiceConnection()
        updateVoiceCall(null)
      }
    }
    return peer
  }

  async function flushPendingIceCandidates(peer: RTCPeerConnection) {
    const candidates = pendingIceCandidatesRef.current
    pendingIceCandidatesRef.current = []
    for (const candidate of candidates) await peer.addIceCandidate(candidate)
  }

  async function handleVoiceSignal(signal: {
    callId: string;
    type: 'offer' | 'answer' | 'ice';
    sdp?: string;
    candidate?: RTCIceCandidateInit;
  }) {
    const current = voiceCallRef.current
    const peer = peerConnectionRef.current
    if (!current || current.callId !== signal.callId || !peer) return
    try {
      if (signal.type === 'ice') {
        if (signal.candidate) {
          if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate)
          else pendingIceCandidatesRef.current.push(signal.candidate)
        }
        return
      }
      if (!signal.sdp) return
      await peer.setRemoteDescription({ type: signal.type, sdp: signal.sdp })
      await flushPendingIceCandidates(peer)
      if (signal.type === 'offer') {
        const answer = await peer.createAnswer()
        if (!answer.sdp) throw new Error('Impossible de créer la réponse audio.')
        await peer.setLocalDescription(answer)
        socketRef.current?.emit('voice-call:signal', {
          callId: signal.callId,
          type: 'answer',
          sdp: answer.sdp,
        }, (result?: { error?: string }) => {
          if (result?.error) setError(result.error)
        })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible d’établir la connexion audio.')
      socketRef.current?.emit('voice-call:end', { callId: signal.callId })
      closeVoiceConnection()
      updateVoiceCall(null)
    }
  }

  async function beginOutgoingVoiceConnection(callId: string) {
    try {
      const peer = await createVoicePeerConnection(callId)
      const offer = await peer.createOffer()
      if (!offer.sdp) throw new Error('Impossible de créer la connexion audio.')
      await peer.setLocalDescription(offer)
      socketRef.current?.emit('voice-call:signal', {
        callId,
        type: 'offer',
        sdp: offer.sdp,
      }, (result?: { error?: string }) => {
        if (result?.error) {
          setError(result.error)
          closeVoiceConnection()
          updateVoiceCall(null)
        }
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de démarrer l’appel vocal.')
      socketRef.current?.emit('voice-call:end', { callId })
      closeVoiceConnection()
      updateVoiceCall(null)
    }
  }

  async function startVoiceCall(conversation: ChatConversation) {
    const socket = socketRef.current
    if (!socket?.connected || voiceCallRef.current) {
      setError(voiceCallRef.current ? 'Un appel vocal est déjà en cours.' : 'Le chat est déconnecté. Réessayez dans quelques instants.')
      return
    }
    setError('')
    socket.timeout(10_000).emit('voice-call:start', { conversationId: conversation.id }, (
      timeoutError: Error,
      result: { callId?: string; error?: string },
    ) => {
      if (timeoutError) {
        setError('Le serveur ne répond pas. Impossible de démarrer l’appel.')
        return
      }
      if (result.error || !result.callId) {
        setError(result.error ?? 'Impossible de démarrer l’appel vocal.')
        return
      }
      updateVoiceCall({
        callId: result.callId,
        conversationId: conversation.id,
        peerName: nameOf(conversation.agent),
        direction: 'outgoing',
        status: 'outgoing',
      })
    })
  }

  async function acceptVoiceCall() {
    const call = voiceCallRef.current
    if (!call || call.status !== 'incoming') return
    updateVoiceCall({ ...call, status: 'connecting' })
    try {
      await createVoicePeerConnection(call.callId)
      socketRef.current?.timeout(10_000).emit('voice-call:accept', { callId: call.callId }, (
        timeoutError: Error,
        result: { callId?: string; error?: string },
      ) => {
        if (timeoutError || result.error) {
          setError(result.error ?? 'Le serveur ne répond pas pour accepter cet appel.')
          closeVoiceConnection()
          updateVoiceCall(null)
        }
      })
    } catch (caught) {
      setError(caught instanceof Error && caught.name === 'NotAllowedError'
        ? 'Autorisez l’accès au microphone pour répondre à l’appel.'
        : caught instanceof Error ? caught.message : 'Impossible de répondre à l’appel.')
      socketRef.current?.emit('voice-call:decline', { callId: call.callId })
      closeVoiceConnection()
      updateVoiceCall(null)
    }
  }

  function finishVoiceCall() {
    const call = voiceCallRef.current
    if (!call) return
    socketRef.current?.emit('voice-call:end', { callId: call.callId })
    closeVoiceConnection()
    updateVoiceCall(null)
  }

  function declineVoiceCall() {
    const call = voiceCallRef.current
    if (!call || call.status !== 'incoming') return
    socketRef.current?.emit('voice-call:decline', { callId: call.callId })
    updateVoiceCall(null)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopRingtone()
      closeVoiceConnection()
      if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current)
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null
        recorder.stop()
      }
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    conversationsRef.current = conversations
    window.dispatchEvent(new Event('tysynday:chat-unread-updated'))
  }, [conversations])

  useEffect(() => {
    if (remoteAudioRef.current && remoteCallStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteCallStreamRef.current
    }
  }, [voiceCall?.status])

  useEffect(() => {
    if (voiceCall?.status === 'incoming' || voiceCall?.status === 'outgoing') {
      void startRingtone()
    } else {
      stopRingtone()
    }
    return stopRingtone
  }, [voiceCall?.callId, voiceCall?.status])

  useEffect(() => {
    if (voiceCall?.status !== 'active') {
      setCallSeconds(0)
      return
    }
    const timer = window.setInterval(() => {
      setCallSeconds(Math.floor((Date.now() - callStartedAtRef.current) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [voiceCall?.status])

  useEffect(() => {
    let active = true
    Promise.all([api.communityChatAgents(), api.communityChatConversations()])
      .then(([availableAgents, currentConversations]) => {
        if (!active) return
        setAgents(availableAgents)
        setConversations(currentConversations)
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger la messagerie.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!initialConversationId || !conversations.some((conversation) => conversation.id === initialConversationId)) return
    setActiveId(initialConversationId)
  }, [initialConversationId, conversations])

  useEffect(() => {
    if (!conversationMenuOpen && openMessageMenuId === null) return
    function closeMenuOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Element)) return
      if (!event.target.closest('.chat-conversation-actions')) setConversationMenuOpen(false)
      if (!event.target.closest('.chat-message-actions, .chat-message-menu')) setOpenMessageMenuId(null)
    }
    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setConversationMenuOpen(false)
        setOpenMessageMenuId(null)
      }
    }
    function closeMessageMenu() {
      setOpenMessageMenuId(null)
    }
    document.addEventListener('pointerdown', closeMenuOnOutsideClick)
    document.addEventListener('keydown', closeMenuOnEscape)
    document.addEventListener('scroll', closeMessageMenu, true)
    window.addEventListener('resize', closeMessageMenu)
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsideClick)
      document.removeEventListener('keydown', closeMenuOnEscape)
      document.removeEventListener('scroll', closeMessageMenu, true)
      window.removeEventListener('resize', closeMessageMenu)
    }
  }, [conversationMenuOpen, openMessageMenuId])

  function toggleMessageMenu(messageId: number, event: MouseEvent<HTMLButtonElement>) {
    if (openMessageMenuId === messageId) {
      setOpenMessageMenuId(null)
      return
    }
    const trigger = event.currentTarget.getBoundingClientRect()
    const menuWidth = Math.min(205, window.innerWidth - 16)
    const menuHeight = 100
    const top = window.innerHeight - trigger.bottom >= menuHeight + 8
      ? trigger.bottom + 6
      : Math.max(8, trigger.top - menuHeight - 6)
    const left = Math.max(8, Math.min(trigger.left, window.innerWidth - menuWidth - 8))
    setMessageMenuPosition({ top, left })
    setOpenMessageMenuId(messageId)
  }

  useEffect(() => {
    const token = window.localStorage.getItem('innovcom-token')
    if (!token) return
    const socket = io({ auth: { token } })
    socketRef.current = socket
    socket.on('connect_error', () => {
      setSocketConnected(false)
      setError('Connexion au chat interrompue. Vérifiez que le serveur est démarré.')
    })
    socket.on('connect', () => {
      setSocketConnected(true)
      setError('')
    })
    socket.on('disconnect', () => {
      setSocketConnected(false)
      if (voiceCallRef.current) {
        closeVoiceConnection()
        updateVoiceCall(null)
        setError('L’appel vocal a été interrompu avec la connexion au chat.')
      }
    })
    socket.on('voice-call:incoming', (event: {
      callId: string;
      conversationId: number;
      callerId: number;
      callerName: string;
    }) => {
      if (voiceCallRef.current) {
        socket.emit('voice-call:decline', { callId: event.callId })
        return
      }
      updateVoiceCall({
        callId: event.callId,
        conversationId: event.conversationId,
        peerName: event.callerName,
        direction: 'incoming',
        status: 'incoming',
      })
    })
    socket.on('voice-call:accepted', (event: { callId: string }) => {
      const current = voiceCallRef.current
      if (!current || current.callId !== event.callId || current.direction !== 'outgoing') return
      updateVoiceCall({ ...current, status: 'connecting' })
      void beginOutgoingVoiceConnection(event.callId)
    })
    socket.on('voice-call:signal', (signal: {
      callId: string;
      type: 'offer' | 'answer' | 'ice';
      sdp?: string;
      candidate?: RTCIceCandidateInit;
    }) => { void handleVoiceSignal(signal) })
    socket.on('voice-call:ended', (event: { callId: string; reason: string }) => {
      const current = voiceCallRef.current
      if (!current || current.callId !== event.callId) return
      closeVoiceConnection()
      updateVoiceCall(null)
      if (event.reason === 'timeout') setError('L’agent n’a pas répondu à l’appel.')
      else if (event.reason === 'declined') setError('L’agent a refusé l’appel.')
      else if (event.reason === 'disconnected') setError('L’appel a été interrompu car un participant s’est déconnecté.')
    })
    socket.on('voice-call:history-error', (event: { conversationId: number; message: string }) => {
      if (activeIdRef.current === event.conversationId) setError(event.message)
    })
    socket.on('message:new', (message: ChatMessage) => {
      if (!conversationsRef.current.some((conversation) => conversation.id === message.conversationId)) {
        void api.communityChatConversations().then(setConversations).catch((caught) => {
          setError(caught instanceof Error ? caught.message : 'Impossible d’actualiser les conversations.')
        })
      }
      setConversations((current) => current.map((conversation) => conversation.id === message.conversationId
        ? { ...conversation, lastMessage: message, unreadCount: activeIdRef.current === message.conversationId ? 0 : conversation.unreadCount + 1, updatedAt: message.createdAt, archivedAt: null }
        : conversation).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)))
      if (activeIdRef.current === message.conversationId) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
        void api.markCommunityChatRead(message.conversationId).catch((caught) => {
          setError(caught instanceof Error ? caught.message : 'Impossible de marquer le message comme lu.')
        })
      }
    })
    socket.on('conversation:archive-changed', (event: { conversationId: number; archivedAt: string | null }) => {
      setConversations((current) => current.map((conversation) => conversation.id === event.conversationId
        ? { ...conversation, archivedAt: event.archivedAt }
        : conversation))
    })
    socket.on('conversation:deleted', (event: { conversationId: number }) => {
      setConversations((current) => current.filter((conversation) => conversation.id !== event.conversationId))
      setMessages((current) => current.filter((message) => message.conversationId !== event.conversationId))
      if (activeIdRef.current === event.conversationId) {
        activeIdRef.current = null
        setActiveId(null)
      }
    })
    socket.on('message:deleted', (event: {
      conversationId: number
      messageId: number
      deletedMessage: ChatMessage
      lastMessage: ChatMessage | null
      updatedAt: string
      unreadCount: number
    }) => {
      setMessages((current) => current.map((message) => message.id === event.messageId ? event.deletedMessage : message))
      setOpenMessageMenuId((current) => current === event.messageId ? null : current)
      setConversations((current) => current.map((conversation) => conversation.id === event.conversationId
        ? {
          ...conversation,
          lastMessage: conversation.lastMessage?.id === event.messageId ? event.lastMessage : conversation.lastMessage,
          updatedAt: event.updatedAt,
          unreadCount: event.unreadCount,
        }
        : conversation).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)))
    })
    socket.on('message:hidden', (event: {
      conversationId: number
      messageId: number
      lastMessage: ChatMessage | null
      unreadCount: number
    }) => {
      setMessages((current) => current.filter((message) => message.id !== event.messageId))
      setOpenMessageMenuId((current) => current === event.messageId ? null : current)
      setConversations((current) => current.map((conversation) => conversation.id === event.conversationId
        ? {
          ...conversation,
          lastMessage: conversation.lastMessage?.id === event.messageId ? event.lastMessage : conversation.lastMessage,
          unreadCount: event.unreadCount,
        }
        : conversation))
    })
    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [currentUserId])

  useEffect(() => {
    activeIdRef.current = activeId
    if (activeId === null) return
    let active = true
    api.communityChatMessages(activeId)
      .then((data) => {
        if (!active) return
        setMessages(data)
        setConversations((current) => current.map((item) => item.id === activeId ? { ...item, unreadCount: 0 } : item))
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Impossible de charger les messages.') })
    return () => { active = false }
  }, [activeId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, activeId])

  async function openAgent(agentId: number) {
    setError('')
    try {
      const conversationId = await api.startCommunityChat(agentId)
      setConversations(await api.communityChatConversations())
      setActiveId(conversationId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de démarrer la conversation.')
    }
  }

  async function toggleActiveConversationArchive() {
    if (!activeConversation || conversationActionBusy) return
    setConversationActionBusy(true)
    setError('')
    try {
      const archivedAt = await api.setCommunityChatArchived(activeConversation.id, !activeConversation.archivedAt)
      setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
        ? { ...conversation, archivedAt }
        : conversation))
      if (!archivedAt && conversationFilter === 'archived') setConversationFilter('all')
      setConversationMenuOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de modifier l’archivage.')
    } finally {
      setConversationActionBusy(false)
    }
  }

  async function deleteActiveConversation() {
    if (!activeConversation || conversationActionBusy) return
    const confirmation = 'Retirer cette conversation et son historique de votre liste ? L’autre agent conservera la conversation.'
    if (!window.confirm(confirmation)) return
    setConversationActionBusy(true)
    setError('')
    try {
      await api.deleteCommunityChatConversation(activeConversation.id)
      setConversations((current) => current.filter((conversation) => conversation.id !== activeConversation.id))
      setMessages((current) => current.filter((message) => message.conversationId !== activeConversation.id))
      activeIdRef.current = null
      setActiveId(null)
      setConversationMenuOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de supprimer la conversation.')
    } finally {
      setConversationActionBusy(false)
    }
  }

  async function deleteMessageForEveryone(message: ChatMessage) {
    if (!activeConversation || message.senderId !== currentUserId || conversationActionBusy) return
    if (!window.confirm(`Supprimer uniquement ce message pour tout le monde ? Cette action est définitive.\n\n« ${message.content} »`)) return
    setConversationActionBusy(true)
    setError('')
    try {
      const result = await api.deleteCommunityChatMessage(activeConversation.id, message.id)
      setMessages((current) => current.map((item) => item.id === message.id ? result.deletedMessage : item))
      setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
        ? {
          ...conversation,
          lastMessage: conversation.lastMessage?.id === message.id ? result.lastMessage : conversation.lastMessage,
          updatedAt: result.updatedAt,
          unreadCount: result.unreadCount,
        }
        : conversation).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)))
      setOpenMessageMenuId(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de supprimer le message.')
    } finally {
      setConversationActionBusy(false)
    }
  }

  async function deleteMessageForMe(message: ChatMessage) {
    if (!activeConversation || conversationActionBusy) return
    if (!window.confirm('Retirer ce message de votre affichage uniquement ? Il restera visible pour l’autre participant.')) return
    setConversationActionBusy(true)
    setError('')
    try {
      const result = await api.hideCommunityChatMessage(activeConversation.id, message.id)
      setMessages((current) => current.filter((item) => item.id !== message.id))
      setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
        ? {
          ...conversation,
          lastMessage: conversation.lastMessage?.id === message.id ? result.lastMessage : conversation.lastMessage,
          unreadCount: result.unreadCount,
        }
        : conversation))
      setOpenMessageMenuId(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de supprimer le message pour vous.')
    } finally {
      setConversationActionBusy(false)
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (activeId === null || sending) return
    if (attachment) {
      setSending(true)
      setError('')
      try {
        const message = await api.sendCommunityChatMedia(activeId, attachment, draft.trim())
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
        setConversations((current) => current.map((item) => item.id === activeId
          ? { ...item, lastMessage: message, updatedAt: message.createdAt, archivedAt: null }
          : item).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)))
        setDraft('')
        setAttachment(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Impossible d’envoyer le média.')
      } finally {
        setSending(false)
      }
      return
    }
    const content = draft.trim()
    if (!content) return
    const socket = socketRef.current
    if (!socket?.connected) {
      setError('Le chat est déconnecté. Patientez quelques secondes puis réessayez.')
      return
    }
    setSending(true)
    setError('')
    socket.timeout(10000).emit('message:send', { conversationId: activeId, content }, (timeoutError: Error, result: { data?: ChatMessage; error?: string }) => {
      setSending(false)
      if (timeoutError) {
        setError('Le serveur ne confirme pas l’envoi. Vérifiez la connexion avant de réessayer.')
        return
      }
      const message = result.data
      if (result.error || !message) {
        setError(result.error ?? 'Impossible d’envoyer le message.')
        return
      }
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
      setConversations((current) => current.map((item) => item.id === activeId
        ? { ...item, lastMessage: message, updatedAt: message.createdAt, archivedAt: null }
        : item).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)))
      setDraft('')
      setAttachment(null)
    })
  }

  async function selectChatMedia(file: File | undefined) {
    if (!file) return
    const image = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    const video = ['video/mp4', 'video/webm'].includes(file.type)
    const audio = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/flac'].includes(file.type.split(';', 1)[0].toLowerCase())
    if (!image && !video && !audio) {
      setError('Choisissez une image, une vidéo ou un fichier audio pris en charge.')
      setAttachment(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > (image ? 5 : 25) * 1024 * 1024) {
      setError(image ? 'L’image ne doit pas dépasser 5 Mo.' : 'Le média ne doit pas dépasser 25 Mo.')
      setAttachment(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (audio) {
      try {
        const duration = await audioDuration(file)
        if (!Number.isFinite(duration) || duration <= 0 || duration > 300) {
          setError('Un message vocal ne peut pas dépasser 5 minutes.')
          setAttachment(null)
          if (fileInputRef.current) fileInputRef.current.value = ''
          return
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Impossible de lire ce fichier audio.')
        setAttachment(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
    }
    setError('')
    setAttachment(file)
  }

  async function startVoiceRecording() {
    if (startingRecording || recording) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Votre navigateur ne permet pas l’enregistrement vocal. Vous pouvez joindre un fichier audio.')
      return
    }
    setStartingRecording(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      recordingStreamRef.current = stream
      const supportedTypes = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
      const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recordingChunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      recordingConversationIdRef.current = activeId
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        if (recordingTimerRef.current !== null) {
          window.clearInterval(recordingTimerRef.current)
          recordingTimerRef.current = null
        }
        const recordedType = recorder.mimeType || recordingChunksRef.current[0]?.type || 'audio/webm'
        const type = recordedType.split(';', 1)[0].toLowerCase()
        const extension = type === 'audio/ogg' ? 'ogg' : type === 'audio/mp4' ? 'm4a' : 'webm'
        const blob = new Blob(recordingChunksRef.current, { type: recordedType })
        const sameConversation = activeIdRef.current === recordingConversationIdRef.current
        if (blob.size && sameConversation && mountedRef.current) {
          setAttachment(new File([blob], `vocal-${Date.now()}.${extension}`, { type: recordedType }))
          setError('')
        } else if (mountedRef.current && !sameConversation) {
          setError('L’enregistrement a été annulé car vous avez changé de conversation.')
        } else if (mountedRef.current) {
          setError('Aucun son n’a été enregistré. Vérifiez le microphone et réessayez.')
        }
        recordingChunksRef.current = []
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
        recordingStreamRef.current = null
        recorderRef.current = null
        recordingConversationIdRef.current = null
        if (mountedRef.current) setRecording(false)
      }
      recorder.start(1000)
      setRecording(true)
      setRecordingSeconds(0)
      setError('')
      recordingTimerRef.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)
        setRecordingSeconds(Math.min(seconds, 300))
        if (seconds >= 300) recorder.stop()
      }, 1000)
    } catch (caught) {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      recorderRef.current = null
      if (mountedRef.current) {
        setError(caught instanceof Error && caught.name === 'NotAllowedError'
          ? 'Autorisez l’accès au microphone pour enregistrer un message vocal.'
          : 'Impossible de démarrer l’enregistrement vocal.')
      }
    } finally {
      if (mountedRef.current) setStartingRecording(false)
    }
  }

  function stopVoiceRecording() {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
  }

  const activeConversation = conversations.find((item) => item.id === activeId) ?? null
  const filteredAgents = agents.filter((agent) => nameOf(agent).toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')))
  const existingAgentIds = new Set(conversations.map((conversation) => conversation.agent.id))
  const visibleConversations = conversations.filter((conversation) => {
    const matchesSearch = nameOf(conversation.agent).toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))
      || (conversation.lastMessage?.content ?? '').toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))
    const matchesFilter = conversationFilter === 'archived'
      ? Boolean(conversation.archivedAt)
      : !conversation.archivedAt && (conversationFilter === 'all' || conversation.unreadCount > 0)
    return matchesSearch && matchesFilter
  })

  return <section className="chat-page">
    <header className="chat-heading">
      <div><span className="section-kicker">ESPACE AGENT</span><h2>Messages privés</h2><p>Échangez directement et en toute confidentialité avec les autres agents.</p></div>
      <span className={socketConnected ? 'chat-live online' : 'chat-live'}><i /> {socketConnected ? 'Chat en direct' : 'Connexion…'}</span>
    </header>
    {error && <p className="form-error chat-error" role="alert">{error}</p>}
    <div className={`chat-workspace ${activeId !== null ? 'conversation-open' : ''}`}>
      <aside className="chat-contacts">
        <div className="chat-mobile-list-header">
          <h2>Discussions</h2>
          <div>
            <button type="button" aria-label="Plus d'options"><MoreHorizontal size={22} /></button>
            <button type="button" aria-label="Afficher en plein écran"><Maximize2 size={19} /></button>
            <button type="button" aria-label="Nouvelle discussion" onClick={() => document.querySelector<HTMLInputElement>('.chat-search input')?.focus()}><SquarePen size={20} /></button>
          </div>
        </div>
        <label className="chat-search"><Search size={18} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un agent" aria-label="Rechercher un agent" /></label>
        <div className="chat-mobile-tabs" aria-label="Filtrer les discussions">
          <button type="button" className={conversationFilter === 'all' ? 'active' : ''} onClick={() => setConversationFilter('all')}>Tout</button>
          <button type="button" className={conversationFilter === 'unread' ? 'active' : ''} onClick={() => setConversationFilter('unread')}>Non lu</button>
          <button type="button" className={conversationFilter === 'archived' ? 'active' : ''} onClick={() => setConversationFilter('archived')}>Archivées</button>
        </div>
        {loading ? <p className="chat-empty">Chargement des conversations…</p> : <>
          <h3 className="chat-list-title">{conversationFilter === 'archived' ? 'Conversations archivées' : 'Conversations'}</h3>
          <div className="chat-contact-list">
            {visibleConversations.map((conversation) => {
              const name = nameOf(conversation.agent)
              return <button type="button" key={conversation.id} className={`chat-contact ${activeId === conversation.id ? 'active' : ''}`} onClick={() => setActiveId(conversation.id)}>
                <span className="chat-avatar" aria-hidden="true">{avatarContent(conversation.agent, name)}</span><span className="chat-contact-copy"><strong><span>{name}</span>{conversation.agent.isSubscriber && <SubscriberBadge />}</strong><small>{conversation.lastMessage?.deletedAt ? 'Message supprimé' : conversation.lastMessage?.content || (conversation.lastMessage?.mediaMimeType?.startsWith('image/') ? 'Image' : conversation.lastMessage?.mediaMimeType?.startsWith('video/') ? 'Vidéo' : conversation.lastMessage?.mediaMimeType?.startsWith('audio/') ? 'Message vocal' : 'Démarrer la conversation')}</small></span>
                {conversation.unreadCount > 0 && <span className="chat-unread">{conversation.unreadCount}</span>}
              </button>
            })}
            {visibleConversations.length === 0 && <p className="chat-empty">{conversationFilter === 'archived' ? 'Aucune conversation archivée.' : conversationFilter === 'unread' ? 'Aucun message non lu.' : 'Vos conversations apparaîtront ici.'}</p>}
          </div>
          <h3 className="chat-list-title chat-agents-title">Agents disponibles</h3>
          <div className="chat-contact-list">
            {filteredAgents.filter((agent) => !existingAgentIds.has(agent.id)).map((agent) => {
              const name = nameOf(agent)
              return <button type="button" key={agent.id} className="chat-contact" onClick={() => void openAgent(agent.id)}>
                <span className="chat-avatar" aria-hidden="true">{avatarContent(agent, name)}</span><span className="chat-contact-copy"><strong><span>{name}</span>{agent.isSubscriber && <SubscriberBadge />}</strong><small>{agent.agentProfile?.city || 'Agent actif'}</small></span><span className="chat-start">＋</span>
              </button>
            })}
            {filteredAgents.filter((agent) => !existingAgentIds.has(agent.id)).length === 0 && <p className="chat-empty">Aucun autre agent à afficher.</p>}
          </div>
        </>}
      </aside>
      <section className="chat-thread" aria-label="Conversation">
        {activeConversation ? <>
          <header className="chat-thread-header">
            <button className="chat-mobile-back" type="button" aria-label="Retour aux conversations" onClick={() => setActiveId(null)}><ArrowLeft size={22} /></button>
            <span className="chat-avatar large" aria-hidden="true">{avatarContent(activeConversation.agent, nameOf(activeConversation.agent))}</span>
            <span className="chat-thread-person"><strong><span>{nameOf(activeConversation.agent)}</span>{activeConversation.agent.isSubscriber && <SubscriberBadge />}</strong><small>Agent Ty sy Nday Business · conversation privée</small></span>
            <div className="chat-thread-actions">
              <button className="chat-tool-button" type="button" aria-label="Démarrer un appel vocal" title={socketConnected ? 'Appeler cet agent' : 'Connexion au chat requise'} onClick={() => void startVoiceCall(activeConversation)} disabled={!socketConnected || Boolean(voiceCall)}><Phone size={20} /></button>
              <div className="chat-conversation-actions">
                <button className="chat-tool-button" type="button" aria-label="Options de conversation" aria-haspopup="menu" aria-expanded={conversationMenuOpen} onClick={() => setConversationMenuOpen((open) => !open)} disabled={conversationActionBusy}><MoreHorizontal size={21} /></button>
                {conversationMenuOpen && <div className="chat-conversation-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void toggleActiveConversationArchive()} disabled={conversationActionBusy}>
                    {activeConversation.archivedAt ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
                    {activeConversation.archivedAt ? 'Désarchiver' : 'Archiver'}
                  </button>
                  <button type="button" role="menuitem" className="danger" onClick={() => void deleteActiveConversation()} disabled={conversationActionBusy}>
                    <Trash2 size={16} aria-hidden="true" /> Supprimer pour moi
                  </button>
                </div>}
              </div>
            </div>
          </header>
          <div className="chat-messages" aria-live="polite">
            {activeMessages.length === 0 && <p className="chat-first-message">Dites bonjour et commencez la conversation 👋</p>}
            {activeMessages.map((message) => <div className={`chat-message-row ${message.senderId === currentUserId ? 'mine' : ''} ${message.mediaMimeType ? 'has-media' : ''}`} key={message.id}>
              <div className="chat-bubble">
                {message.senderId === currentUserId && !message.deletedAt && <div className="chat-message-actions">
                  <button type="button" className="chat-message-menu-trigger" aria-label="Options de ce message" aria-haspopup="menu" aria-expanded={openMessageMenuId === message.id} onClick={(event) => toggleMessageMenu(message.id, event)} disabled={conversationActionBusy}><MoreHorizontal size={17} aria-hidden="true" /></button>
                  {openMessageMenuId === message.id && messageMenuPosition && createPortal(<div className={`chat-message-menu ${document.querySelector('.app-shell.theme-dark') ? 'theme-dark' : ''}`} role="menu" style={messageMenuPosition}>
                    <button type="button" role="menuitem" onClick={() => void deleteMessageForMe(message)} disabled={conversationActionBusy}><Trash2 size={15} aria-hidden="true" /> Supprimer pour moi</button>
                    <button type="button" role="menuitem" className="danger" onClick={() => void deleteMessageForEveryone(message)} disabled={conversationActionBusy}><Trash2 size={15} aria-hidden="true" /> Supprimer pour tout le monde</button>
                  </div>, document.body)}
                </div>}
                {message.deletedAt
                  ? <p className="chat-message-deleted">{message.senderId === currentUserId ? 'Vous avez supprimé ce message' : `${nameOf(activeConversation.agent)} a supprimé ce message`}</p>
                  : <>
                    {message.mediaUrl && <ChatMedia message={message} />}
                    {message.content && <CallLogMessage content={message.content} />}
                  </>}
                <time>{timeOf(message.createdAt)}</time>
              </div>
            </div>)}
            <div ref={endRef} />
          </div>
          {attachment && <div className="chat-attachment-preview">{attachment.type.startsWith('audio/') ? <Mic size={18} /> : <FileText size={18} />}<span><strong>{attachment.name}</strong><small>{Math.max(1, Math.round(attachment.size / 1024))} Ko · {attachment.type.startsWith('audio/') ? 'Audio' : attachment.type.startsWith('image/') ? 'Image' : 'Vidéo'}</small></span><button type="button" aria-label="Retirer la pièce jointe" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = '' }}><X size={18} /></button></div>}
          <form className="chat-compose" onSubmit={sendMessage}>
            <input ref={fileInputRef} className="chat-file-input" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/aac,audio/flac" onChange={(event) => void selectChatMedia(event.target.files?.[0])} />
            <button className="chat-tool-button" type="button" aria-label="Joindre une image, vidéo ou audio" title="Joindre une image, vidéo ou fichier audio" disabled={recording || sending} onClick={() => fileInputRef.current?.click()}><Paperclip size={21} /></button>
            <button className={`chat-tool-button chat-voice-button ${recording ? 'recording' : ''}`} type="button" aria-label={recording ? 'Arrêter le message vocal' : 'Enregistrer un message vocal'} title={recording ? 'Arrêter l’enregistrement' : startingRecording ? 'Demande d’accès au microphone…' : 'Enregistrer un message vocal'} disabled={sending || startingRecording || (!!attachment && !recording)} onClick={() => recording ? stopVoiceRecording() : void startVoiceRecording()}>{recording ? <Square size={19} /> : <Mic size={21} />}</button>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} disabled={recording} maxLength={2000} placeholder={attachment ? 'Ajouter une légende…' : recording ? 'Enregistrement vocal…' : 'Écrire un message privé…'} aria-label={attachment ? 'Ajouter une légende au média' : 'Écrire un message privé'} />
            <button className="chat-send-button" type="submit" disabled={(!draft.trim() && !attachment) || sending || recording} aria-label={attachment ? 'Envoyer le média' : 'Envoyer le message'}>{sending ? '…' : <Send size={19} />}</button>
          </form>
          {startingRecording && <p className="chat-recording-status requesting" role="status" aria-live="polite"><i /> Autorisez l’accès au microphone dans la fenêtre du navigateur…</p>}
          {recording && <p className="chat-recording-status" role="status" aria-live="polite"><i /> Enregistrement vocal · {formatDuration(recordingSeconds)} / 05:00</p>}
          <p className="chat-privacy-note"><ShieldCheck size={14} /> Vos messages sont visibles uniquement par les participants.</p>
        </> : <div className="chat-welcome"><div className="chat-welcome-icon"><MessageCircle size={28} /></div><h3>Votre espace de discussion</h3><p>Sélectionnez une conversation ou choisissez un agent pour lui écrire.</p></div>}
      </section>
    </div>
    {voiceCall && <div className="chat-call-backdrop">
      <section className="chat-call-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-call-title">
        <span className="chat-call-avatar"><PhoneCall size={26} /></span>
        <h2 id="chat-call-title">{voiceCall.status === 'incoming' ? 'Appel vocal entrant' : voiceCall.status === 'outgoing' ? 'Appel en cours…' : voiceCall.status === 'connecting' ? 'Connexion audio…' : 'Appel vocal'}</h2>
        <p className="chat-call-peer">{voiceCall.peerName}</p>
        <p className="chat-call-status" role="status" aria-live="polite">
          {voiceCall.status === 'incoming' ? 'souhaite vous parler' : voiceCall.status === 'outgoing' ? 'Tonalité d’attente · réponse attendue pendant 30 secondes' : voiceCall.status === 'connecting' ? 'Établissement de la connexion audio…' : `Connecté · ${formatDuration(callSeconds)}`}
        </p>
        {ringtoneBlocked && (voiceCall.status === 'incoming' || voiceCall.status === 'outgoing') && <button className="chat-call-enable-sound" type="button" onClick={() => void startRingtone()}>Activer la sonnerie</button>}
        <audio ref={remoteAudioRef} className="chat-call-audio" autoPlay playsInline controls aria-label="Audio de l’appel" />
        <div className="chat-call-actions">
          {voiceCall.status === 'incoming' && <>
            <button type="button" className="chat-call-decline" onClick={declineVoiceCall}><PhoneOff size={19} /> Refuser</button>
            <button type="button" className="chat-call-accept" onClick={() => void acceptVoiceCall()}><PhoneIncoming size={19} /> Accepter</button>
          </>}
          {voiceCall.status !== 'incoming' && <button type="button" className="chat-call-decline" onClick={finishVoiceCall}>
            <PhoneOff size={19} /> {voiceCall.status === 'outgoing' ? 'Annuler l’appel' : 'Raccrocher'}
          </button>}
        </div>
      </section>
    </div>}
  </section>
}
