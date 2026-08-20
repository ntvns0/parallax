import { migrateStoredDocument, parseStoredDocument } from './document-migration'
import type { CadDocument } from './model'

/**
 * Project persistence.
 *
 * Projects live in IndexedDB rather than localStorage: a parametric document
 * with a few sketches serializes to hundreds of kilobytes, recovery snapshots
 * multiply that, and localStorage's ~5 MB ceiling is a data-loss cliff rather
 * than a limit users can see coming. IndexedDB is also asynchronous, which
 * keeps large saves off the main thread.
 */

const DATABASE_NAME = 'parallax'
const DATABASE_VERSION = 1
const DOCUMENTS_STORE = 'documents'
const RECOVERY_STORE = 'recovery'
const WORKSPACE_STORE = 'workspace'
const WORKSPACE_KEY = 'index'

export type ProjectSummary = {
  id: string
  name: string
  updatedAt: string
}

export type RecoverySnapshot = {
  id: string
  savedAt: string
  document: CadDocument
}

export type WorkspaceIndex = {
  schemaVersion: 1
  activeDocumentId: string
  projects: ProjectSummary[]
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not provide IndexedDB, so projects cannot be saved.'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      for (const store of [DOCUMENTS_STORE, RECOVERY_STORE, WORKSPACE_STORE]) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Browser storage could not be opened.'))
    request.onblocked = () => reject(new Error('Another Parallax tab is upgrading local storage. Close it and reload.'))
  })
  return databasePromise
}

/**
 * Run one request and resolve when its transaction *completes*, not when the
 * request succeeds. Only completion means the write reached disk.
 */
async function runRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = operation(transaction.objectStore(storeName))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('Browser storage rejected the request.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage aborted the request.'))
  })
}

export async function readDocument(id: string): Promise<CadDocument | null> {
  const stored = await runRequest<unknown>(DOCUMENTS_STORE, 'readonly', (store) => store.get(id))
  return migrateStoredDocument(stored)
}

export async function writeDocument(document: CadDocument): Promise<void> {
  await runRequest(DOCUMENTS_STORE, 'readwrite', (store) => store.put(document, document.id))
}

export async function removeDocument(id: string): Promise<void> {
  await runRequest(DOCUMENTS_STORE, 'readwrite', (store) => store.delete(id))
  await runRequest(RECOVERY_STORE, 'readwrite', (store) => store.delete(id))
}

export async function readRecoverySnapshots(id: string): Promise<RecoverySnapshot[]> {
  const stored = await runRequest<unknown>(RECOVERY_STORE, 'readonly', (store) => store.get(id))
  if (!Array.isArray(stored)) return []
  return stored.filter((snapshot): snapshot is RecoverySnapshot => snapshot?.document?.id === id)
}

export async function writeRecoverySnapshots(id: string, snapshots: RecoverySnapshot[]): Promise<void> {
  await runRequest(RECOVERY_STORE, 'readwrite', (store) => store.put(snapshots, id))
}

export async function readWorkspace(): Promise<WorkspaceIndex | null> {
  const stored = await runRequest<unknown>(WORKSPACE_STORE, 'readonly', (store) => store.get(WORKSPACE_KEY))
  const workspace = stored as WorkspaceIndex | undefined
  if (!workspace || workspace.schemaVersion !== 1 || !Array.isArray(workspace.projects)) return null
  return workspace
}

export async function writeWorkspace(workspace: WorkspaceIndex): Promise<void> {
  await runRequest(WORKSPACE_STORE, 'readwrite', (store) => store.put(workspace, WORKSPACE_KEY))
}

const LEGACY_SINGLE_DOCUMENT_KEY = 'parallax.document.v1'
const LEGACY_WORKSPACE_KEY = 'parallax.workspace.v1'
const LEGACY_DOCUMENT_PREFIX = 'parallax.document.v2.'
const LEGACY_RECOVERY_PREFIX = 'parallax.recovery.v1.'
const LEGACY_MIGRATED_KEY = 'parallax.storage.migrated-to-indexeddb'

export type LegacyMigrationResult = {
  migratedProjects: number
  migratedSnapshots: number
}

/**
 * Move any localStorage-era projects into IndexedDB, once.
 *
 * Legacy records are only removed after every write has committed, so an
 * interrupted migration leaves the originals in place and simply runs again on
 * the next load.
 */
export async function migrateLegacyStorage(): Promise<LegacyMigrationResult> {
  const empty = { migratedProjects: 0, migratedSnapshots: 0 }
  if (typeof localStorage === 'undefined' || localStorage.getItem(LEGACY_MIGRATED_KEY)) return empty

  const legacyKeys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key) legacyKeys.push(key)
  }

  const documentKeys = legacyKeys.filter((key) => key.startsWith(LEGACY_DOCUMENT_PREFIX))
  const documents = documentKeys
    .map((key) => parseStoredDocument(localStorage.getItem(key)))
    .filter((document): document is CadDocument => document !== null)

  const single = parseStoredDocument(localStorage.getItem(LEGACY_SINGLE_DOCUMENT_KEY))
  if (single && !documents.some((document) => document.id === single.id)) documents.push(single)

  if (!documents.length) {
    localStorage.setItem(LEGACY_MIGRATED_KEY, new Date().toISOString())
    return empty
  }

  let migratedSnapshots = 0
  for (const document of documents) {
    await writeDocument(document)
    const raw = localStorage.getItem(`${LEGACY_RECOVERY_PREFIX}${document.id}`)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as RecoverySnapshot[]
      const snapshots = Array.isArray(parsed)
        ? parsed.flatMap((snapshot) => {
          const migrated = migrateStoredDocument(snapshot?.document)
          return migrated ? [{ ...snapshot, document: migrated }] : []
        })
        : []
      if (snapshots.length) {
        await writeRecoverySnapshots(document.id, snapshots)
        migratedSnapshots += snapshots.length
      }
    } catch {
      // A corrupt snapshot list must not block the projects themselves.
    }
  }

  const legacyWorkspace = (() => {
    try {
      return JSON.parse(localStorage.getItem(LEGACY_WORKSPACE_KEY) ?? 'null') as WorkspaceIndex | null
    } catch {
      return null
    }
  })()
  const active = documents.find((document) => document.id === legacyWorkspace?.activeDocumentId) ?? documents[0]
  await writeWorkspace({
    schemaVersion: 1,
    activeDocumentId: active.id,
    projects: documents.map((document) => ({ id: document.id, name: document.name || 'Untitled Part', updatedAt: document.updatedAt })),
  })

  // Everything is committed; reclaiming the localStorage quota is now safe.
  for (const key of [...documentKeys, LEGACY_SINGLE_DOCUMENT_KEY, LEGACY_WORKSPACE_KEY]) localStorage.removeItem(key)
  for (const key of legacyKeys.filter((key) => key.startsWith(LEGACY_RECOVERY_PREFIX))) localStorage.removeItem(key)
  localStorage.setItem(LEGACY_MIGRATED_KEY, new Date().toISOString())

  return { migratedProjects: documents.length, migratedSnapshots }
}

/** Test seam: forget the cached connection so a fresh database can be opened. */
export function resetStorageConnection() {
  databasePromise = null
}
