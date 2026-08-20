import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach } from 'vitest'
import { resetStorageConnection } from './core/project-storage'

// jsdom has no IndexedDB. Give every test a brand new database and drop the
// cached connection so nothing leaks between them.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetStorageConnection()
  localStorage.clear()
})
