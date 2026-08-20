import { cloneDocument, type CadDocument } from './model'
import { areDocumentsStructurallyEqual } from './geometry-signature'
import * as storage from './project-storage'
import type { ProjectSummary, RecoverySnapshot } from './project-storage'

const MAX_RECOVERY_SNAPSHOTS = 12

export function sortProjects(projects: ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function projectSummary(document: CadDocument): ProjectSummary {
  return { id: document.id, name: document.name || 'Untitled Part', updatedAt: document.updatedAt }
}

export function updateProjectList(projects: ProjectSummary[], document: CadDocument): ProjectSummary[] {
  return sortProjects([projectSummary(document), ...projects.filter((project) => project.id !== document.id)])
}

export class ProjectPersistenceService {
  async captureRecoverySnapshot(document: CadDocument): Promise<void> {
    const previous = await storage.readDocument(document.id)
    if (!previous || areDocumentsStructurallyEqual(previous, document)) return

    const snapshots = await storage.readRecoverySnapshots(document.id)
    if (snapshots[0] && areDocumentsStructurallyEqual(snapshots[0].document, previous)) return

    const snapshot: RecoverySnapshot = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      document: cloneDocument(previous),
    }
    await storage.writeRecoverySnapshots(document.id, [snapshot, ...snapshots].slice(0, MAX_RECOVERY_SNAPSHOTS))
  }

  async persistDocument(document: CadDocument, projects: ProjectSummary[], preservePrevious = true): Promise<ProjectSummary[]> {
    if (preservePrevious) {
      await this.captureRecoverySnapshot(document)
    }
    await storage.writeDocument(document)
    const nextProjects = updateProjectList(projects, document)
    await storage.writeWorkspace({ schemaVersion: 1, activeDocumentId: document.id, projects: sortProjects(nextProjects) })
    return nextProjects
  }
}
