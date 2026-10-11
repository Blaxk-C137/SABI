import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

const ToastCtx = createContext<(msg: string) => void>(() => {})

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const show = useCallback((m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(null), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 border border-border bg-elevated px-4 py-2 text-sm shadow-lg"
        >
          {msg}
        </div>
      ) : null}
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

