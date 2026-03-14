export type GatewayEventFrame = {
  type: 'event'
  event: string
  payload?: unknown
  seq?: number
}

export type GatewayResponseFrame = {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
}

export type GatewayHelloOk = {
  protocol: number
  server?: {
    version?: string
    connId?: string
  }
  auth?: {
    role?: string
    scopes?: string[]
  }
}

export type GatewayAgentRow = {
  id: string
  name?: string
  identity?: {
    name?: string
    avatarUrl?: string
    avatar?: string
    emoji?: string
  }
}

export type AgentsListResult = {
  defaultId?: string
  mainKey?: string
  scope?: string
  agents: GatewayAgentRow[]
}

export type GatewaySessionRow = {
  key: string
  label?: string
  displayName?: string
  updatedAt: number | null
  model?: string
  modelProvider?: string
}

export type SessionsListResult = {
  sessions: GatewaySessionRow[]
}

export type ChatHistoryResult = {
  messages?: Array<unknown>
}

export type ChatEventPayload = {
  runId?: string
  sessionKey?: string
  state: 'delta' | 'final' | 'aborted' | 'error'
  message?: unknown
  errorMessage?: string
}

type GatewayClientOptions = {
  wsUrl: string
  token: string
  onHello?: (hello: GatewayHelloOk) => void
  onEvent?: (event: GatewayEventFrame) => void
  onClose?: (info: { code: number; reason: string; error?: string }) => void
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

type DeviceIdentity = {
  deviceId: string
  publicKey: string
  privateKey: string
}

const DEVICE_IDENTITY_STORAGE_KEY = 'fingoat-openclaw-device-identity-v1'

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function fingerprintPublicKey(publicKey: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(publicKey))
  return bytesToHex(new Uint8Array(digest))
}

async function createDeviceIdentity(): Promise<DeviceIdentity> {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
  return {
    deviceId: await fingerprintPublicKey(publicKey),
    publicKey: bytesToBase64Url(publicKey),
    privateKey: bytesToBase64Url(privateKey),
  }
}

async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    const raw = window.localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DeviceIdentity
      if (parsed.deviceId && parsed.publicKey && parsed.privateKey) {
        return parsed
      }
    }
  } catch {
    // regenerate below
  }

  const created = await createDeviceIdentity()
  window.localStorage.setItem(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify(created))
  return created
}

async function signDevicePayload(privateKeyBase64Url: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(base64UrlToBytes(privateKeyBase64Url)),
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    key,
    toArrayBuffer(new TextEncoder().encode(payload)),
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

function buildDeviceAuthPayload(params: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAtMs: number
  token?: string | null
  nonce: string
}): string {
  return [
    'v2',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token ?? '',
    params.nonce,
  ].join('|')
}

