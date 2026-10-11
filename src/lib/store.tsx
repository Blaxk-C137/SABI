import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { IntegrityMode } from './course/types'
import {
  defaultSettings,
  ingestBlob,
  listFiles,
  loadSettings,
  putFile,
  removeFile,
  saveSettings,
  type PersistedSettings,
  type StoredFile,
} from './storage'

interface AppState {
  settings: PersistedSettings
  patchSettings: (p: Partial<PersistedSettings>) => void
  files: StoredFile[]
  addFiles: (list: FileList | File[]) => Promise<void>
  deleteFile: (id: string) => Promise<void>
  mode: IntegrityMode
  setMode: (m: IntegrityMode) => void
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
  online: boolean
  ready: boolean
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PersistedSettings>(defaultSettings)
  const [files, setFiles] = useState<StoredFile[]>([])
  const [mode, setMode] = useState<IntegrityMode>('practice')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setSettings(loadSettings())
    listFiles()
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const patchSettings = useCallback((p: Partial<PersistedSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...p }
      saveSettings(next)
      return next
    })
  }, [])

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const arr = Array.from(list)
    for (const f of arr) {
      const stored = await ingestBlob(f)
      await putFile(stored)
    }
    setFiles(await listFiles())
  }, [])

  const deleteFile = useCallback(async (id: string) => {
    await removeFile(id)
    setFiles(await listFiles())
  }, [])

  const value = useMemo<AppState>(
    () => ({
      settings,
      patchSettings,
      files,
      addFiles,
      deleteFile,
      mode,
      setMode,
      theme,
      setTheme,
      online,
      ready,
    }),
    [settings, patchSettings, files, addFiles, deleteFile, mode, theme, online, ready],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppState() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider')
  return ctx
}

