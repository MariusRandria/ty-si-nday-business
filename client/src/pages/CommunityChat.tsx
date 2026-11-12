import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { io, type Socket } from 'socket.io-client'
import api, { type ChatAgent, type ChatConversation, type ChatMessage, type CommunityAuthor } from '../api/client'
import { useI18n } from '../i18n'
import { Archive, ArchiveRestore, ArrowLeft, AudioLines, Check, CheckCheck, CircleCheck, FileText, Maximize2, MessageCircle, Mic, MicOff, MoreHorizontal, Paperclip, Pause, Phone, PhoneCall, PhoneOff, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, Search, Send, ShieldCheck, Square, SquarePen, Trash2, Video, VideoOff, X } from 'lucide-react'
import { SubscriberBadge } from '../components/ui/SubscriberBadge'
import { AgentPresenceDot, AgentPresenceStatus } from '../components/ui/AgentPresence'
import { useAgentPresence } from '../components/ui/AgentPresenceContext'

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

function timeOf(value: string, language: 'fr' | 'en') {
  return new Date(value).toLocaleTimeString(language === 'en' ? 'en-US' : 'fr-FR', { hour: '2-digit', minute: '2-digit' })
}

type VoiceCallState = {
  callId: string;
  conversationId: number;
  peerName: string;
  callType: 'audio' | 'video';
  direction: 'incoming' | 'outgoing';
  status: 'incoming' | 'outgoing' | 'connecting' | 'active';
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function callLog(content: string) {
  const callType = content.startsWith('Appel vidéo ') ? 'video' as const : 'audio' as const
  const callLabel = callType === 'video' ? 'Appel vidéo' : 'Appel'
  if (content.startsWith(`${callLabel} passé · `)) return { label: content, category: 'completed' as const, callType }
  const statuses = [
    ['manqué', 'missed'],
    ['refusé', 'declined'],
    ['annulé', 'cancelled'],
    ['interrompu', 'interrupted'],
  ] as const
  const status = statuses.find(([label]) => content === `${callLabel} ${label}`)
  return status ? { label: content, category: status[1], callType } : null
}

function CallLogMessage({ content }: { content: string }) {
  const { t, language } = useI18n()
  const entry = callLog(content)
  if (!entry) return <p>{content}</p>
  const Icon = entry.callType === 'video'
    ? entry.category === 'completed' ? Video : VideoOff
    : entry.category === 'missed' ? PhoneMissed
      : entry.category === 'completed' ? PhoneOutgoing
        : entry.category === 'declined' || entry.category === 'cancelled' ? PhoneOff : PhoneCall
  const label = entry.category === 'completed' && language === 'en'
    ? entry.callType === 'video'
      ? entry.label.replace('Appel vidéo passé · ', 'Video call · ')
      : entry.label.replace('Appel passé · ', 'Call placed · ')
    : entry.callType === 'video' ? t(entry.label)
      : entry.category === 'missed' ? t('Appel manqué')
        : entry.category === 'declined' ? t('Appel refusé')
          : entry.category === 'cancelled' ? t('Appel annulé')
            : entry.category === 'interrupted' ? t('Appel interrompu') : entry.label
  return <div className={`chat-call-log ${entry.category} ${entry.callType}`}><Icon size={16} aria-hidden="true" /><span>{label}</span></div>
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
  const { t } = useI18n()
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
      aria-label={t(playing ? 'Mettre le message vocal en pause' : 'Lire le message vocal')}
      onClick={() => void togglePlayback()}
    >
      {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
    </button>
    <div className="chat-audio-content">
      <div className="chat-audio-heading">
        <span><AudioLines size={14} aria-hidden="true" /> {t('Message vocal')}</span>
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
        aria-label={t('Position dans le message vocal')}
        disabled={!duration}
        onChange={(event) => seekAudio(Number(event.currentTarget.value))}
      />
      {playbackError && <span className="chat-audio-error" role="alert">{t(playbackError)}</span>}
    </div>
  </div>
}

function ChatMedia({ message }: { message: ChatMessage }) {
  const { t } = useI18n()
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

  if (mediaError) return <p className="chat-media-error" role="alert">{t(mediaError)}</p>
  if (!mediaUrl) return <span className="chat-media-loading">{t('Chargement du média…')}</span>
  if (message.mediaMimeType?.startsWith('audio/')) {
    return <ChatAudioPlayer src={mediaUrl} />
  }
  return message.mediaMimeType?.startsWith('video/')
    ? <video className="chat-video" src={mediaUrl} controls preload="metadata" playsInline aria-label={t('Vidéo envoyée dans le chat')} />
    : <img className="chat-image" src={mediaUrl} alt={t('Image envoyée dans le chat')} loading="lazy" />
}

export default function CommunityChat({ currentUserId, initialConversationId }: { currentUserId: number; initialConversationId?: number }) {
  const { t, language } = useI18n()
  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [agentSearch, setAgentSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
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
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true)
  const [localVideoReady, setLocalVideoReady] = useState(false)
  const [remoteVideoReady, setRemoteVideoReady] = useState(false)
  const [error, setError] = useState(() => window.localStorage.getItem('innovcom-token')
    ? ''
    : 'Votre session a expiré. Reconnectez-vous pour accéder au chat.')
  const socketRef = useRef<Socket | null>(null)
  const activeIdRef = useRef<number | null>(null)
  const conversationsRef = useRef<ChatConversation[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const agentSearchRef = useRef<HTMLInputElement>(null)
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
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const callStartedAtRef = useRef(0)
  const ringtoneContextRef = useRef<AudioContext | null>(null)
  const ringtoneTimerRef = useRef<number | null>(null)
  const activeMessages = messages.filter((message) => message.conversationId === activeId)

  function updateVoiceCall(next: VoiceCallState | null) {
    voiceCallRef.current = next
    setVoiceCall(next)
    if (!next) {
      setCameraEnabled(true)
      setMicrophoneEnabled(true)
      setLocalVideoReady(false)
      setRemoteVideoReady(false)
    }
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
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) {
      remoteVideoRef.current.pause()
      remoteVideoRef.current.srcObject = null
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
      throw new Error(voiceCallRef.current?.callType === 'video'
        ? 'Les appels vidéo ne sont pas pris en charge par ce navigateur.'
        : 'Les appels vocaux ne sont pas pris en charge par ce navigateur.')
    }
    const callType = voiceCallRef.current?.callType ?? 'audio'
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video' ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
        } : false,
      })
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'NotAllowedError') {
        const answering = voiceCallRef.current?.direction === 'incoming'
        throw new Error(callType === 'video'
          ? answering
            ? 'Autorisez l’accès au microphone et à la caméra pour répondre à l’appel vidéo.'
            : 'Autorisez l’accès au microphone et à la caméra pour démarrer l’appel vidéo.'
          : answering ? 'Autorisez l’accès au microphone pour répondre à l’appel.' : 'Autorisez l’accès au microphone pour démarrer l’appel vocal.')
      }
      if (caught instanceof Error && caught.name === 'NotFoundError') {
        throw new Error(callType === 'video' ? 'Aucune caméra ou aucun microphone disponible.' : 'Aucun microphone disponible.')
      }
      throw caught
    }
    if (!mountedRef.current || voiceCallRef.current?.callId !== callId) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error('L’appel a été terminé.')
    }
    closeVoiceConnection()
    localCallStreamRef.current = stream
    if (callType === 'video') {
      setCameraEnabled(true)
      setMicrophoneEnabled(true)
      setLocalVideoReady(true)
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
    }
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    peerConnectionRef.current = peer
    stream.getTracks().forEach((track) => peer.addTrack(track, stream))
    peer.ontrack = (event) => {
      const [remoteStream] = event.streams
      if (!remoteStream) return
      remoteCallStreamRef.current = remoteStream
      if (voiceCallRef.current?.callType === 'video') {
        setRemoteVideoReady(true)
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream
          void remoteVideoRef.current.play().catch(() => {
            setError('Appuyez sur lecture pour activer la vidéo de l’appel.')
          })
        }
      } else if (remoteAudioRef.current) {
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
        setError(voiceCallRef.current?.callType === 'video'
          ? 'La connexion vidéo a échoué. Vérifiez le réseau puis réessayez.'
          : 'La connexion audio a échoué. Vérifiez le réseau puis réessayez.')
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
        if (!answer.sdp) throw new Error(voiceCallRef.current?.callType === 'video'
          ? 'Impossible de créer la réponse vidéo.'
          : 'Impossible de créer la réponse audio.')
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
      setError(caught instanceof Error ? caught.message : voiceCallRef.current?.callType === 'video'
        ? 'Impossible d’établir la connexion vidéo.'
        : 'Impossible d’établir la connexion audio.')
      socketRef.current?.emit('voice-call:end', { callId: signal.callId })
      closeVoiceConnection()
      updateVoiceCall(null)
    }
  }

  async function beginOutgoingVoiceConnection(callId: string) {
    try {
      const peer = await createVoicePeerConnection(callId)
      const offer = await peer.createOffer()
      if (!offer.sdp) throw new Error(voiceCallRef.current?.callType === 'video'
        ? 'Impossible de créer la connexion vidéo.'
        : 'Impossible de créer la connexion audio.')
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
      setError(caught instanceof Error ? caught.message : voiceCallRef.current?.callType === 'video'
        ? 'Impossible de démarrer l’appel vidéo.'
        : 'Impossible de démarrer l’appel vocal.')
      socketRef.current?.emit('voice-call:end', { callId })
      closeVoiceConnection()
      updateVoiceCall(null)
    }
  }

  async function startVoiceCall(conversation: ChatConversation, callType: 'audio' | 'video' = 'audio') {
    const socket = socketRef.current
    if (!socket?.connected || voiceCallRef.current) {
      setError(voiceCallRef.current
        ? callType === 'video' ? 'Un appel est déjà en cours.' : 'Un appel vocal est déjà en cours.'
        : 'Le chat est déconnecté. Réessayez dans quelques instants.')
      return
    }
    setError('')
    socket.timeout(10_000).emit('voice-call:start', { conversationId: conversation.id, callType }, (
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
        callType,
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
        ? call.callType === 'video' ? 'Autorisez l’accès au microphone et à la caméra pour répondre à l’appel vidéo.' : 'Autorisez l’accès au microphone pour répondre à l’appel.'
        : caught instanceof Error && caught.name === 'NotFoundError'
          ? call.callType === 'video' ? 'Aucune caméra ou aucun microphone disponible.' : 'Aucun microphone disponible.'
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

  function toggleCallCamera() {
    const videoTrack = localCallStreamRef.current?.getVideoTracks()[0]
    if (!videoTrack) return
    videoTrack.enabled = !videoTrack.enabled
    setCameraEnabled(videoTrack.enabled)
  }

  function toggleCallMicrophone() {
    const audioTrack = localCallStreamRef.current?.getAudioTracks()[0]
    if (!audioTrack) return
    audioTrack.enabled = !audioTrack.enabled
    setMicrophoneEnabled(audioTrack.enabled)
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
    if (voiceCall?.callType === 'video') {
      if (localVideoRef.current && localCallStreamRef.current) {
        localVideoRef.current.srcObject = localCallStreamRef.current
      }
      if (remoteVideoRef.current && remoteCallStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteCallStreamRef.current
        void remoteVideoRef.current.play().catch(() => {
          setError('Appuyez sur lecture pour activer la vidéo de l’appel.')
        })
      }
    } else if (remoteAudioRef.current && remoteCallStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteCallStreamRef.current
    }
  }, [localVideoReady, remoteVideoReady, voiceCall?.callId, voiceCall?.callType, voiceCall?.status])

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

  useEffect(() => {
    if (!agentPickerOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAgentPickerOpen(false)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    agentSearchRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [agentPickerOpen])

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
        setError('L’appel a été interrompu avec la connexion au chat.')
      }
    })
    socket.on('voice-call:incoming', (event: {
      callId: string;
      conversationId: number;
      callerId: number;
      callerName: string;
      callType?: 'audio' | 'video';
    }) => {
      if (voiceCallRef.current) {
        socket.emit('voice-call:decline', { callId: event.callId })
        return
      }
      updateVoiceCall({
        callId: event.callId,
        conversationId: event.conversationId,
        peerName: event.callerName,
        callType: event.callType === 'video' ? 'video' : 'audio',
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
    socket.on('message:read', (event: { conversationId: number; readerId: number; readAt: string }) => {
      if (!Number.isSafeInteger(event.conversationId) || !Number.isSafeInteger(event.readerId) || typeof event.readAt !== 'string') return
      const readAt = new Date(event.readAt)
      if (!Number.isFinite(readAt.getTime())) return
      const conversation = conversationsRef.current.find((item) => item.id === event.conversationId)
      if (!conversation || conversation.agent.id !== event.readerId) return
      const readAtValue = readAt.toISOString()
      setMessages((current) => current.map((message) => message.conversationId === event.conversationId
        && message.senderId === currentUserId
        && !message.readAt
        ? { ...message, readAt: readAtValue }
        : message))
      setConversations((current) => current.map((item) => item.id === event.conversationId
        && item.lastMessage?.senderId === currentUserId
        && !item.lastMessage.readAt
        ? { ...item, lastMessage: { ...item.lastMessage, readAt: readAtValue } }
        : item))
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
    setAgentPickerOpen(false)
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
    if (!window.confirm(t(confirmation))) return
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
    if (!window.confirm(`${t('Supprimer uniquement ce message pour tout le monde ? Cette action est définitive.')}\n\n« ${message.content} »`)) return
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
    if (!window.confirm(t('Retirer ce message de votre affichage uniquement ? Il restera visible pour l’autre participant.'))) return
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
  const recipientOnline = useAgentPresence(activeConversation?.agent.id ?? 0).isOnline
  const locale = language === 'en' ? 'en' : 'fr'
  const existingAgentIds = new Set(conversations.map((conversation) => conversation.agent.id))
  const filteredAgents = agents.filter((agent) => !existingAgentIds.has(agent.id)
    && nameOf(agent).toLocaleLowerCase(locale).includes(agentSearch.toLocaleLowerCase(locale)))
  const visibleConversations = conversations.filter((conversation) => {
    const matchesSearch = nameOf(conversation.agent).toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale))
      || (conversation.lastMessage?.content ?? '').toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale))
    const matchesFilter = conversationFilter === 'archived'
      ? Boolean(conversation.archivedAt)
      : !conversation.archivedAt && (conversationFilter === 'all' || conversation.unreadCount > 0)
    return matchesSearch && matchesFilter
  })

  return <section className="chat-page">
    <header className="chat-heading">
      <div><span className="section-kicker">{t('ESPACE AGENT')}</span><h2>{t('Messages privés')}</h2><p>{t('Échangez directement et en toute confidentialité avec les autres agents.')}</p></div>
      <span className={socketConnected ? 'chat-live online' : 'chat-live'}><i /> {t(socketConnected ? 'Chat en direct' : 'Connexion…')}</span>
    </header>
    {error && <p className="form-error chat-error" role="alert">{t(error)}</p>}
    <div className={`chat-workspace ${activeId !== null ? 'conversation-open' : ''}`}>
      <aside className="chat-contacts">
        <div className="chat-mobile-list-header">
          <h2>{t('Discussions')}</h2>
          <div>
            <button type="button" aria-label={t('Plus d’options')}><MoreHorizontal size={22} /></button>
            <button type="button" aria-label={t('Afficher en plein écran')}><Maximize2 size={19} /></button>
            <button type="button" aria-label={t('Nouvelle discussion')} onClick={() => { setAgentSearch(''); setAgentPickerOpen(true) }}><SquarePen size={20} /></button>
          </div>
        </div>
        <label className="chat-search"><Search size={18} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Rechercher un agent')} aria-label={t('Rechercher un agent')} /></label>
        <div className="chat-mobile-tabs" aria-label={t('Filtrer les discussions')}>
          <button type="button" className={conversationFilter === 'all' ? 'active' : ''} onClick={() => setConversationFilter('all')}>{t('Tout')}</button>
          <button type="button" className={conversationFilter === 'unread' ? 'active' : ''} onClick={() => setConversationFilter('unread')}>{t('Non lu')}</button>
          <button type="button" className={conversationFilter === 'archived' ? 'active' : ''} onClick={() => setConversationFilter('archived')}>{t('Archivées')}</button>
        </div>
        {loading ? <p className="chat-empty">{t('Chargement des conversations…')}</p> : <>
          <h3 className="chat-list-title">{t(conversationFilter === 'archived' ? 'Conversations archivées' : 'Conversations')}</h3>
          <div className="chat-contact-list">
            {visibleConversations.map((conversation) => {
              const name = nameOf(conversation.agent)
              return <button type="button" key={conversation.id} className={`chat-contact ${activeId === conversation.id ? 'active' : ''}`} onClick={() => setActiveId(conversation.id)}>
                <span className="chat-avatar" aria-hidden="true">{avatarContent(conversation.agent, name)}<AgentPresenceDot userId={conversation.agent.id} lastActiveAt={conversation.agent.lastActiveAt} /></span><span className="chat-contact-copy"><strong><span>{name}</span>{conversation.agent.isSubscriber && <SubscriberBadge />}</strong><small>{conversation.lastMessage?.deletedAt ? t('Message supprimé') : conversation.lastMessage?.content || t(conversation.lastMessage?.mediaMimeType?.startsWith('image/') ? 'Image' : conversation.lastMessage?.mediaMimeType?.startsWith('video/') ? 'Vidéo' : conversation.lastMessage?.mediaMimeType?.startsWith('audio/') ? 'Message vocal' : 'Démarrer la conversation')}</small><AgentPresenceStatus userId={conversation.agent.id} lastActiveAt={conversation.agent.lastActiveAt} /></span>
                {conversation.unreadCount > 0 && <span className="chat-unread">{conversation.unreadCount}</span>}
              </button>
            })}
            {visibleConversations.length === 0 && <p className="chat-empty">{t(conversationFilter === 'archived' ? 'Aucune conversation archivée.' : conversationFilter === 'unread' ? 'Aucun message non lu.' : 'Vos conversations apparaîtront ici.')}</p>}
          </div>
        </>}
      </aside>
      <section className="chat-thread" aria-label={t('Conversation')}>
        {activeConversation ? <>
          <header className="chat-thread-header">
            <button className="chat-mobile-back" type="button" aria-label={t('Retour aux conversations')} onClick={() => setActiveId(null)}><ArrowLeft size={22} /></button>
            <span className="chat-avatar large" aria-hidden="true">{avatarContent(activeConversation.agent, nameOf(activeConversation.agent))}<AgentPresenceDot userId={activeConversation.agent.id} lastActiveAt={activeConversation.agent.lastActiveAt} /></span>
            <span className="chat-thread-person"><strong><span>{nameOf(activeConversation.agent)}</span>{activeConversation.agent.isSubscriber && <SubscriberBadge />}</strong><AgentPresenceStatus userId={activeConversation.agent.id} lastActiveAt={activeConversation.agent.lastActiveAt} /></span>
            <div className="chat-thread-actions">
              <button className="chat-tool-button" type="button" aria-label={t('Démarrer un appel vocal')} title={t(socketConnected ? 'Appeler cet agent' : 'Connexion au chat requise')} onClick={() => void startVoiceCall(activeConversation)} disabled={!socketConnected || Boolean(voiceCall)}><Phone size={20} /></button>
              <button className="chat-tool-button" type="button" aria-label={t('Démarrer un appel vidéo')} title={t(socketConnected ? 'Appeler cet agent en vidéo' : 'Connexion au chat requise')} onClick={() => void startVoiceCall(activeConversation, 'video')} disabled={!socketConnected || Boolean(voiceCall)}><Video size={20} /></button>
              <div className="chat-conversation-actions">
                <button className="chat-tool-button" type="button" aria-label={t('Options de conversation')} aria-haspopup="menu" aria-expanded={conversationMenuOpen} onClick={() => setConversationMenuOpen((open) => !open)} disabled={conversationActionBusy}><MoreHorizontal size={21} /></button>
                {conversationMenuOpen && <div className="chat-conversation-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void toggleActiveConversationArchive()} disabled={conversationActionBusy}>
                    {activeConversation.archivedAt ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
                    {t(activeConversation.archivedAt ? 'Désarchiver' : 'Archiver')}
                  </button>
                  <button type="button" role="menuitem" className="danger" onClick={() => void deleteActiveConversation()} disabled={conversationActionBusy}>
                    <Trash2 size={16} aria-hidden="true" /> {t('Supprimer pour moi')}
                  </button>
                </div>}
              </div>
            </div>
          </header>
          <div className="chat-messages" aria-live="polite">
            {activeMessages.length === 0 && <p className="chat-first-message">{t('Dites bonjour et commencez la conversation 👋')}</p>}
            {activeMessages.map((message) => <div className={`chat-message-row ${message.senderId === currentUserId ? 'mine' : ''} ${message.mediaMimeType ? 'has-media' : ''}`} key={message.id}>
              <div className="chat-bubble">
                {message.senderId === currentUserId && !message.deletedAt && <div className="chat-message-actions">
                  <button type="button" className="chat-message-menu-trigger" aria-label={t('Options de ce message')} aria-haspopup="menu" aria-expanded={openMessageMenuId === message.id} onClick={(event) => toggleMessageMenu(message.id, event)} disabled={conversationActionBusy}><MoreHorizontal size={17} aria-hidden="true" /></button>
                  {openMessageMenuId === message.id && messageMenuPosition && createPortal(<div className={`chat-message-menu ${document.querySelector('.app-shell.theme-dark') ? 'theme-dark' : ''}`} role="menu" style={messageMenuPosition}>
                    <button type="button" role="menuitem" onClick={() => void deleteMessageForMe(message)} disabled={conversationActionBusy}><Trash2 size={15} aria-hidden="true" /> {t('Supprimer pour moi')}</button>
                    <button type="button" role="menuitem" className="danger" onClick={() => void deleteMessageForEveryone(message)} disabled={conversationActionBusy}><Trash2 size={15} aria-hidden="true" /> {t('Supprimer pour tout le monde')}</button>
                  </div>, document.body)}
                </div>}
                {message.deletedAt
                  ? <p className="chat-message-deleted">{message.senderId === currentUserId ? t('Vous avez supprimé ce message') : `${nameOf(activeConversation.agent)} ${t('a supprimé ce message')}`}</p>
                  : <>
                    {message.mediaUrl && <ChatMedia message={message} />}
                    {message.content && <CallLogMessage content={message.content} />}
                  </>}
                <div className="chat-message-meta">
                  <time>{timeOf(message.createdAt, language)}</time>
                  {message.senderId === currentUserId && !message.deletedAt && <span
                    className={`chat-message-status ${message.readAt ? 'is-read' : recipientOnline ? 'is-delivered' : 'is-sent'}`}
                    role="img"
                    aria-label={t(message.readAt ? 'Vu' : recipientOnline ? 'Remis au destinataire' : 'Envoyé')}
                    title={t(message.readAt ? 'Vu' : recipientOnline ? 'Remis au destinataire' : 'Envoyé')}
                  >
                    {message.readAt ? <CircleCheck size={15} aria-hidden="true" /> : recipientOnline ? <CheckCheck size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                  </span>}
                </div>
              </div>
            </div>)}
            <div ref={endRef} />
          </div>
          {attachment && <div className="chat-attachment-preview">{attachment.type.startsWith('audio/') ? <Mic size={18} /> : <FileText size={18} />}<span><strong>{attachment.name}</strong><small>{Math.max(1, Math.round(attachment.size / 1024))} {language === 'en' ? 'KB' : 'Ko'} · {t(attachment.type.startsWith('audio/') ? 'Audio' : attachment.type.startsWith('image/') ? 'Image' : 'Vidéo')}</small></span><button type="button" aria-label={t('Retirer la pièce jointe')} onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = '' }}><X size={18} /></button></div>}
          <form className="chat-compose" onSubmit={sendMessage}>
            <input ref={fileInputRef} className="chat-file-input" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/aac,audio/flac" onChange={(event) => void selectChatMedia(event.target.files?.[0])} />
            <button className="chat-tool-button" type="button" aria-label={t('Joindre une image, vidéo ou audio')} title={t('Joindre une image, vidéo ou fichier audio')} disabled={recording || sending} onClick={() => fileInputRef.current?.click()}><Paperclip size={21} /></button>
            <button className={`chat-tool-button chat-voice-button ${recording ? 'recording' : ''}`} type="button" aria-label={t(recording ? 'Arrêter le message vocal' : 'Enregistrer un message vocal')} title={t(recording ? 'Arrêter l’enregistrement' : startingRecording ? 'Demande d’accès au microphone…' : 'Enregistrer un message vocal')} disabled={sending || startingRecording || (!!attachment && !recording)} onClick={() => recording ? stopVoiceRecording() : void startVoiceRecording()}>{recording ? <Square size={19} /> : <Mic size={21} />}</button>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} disabled={recording} maxLength={2000} placeholder={t(attachment ? 'Ajouter une légende…' : recording ? 'Enregistrement vocal…' : 'Écrire un message privé…')} aria-label={t(attachment ? 'Ajouter une légende au média' : 'Écrire un message privé')} />
            <button className="chat-send-button" type="submit" disabled={(!draft.trim() && !attachment) || sending || recording} aria-label={t(attachment ? 'Envoyer le média' : 'Envoyer le message')}>{sending ? '…' : <Send size={19} />}</button>
          </form>
          {startingRecording && <p className="chat-recording-status requesting" role="status" aria-live="polite"><i /> {t('Autorisez l’accès au microphone dans la fenêtre du navigateur…')}</p>}
          {recording && <p className="chat-recording-status" role="status" aria-live="polite"><i /> {t('Enregistrement vocal')} · {formatDuration(recordingSeconds)} / 05:00</p>}
          <p className="chat-privacy-note"><ShieldCheck size={14} /> {t('Vos messages sont visibles uniquement par les participants.')}</p>
        </> : <div className="chat-welcome"><div className="chat-welcome-icon"><MessageCircle size={28} /></div><h3>{t('Votre espace de discussion')}</h3><p>{t('Sélectionnez une conversation ou choisissez un agent pour lui écrire.')}</p></div>}
      </section>
    </div>
    {agentPickerOpen && <div className="chat-agent-picker-backdrop" onClick={() => setAgentPickerOpen(false)}>
      <section className="chat-agent-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-agent-picker-title" onClick={(event) => event.stopPropagation()}>
        <header className="chat-agent-picker-header">
          <div><p className="section-kicker">{t('Agents disponibles')}</p><h2 id="chat-agent-picker-title">{t('Nouvelle discussion')}</h2></div>
          <button type="button" className="chat-agent-picker-close" aria-label={t('Fermer')} onClick={() => setAgentPickerOpen(false)}><X size={20} /></button>
        </header>
        <label className="chat-agent-picker-search"><Search size={18} aria-hidden="true" /><input ref={agentSearchRef} value={agentSearch} onChange={(event) => setAgentSearch(event.target.value)} placeholder={t('Rechercher un agent')} aria-label={t('Rechercher un agent')} /></label>
        <div className="chat-agent-picker-list">
          {filteredAgents.map((agent) => {
            const name = nameOf(agent)
            return <button type="button" key={agent.id} className="chat-contact" onClick={() => void openAgent(agent.id)}>
              <span className="chat-avatar" aria-hidden="true">{avatarContent(agent, name)}<AgentPresenceDot userId={agent.id} lastActiveAt={agent.lastActiveAt} /></span><span className="chat-contact-copy"><strong><span>{name}</span>{agent.isSubscriber && <SubscriberBadge />}</strong><small>{agent.agentProfile?.city || t('Agent actif')}</small><AgentPresenceStatus userId={agent.id} lastActiveAt={agent.lastActiveAt} /></span><span className="chat-start" aria-hidden="true">＋</span>
            </button>
          })}
          {filteredAgents.length === 0 && <p className="chat-empty">{t('Aucun autre agent à afficher.')}</p>}
        </div>
      </section>
    </div>}
    {voiceCall && <div className="chat-call-backdrop">
      <section className={`chat-call-dialog ${voiceCall.callType === 'video' ? 'is-video' : ''}`} role="dialog" aria-modal="true" aria-labelledby="chat-call-title">
        <span className="chat-call-avatar">{voiceCall.callType === 'video' ? <Video size={26} /> : <PhoneCall size={26} />}</span>
        <h2 id="chat-call-title">{t(voiceCall.status === 'incoming'
          ? voiceCall.callType === 'video' ? 'Appel vidéo entrant' : 'Appel vocal entrant'
          : voiceCall.status === 'outgoing'
            ? voiceCall.callType === 'video' ? 'Appel vidéo en attente…' : 'Appel en cours…'
            : voiceCall.status === 'connecting'
              ? voiceCall.callType === 'video' ? 'Connexion vidéo…' : 'Connexion audio…'
              : voiceCall.callType === 'video' ? 'Appel vidéo' : 'Appel vocal')}</h2>
        <p className="chat-call-peer">{voiceCall.peerName}</p>
        <p className="chat-call-status" role="status" aria-live="polite">
          {t(voiceCall.status === 'incoming'
            ? voiceCall.callType === 'video' ? 'vous appelle en vidéo' : 'souhaite vous parler'
            : voiceCall.status === 'outgoing' ? 'Tonalité d’attente · réponse attendue pendant 30 secondes'
              : voiceCall.status === 'connecting'
                ? voiceCall.callType === 'video' ? 'Établissement de la connexion vidéo…' : 'Établissement de la connexion audio…'
                : 'Connecté')} {voiceCall.status === 'active' ? `· ${formatDuration(callSeconds)}` : ''}
        </p>
        {ringtoneBlocked && (voiceCall.status === 'incoming' || voiceCall.status === 'outgoing') && <button className="chat-call-enable-sound" type="button" onClick={() => void startRingtone()}>{t('Activer la sonnerie')}</button>}
        {voiceCall.callType === 'video'
          ? <div className="chat-call-video-stage">
            <video ref={remoteVideoRef} className="chat-call-remote-video" autoPlay playsInline controls aria-label={t('Vidéo de l’appel')} />
            {!remoteVideoReady && <div className="chat-call-video-placeholder" role="status">
              <Video size={26} aria-hidden="true" />
              <span>{t(voiceCall.status === 'incoming' ? 'Acceptez pour démarrer la vidéo' : 'En attente de la vidéo…')}</span>
            </div>}
            {localVideoReady && <div className="chat-call-local-preview">
              <video ref={localVideoRef} className="chat-call-local-video" autoPlay playsInline muted aria-label={t('Votre aperçu vidéo')} />
              {!cameraEnabled && <span className="chat-call-camera-off"><VideoOff size={16} aria-hidden="true" />{t('Caméra désactivée')}</span>}
            </div>}
          </div>
          : <audio ref={remoteAudioRef} className="chat-call-audio" autoPlay playsInline controls aria-label={t('Audio de l’appel')} />}
        <div className="chat-call-actions">
          {voiceCall.status === 'incoming' && <>
            <button type="button" className="chat-call-decline" onClick={declineVoiceCall}><PhoneOff size={19} /> {t('Refuser')}</button>
            <button type="button" className="chat-call-accept" onClick={() => void acceptVoiceCall()}>{voiceCall.callType === 'video' ? <Video size={19} /> : <PhoneIncoming size={19} />} {t('Accepter')}</button>
          </>}
          {voiceCall.callType === 'video' && voiceCall.status === 'active' && localVideoReady && <button type="button" className="chat-call-camera-toggle" aria-label={t(cameraEnabled ? 'Désactiver la caméra' : 'Activer la caméra')} title={t(cameraEnabled ? 'Désactiver la caméra' : 'Activer la caméra')} onClick={toggleCallCamera}>{cameraEnabled ? <Video size={19} /> : <VideoOff size={19} />}</button>}
          {voiceCall.callType === 'video' && voiceCall.status === 'active' && localVideoReady && <button type="button" className={`chat-call-microphone-toggle ${microphoneEnabled ? '' : 'is-muted'}`} aria-label={t(microphoneEnabled ? 'Couper le microphone' : 'Activer le microphone')} aria-pressed={!microphoneEnabled} title={t(microphoneEnabled ? 'Couper le microphone' : 'Activer le microphone')} onClick={toggleCallMicrophone}>{microphoneEnabled ? <Mic size={19} /> : <MicOff size={19} />}</button>}
          {voiceCall.status !== 'incoming' && <button type="button" className="chat-call-decline" onClick={finishVoiceCall}>
            <PhoneOff size={19} /> {t(voiceCall.status === 'outgoing' ? 'Annuler l’appel' : 'Raccrocher')}
          </button>}
        </div>
      </section>
    </div>}
  </section>
}