export function parseOpenClawDashboardInput(value: string): {
  dashboardUrl: string
  httpBaseUrl: string
  wsUrl: string
  token: string
} {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Dashboard URL is required')
  }

  const parsed = new URL(trimmed)
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
  const hashParams = new URLSearchParams(hash)
  const token = hashParams.get('token')?.trim()

  if (!token) {
    throw new Error('Dashboard URL is missing #token=...')
  }

  parsed.hash = ''
  parsed.search = ''
  const httpBaseUrl = parsed.toString().replace(/\/$/, '')
  const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${parsed.host}`

  return {
    dashboardUrl: trimmed,
    httpBaseUrl,
    wsUrl,
    token,
  }
}

export function parseAgentSessionKey(sessionKey: string | null | undefined): {
  agentId: string
  rest: string
} | null {
  const raw = String(sessionKey ?? '').trim().toLowerCase()
  if (!raw) {
    return null
  }
  const parts = raw.split(':').filter(Boolean)
  if (parts.length < 3 || parts[0] !== 'agent') {
    return null
  }
  const agentId = parts[1]?.trim()
  const rest = parts.slice(2).join(':')
  if (!agentId || !rest) {
    return null
  }
  return { agentId, rest }
}

export function extractMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return ''
  }
  const entry = message as Record<string, unknown>
  if (typeof entry.text === 'string') {
    return entry.text
  }
  if (typeof entry.content === 'string') {
    return entry.content
  }
  if (Array.isArray(entry.content)) {
    return entry.content
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }
        const block = item as Record<string, unknown>
        if (block.type === 'text' && typeof block.text === 'string') {
          return block.text
        }
        return null
      })
      .filter((value): value is string => Boolean(value))
      .join('\n')
  }
  return ''
}

export class OpenClawGatewayClient {
  private ws: WebSocket | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private connectSent = false
  private connectTimer: number | null = null
  private connectNonce: string | null = null
  private lastConnectError?: string
  private readonly options: GatewayClientOptions

  constructor(options: GatewayClientOptions) {
    this.options = options
  }

  start() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const ws = new WebSocket(this.options.wsUrl)
    this.ws = ws

    ws.addEventListener('open', () => {
      this.queueConnect()
    })

    ws.addEventListener('message', (event) => {
      this.handleMessage(String(event.data ?? ''))
    })

    ws.addEventListener('close', (event) => {
      this.flushPending(new Error(`gateway closed (${event.code}): ${event.reason || 'unknown'}`))
      this.ws = null
      this.options.onClose?.({
        code: event.code,
        reason: event.reason || '',
        error: this.lastConnectError,
      })
    })
  }

  stop() {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.flushPending(new Error('gateway client stopped'))
    this.ws?.close()
    this.ws = null
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('gateway not connected'))
    }

    const id = createRequestId()
    const frame = { type: 'req', id, method, params }
    const pending = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
    })
    this.ws.send(JSON.stringify(frame))
    return pending
  }

  private queueConnect() {
    this.connectNonce = null
    this.connectSent = false
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer)
    }
    this.connectTimer = window.setTimeout(() => {
      void this.sendConnect()
    }, 250)
  }

  private async sendConnect() {
    if (this.connectSent) {
      return
    }
    this.connectSent = true
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer)
      this.connectTimer = null
    }

    let device:
      | {
          id: string
          publicKey: string
          signature: string
          signedAt: number
          nonce: string
        }
      | undefined

    if (typeof crypto !== 'undefined' && crypto.subtle && this.connectNonce) {
      const identity = await loadOrCreateDeviceIdentity()
      const signedAtMs = Date.now()
      const payload = buildDeviceAuthPayload({
        deviceId: identity.deviceId,
        clientId: 'openclaw-control-ui',
        clientMode: 'webchat',
        role: 'operator',
        scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'],
        signedAtMs,
        token: this.options.token,
        nonce: this.connectNonce,
      })
      const signature = await signDevicePayload(identity.privateKey, payload)
      device = {
        id: identity.deviceId,
        publicKey: identity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce: this.connectNonce,
      }
    }

    const hello = await this.request<GatewayHelloOk>('connect', {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui',
        version: 'fingoat-openclaw',
        platform: navigator.platform ?? 'web',
        mode: 'webchat',
      },
      role: 'operator',
      scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'],
      caps: ['tool-events'],
      device,
      auth: {
        token: this.options.token,
      },
      userAgent: navigator.userAgent,
      locale: navigator.language,
    })

    this.lastConnectError = undefined
    this.options.onHello?.(hello)
  }

  private handleMessage(raw: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }

    const frame = parsed as { type?: string }
    if (frame.type === 'event') {
      const event = parsed as GatewayEventFrame
      if (event.event === 'connect.challenge') {
        const payload = event.payload as { nonce?: unknown } | undefined
        this.connectNonce = typeof payload?.nonce === 'string' ? payload.nonce : null
        void this.sendConnect().catch((error) => {
          this.lastConnectError = String(error)
          this.ws?.close(4008, 'connect failed')
        })
        return
      }
      this.options.onEvent?.(event)
      return
    }

    if (frame.type === 'res') {
      const response = parsed as GatewayResponseFrame
      const request = this.pending.get(response.id)
      if (!request) {
        return
      }
      this.pending.delete(response.id)
      if (response.ok) {
        request.resolve(response.payload)
      } else {
        const message = response.error?.message || response.error?.code || 'request failed'
        request.reject(new Error(message))
      }
    }
  }

  private flushPending(error: Error) {
    for (const [, pending] of this.pending) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
