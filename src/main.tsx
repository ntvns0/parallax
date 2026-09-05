import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useDocumentStore } from './core/document-store'
import { App } from './ui/App'
import './styles.css'
import { startClientRuntime } from './runtime/client-runtime'
import { recordPerformance } from './runtime/performance'
import { performanceReport } from './runtime/performance'

const appStartedAt = performance.now()
recordPerformance('app.start', appStartedAt)
void startClientRuntime()
if (new URLSearchParams(window.location.search).has('test')) {
  window.__PARALLAX_TEST__ = Object.freeze({ performanceReport })
}

// Start reading IndexedDB before React mounts. hydrate() is idempotent, so the
// StrictMode double-invoke below cannot load the workspace twice.
void useDocumentStore.getState().hydrate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
