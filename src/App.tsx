import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppStateProvider } from '@/lib/store'
import { ToastHost } from '@/components/ui/toast'
import { Studio } from '@/pages/Studio'
import { Library } from '@/pages/Library'
import { AssessmentPage } from '@/pages/Assessment'

export default function App() {
  return (
    <AppStateProvider>
      <ToastHost>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Studio />} />
            <Route path="/library" element={<Library />} />
            <Route path="/assess" element={<AssessmentPage />} />
            <Route path="/app" element={<Navigate to="/" replace />} />
            <Route path="/app/*" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastHost>
    </AppStateProvider>
  )
}

