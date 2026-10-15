import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MIGRATABLE_SCHEMA_VERSIONS, parseStoredDocument } from './document-migration'
import { currentPlaneOffset } from './face-anchor'
import { CURRENT_SCHEMA_VERSION, type CadDocument, type Feature } from './model'
import { buildOperationChain, operationChainCacheKey } from '../kernel/operation-chain'

/**
 * One saved document per schema version, all of which must keep opening.
 *
 * Bumping `CURRENT_SCHEMA_VERSION` fails this suite until the new version has a
 * fixture and is listed as migratable — which is the point. A version silently
 * dropping out of the migratable list makes every project saved at it
 * unopenable, and nothing else in the suite would notice.
 *
 * `fixtures/README.md` says where the fixtures come from and how to add one.
 */

const FIXTURES = resolve(process.cwd(), 'src/core/fixtures')
const versions = Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1)

function fixturePath(version: number) {
  return resolve(FIXTURES, `schema-v${version}.parallax.json`)
}

function open(version: number): CadDocument {
  const document = parseStoredDocument(readFileSync(fixturePath(version), 'utf8'))
  if (!document) throw new Error(`The v${version} fixture did not open.`)
  return document
}

function chainKey(document: CadDocument, featureId: string) {
  const feature = document.features.find((candidate) => candidate.id === featureId) as Extract<Feature, { kind: 'extrude' | 'fillet' }>
  return operationChainCacheKey(buildOperationChain(feature, document.features))
}

describe('schema fixtures', () => {
  it('lists every version from 1 to the current one as migratable', () => {
    expect(MIGRATABLE_SCHEMA_VERSIONS).toEqual(versions)
  })

  it.each(versions)('has a saved v%i document', (version) => {
    expect(existsSync(fixturePath(version))).toBe(true)
  })

  it.each(versions)('opens a v%i document at the current schema', (version) => {
    const raw = JSON.parse(readFileSync(fixturePath(version), 'utf8'))
    expect(raw.schemaVersion).toBe(version)
    expect(open(version).schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  // From v4 on, the fixture is the same part saved by successive builds: a
  // plate with a face-attached pocket and a rounded pocket corner. Migration
  // has to arrive at the same solid from every one of them.
  const pocketed = versions.filter((version) => version >= 4)

  it.each(pocketed)('migrates the v%i pocketed plate to the same solid as the current build', (version) => {
    expect(chainKey(open(version), 'fillet-pocket')).toBe(chainKey(open(CURRENT_SCHEMA_VERSION), 'fillet-pocket'))
  })

  it.each(pocketed)('keeps the v%i pocket attached to the plate when the plate gets thicker', (version) => {
    const document = open(version)
    const plate = document.features.find((feature) => feature.id === 'extrude-base') as Extract<Feature, { kind: 'extrude' }>
    const pocketSketch = document.features.find((feature) => feature.id === 'sketch-pocket') as Extract<Feature, { kind: 'sketch' }>
    plate.parameters.distance = 10

    expect(currentPlaneOffset(pocketSketch, document.features)).toBe(10)
  })

  it.each(versions.filter((version) => version < 4))('opens the v%i plate as the same plate the current build makes', (version) => {
    expect(chainKey(open(version), 'extrude-base')).toBe(chainKey(open(CURRENT_SCHEMA_VERSION), 'extrude-base'))
  })
})
