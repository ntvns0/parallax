import { useDocumentStore } from '../core/document-store'

export interface AppCommand {
  id: string
  label: string
  detail: string
  run: () => void
}

/** Commands that need to open part of the shell, rather than only touch the document. */
export type CommandHandlers = {
  onCreateDrawing?: () => void
}

export function getAppCommands(handlers: CommandHandlers = {}): AppCommand[] {
  return [
    {
      id: 'new-part',
      label: 'New part',
      detail: 'Create another local project',
      run: () => useDocumentStore.getState().newDocument(),
    },
    {
      id: 'save-project',
      label: 'Save project',
      detail: 'Save changes now',
      run: () => void useDocumentStore.getState().save(),
    },
    ...(handlers.onCreateDrawing
      ? [{
          id: 'create-drawing',
          label: 'Create drawing',
          detail: 'Dimensioned views on a printable sheet',
          run: handlers.onCreateDrawing,
        }]
      : []),
    {
      id: 'new-sketch',
      label: 'New sketch',
      detail: 'Start a sketch on the XY plane',
      run: () => useDocumentStore.getState().beginSketch(),
    },
    {
      id: 'add-box',
      label: 'Add box',
      detail: 'Create a parametric preview box',
      run: () => useDocumentStore.getState().addFeature('box'),
    },
    {
      id: 'add-cylinder',
      label: 'Add cylinder',
      detail: 'Create a parametric preview cylinder',
      run: () => useDocumentStore.getState().addFeature('cylinder'),
    },
    {
      id: 'add-sphere',
      label: 'Add sphere',
      detail: 'Create a parametric preview sphere',
      run: () => useDocumentStore.getState().addFeature('sphere'),
    },
  ]
}
