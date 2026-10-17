import type { CadDocument } from './model'

/**
 * Where the user was in a document: the sketch they had open and the feature
 * they had selected.
 *
 * The document itself is saved to IndexedDB, but this is not part of it, so a
 * reload — a phone discarding a background tab, or the dev server restarting —
 * used to drop the user back at the top of the feature tree with the sketch
 * closed. It is kept in sessionStorage, which survives a reload of the same tab
 * but not closing it: opening the app fresh starts from the tree, as before.
 */
export type EditorSession = {
  documentId: string
  activeSketchId: string | null
  selectedId: string | null
}

const SESSION_KEY = 'parallax:editor-session'

type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>

function browserSessionStorage(): SessionStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    // Some browsers throw on access when storage is disabled.
    return null
  }
}

export function writeEditorSession(session: EditorSession, storage = browserSessionStorage()): void {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Losing the place is an inconvenience; failing an edit over it is not.
  }
}

/**
 * The sketch and selection to reopen in `document`, keeping only ids that
 * still name a feature of the right kind in it.
 */
export function restoreEditorSession(
  document: CadDocument,
  storage = browserSessionStorage(),
): Pick<EditorSession, 'activeSketchId' | 'selectedId'> {
  const none = { activeSketchId: null, selectedId: null }
  let session: Partial<EditorSession>
  try {
    const raw = storage?.getItem(SESSION_KEY)
    if (!raw) return none
    session = JSON.parse(raw) as Partial<EditorSession>
  } catch {
    return none
  }
  if (!session || session.documentId !== document.id) return none

  const feature = (id: unknown) => (typeof id === 'string' ? document.features.find((item) => item.id === id) : undefined)
  const sketch = feature(session.activeSketchId)
  const selected = feature(session.selectedId)
  return {
    activeSketchId: sketch?.kind === 'sketch' ? sketch.id : null,
    selectedId: selected?.id ?? null,
  }
}
