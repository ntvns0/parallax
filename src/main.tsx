import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useDocumentStore } from './core/document-store'
import { App } from './ui/App'
import './styles.css'
import { startClientRuntime } from './runtime/client-runtime'
import { recordPerformance } from './runtime/performance'
import { performanceReport } from './runtime/performance'
import { watchDrivenSketches } from './sketcher/sketch-edits'

const appStartedAt = performance.now()
recordPerformance('app.start', appStartedAt)
void startClientRuntime()
if (new URLSearchParams(window.location.search).has('test')) {
  // Read-only: browser tests act through the interface and only read here, so
  // what they exercise is the application rather than this handle.
  window.__PARALLAX_TEST__ = Object.freeze({
    performanceReport,
    document: () => structuredClone(useDocumentStore.getState().document),
  })
}

// Parameters can change a sketch's dimensions from outside the sketcher; this
// solves those sketches, including any that open out of step with their file.
watchDrivenSketches()

// Start reading IndexedDB before React mounts. hydrate() is idempotent, so the
// StrictMode double-invoke below cannot load the workspace twice.
void useDocumentStore.getState().hydrate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
