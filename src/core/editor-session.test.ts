import { describe, expect, it } from 'vitest'
import { restoreEditorSession, writeEditorSession } from './editor-session'
import { createEmptyDocument, createFeature } from './model'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

function documentWithSketchAndBox() {
  const document = createEmptyDocument()
  const sketch = createFeature('sketch', 1)
  const box = createFeature('box', 1)
  document.features.push(sketch, box)
  return { document, sketch, box }
}

describe('editor session', () => {
  it('reopens the sketch and selection saved for the same document', () => {
    const { document, sketch, box } = documentWithSketchAndBox()
    const storage = memoryStorage()
    writeEditorSession({ documentId: document.id, activeSketchId: sketch.id, selectedId: box.id }, storage)

    expect(restoreEditorSession(document, storage)).toEqual({ activeSketchId: sketch.id, selectedId: box.id })
  })

  it('ignores a session saved for another document', () => {
    const { document, sketch } = documentWithSketchAndBox()
    const storage = memoryStorage()
    writeEditorSession({ documentId: 'other', activeSketchId: sketch.id, selectedId: sketch.id }, storage)

    expect(restoreEditorSession(document, storage)).toEqual({ activeSketchId: null, selectedId: null })
  })

  it('drops ids that no longer name a feature, and never opens a non-sketch', () => {
    const { document, box } = documentWithSketchAndBox()
    const storage = memoryStorage()
    writeEditorSession({ documentId: document.id, activeSketchId: box.id, selectedId: 'deleted' }, storage)

    expect(restoreEditorSession(document, storage)).toEqual({ activeSketchId: null, selectedId: null })
  })

  it('starts fresh when nothing or something unreadable was stored', () => {
    const { document } = documentWithSketchAndBox()
    const storage = memoryStorage()
    expect(restoreEditorSession(document, storage)).toEqual({ activeSketchId: null, selectedId: null })

    storage.setItem('parallax:editor-session', '{not json')
    expect(restoreEditorSession(document, storage)).toEqual({ activeSketchId: null, selectedId: null })
    expect(restoreEditorSession(document, null)).toEqual({ activeSketchId: null, selectedId: null })
  })
})
