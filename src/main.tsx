import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useDocumentStore } from './core/document-store'
import { App } from './ui/App'
import './styles.css'

// Start reading IndexedDB before React mounts. hydrate() is idempotent, so the
// StrictMode double-invoke below cannot load the workspace twice.
void useDocumentStore.getState().hydrate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
