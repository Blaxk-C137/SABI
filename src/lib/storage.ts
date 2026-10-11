import { DEFAULT_CHAT_MODEL, isFreeChatModel } from './gemini/models'

const DB = 'sabi-v1'
const FILES = 'files'
const LS_KEY = 'sabi.settings'

export interface StoredFile {
  id: string
  name: string
  mime: string
  size: number
  base64: string
  addedAt: number
}

export interface PersistedSettings {
  geminiKey: string
  model: string
  /**
   * Which Whisper model to transcribe with. Empty means the backend's default.
   * Deliberately an opaque string: the list of real models lives on the server
   * and arrives via `/api/health`, so there is no second copy to drift.
   */
  asrModel: string
  /** Piper voice id. Empty means automatic, chosen from the accent. */
  ttsVoice: string
  /** Speaking speed, 0.75–1.25. */
  ttsSpeed: number
  /** Retained for saved settings; the server voice is chosen by ttsVoice. */
  voiceName: string
  accent: string
  captions: boolean
  speak: boolean
  setupDone: boolean
  studentName: string
  courseName: string
  notation: string
}

export const defaultSettings: PersistedSettings = {
  geminiKey: '',
  model: DEFAULT_CHAT_MODEL,
  asrModel: '',
  ttsVoice: '',
  ttsSpeed: 1,
  voiceName: '',
  accent: 'en-NG',
  captions: true,
  speak: true,
  setupDone: false,
  studentName: 'Adaeze',
  courseName: 'GET206 Thermodynamics',
  notation: 'ΔU = Q − W',
}

export function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { ...defaultSettings }
    const parsed = { ...defaultSettings, ...JSON.parse(raw) } as PersistedSettings
    if (!isFreeChatModel(parsed.model)) parsed.model = DEFAULT_CHAT_MODEL
    return parsed
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(s: PersistedSettings) {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(FILES)) {
        db.createObjectStore(FILES, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function listFiles(): Promise<StoredFile[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES, 'readonly')
    const req = tx.objectStore(FILES).getAll()
    req.onsuccess = () => {
      const rows = (req.result as StoredFile[]).sort((a, b) => b.addedAt - a.addedAt)
      resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function putFile(file: StoredFile) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILES, 'readwrite')
    tx.objectStore(FILES).put(file)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function removeFile(id: string) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILES, 'readwrite')
    tx.objectStore(FILES).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function blobToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export async function ingestBlob(file: File): Promise<StoredFile> {
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Keep files under 12 MB for this browser harness.')
  }
  const buf = await file.arrayBuffer()
  return {
    id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    mime: file.type || guessMime(file.name),
    size: file.size,
    base64: blobToBase64(buf),
    addedAt: Date.now(),
  }
}

function guessMime(name: string) {
  const n = name.toLowerCase()
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.txt')) return 'text/plain'
  if (n.endsWith('.md')) return 'text/markdown'
  return 'application/octet-stream'
}

