/**
 * Validate tool-catalog.json against the live OpenAPI spec.
 * Detects drift: commands in catalog that don't exist in spec,
 * spec endpoints that aren't in the catalog, and parameter mismatches.
 *
 * Run: npx tsx scripts/validate-catalog.ts
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSpec, getPublicPaths, getLatestVersionPaths, pathRequiresApiKey } from '../src/core/spec-loader.js'
import { parseEndpoints } from '../src/core/command-builder.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface CatalogCommand {
  name: string
  command: string
  method: string
  path: string
  group: string
  description: string
  parameters: Array<{ name: string; required?: boolean }>
}

interface Catalog {
  commands: CatalogCommand[]
}

// Paths that the CLI intentionally skips (execution endpoints)
const SKIP_PATHS = ['/execute', '/fast-fill']
function isSkipped(path: string): boolean {
  if (SKIP_PATHS.some(p => path.startsWith(p))) return true
  if (path.includes('/claim') && !path.includes('/claims')) return true
  return false
}

async function main() {
  const catalogPath = join(__dirname, '..', 'agents', 'tool-catalog.json')
  const catalog: Catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'))

  console.log('Fetching live OpenAPI spec...')
  const spec = await loadSpec(true) // force refresh
  // The catalog documents the keyless (default) surface — validate against it.
  const publicPaths = getLatestVersionPaths(getPublicPaths(spec), false)
  const endpoints = parseEndpoints(spec, false)

  let issues = 0

  // 0. Keyless-surface safety: no keyless command may silently map to a path
  // that hard-requires x-api-key while an ungated version of the same endpoint
  // exists (that's a version-dedupe bug — the /requests/v3 failure mode).
  console.log('\n--- Keyless surface → auth gating ---')
  const allSpecPaths = Object.keys(getPublicPaths(spec))
  for (const ep of endpoints) {
    if (!ep.requiresAuth) continue
    const base = ep.path.replace(/\/v\d+$/, '')
    const hasUngatedSibling = allSpecPaths.some(p => {
      if (p !== base && !p.startsWith(base + '/v')) return false
      return !pathRequiresApiKey(spec.paths[p])
    })
    if (hasUngatedSibling) {
      console.log(`✗  keyless command "relay ${ep.commandParts.join(' ')}" maps to key-required ${ep.path} despite an ungated version existing`)
      issues++
    } else {
      console.log(`ℹ  "relay ${ep.commandParts.join(' ')}" (${ep.path}) is key-required with no ungated version — CLI errors with a fix hint when keyless`)
    }
  }

  // 1. Check each catalog command exists in spec
  console.log('\n--- Catalog → Spec ---')
  for (const cmd of catalog.commands) {
    // Smart aliases and built-in commands are not backed by spec endpoints
    if (!cmd.method || !cmd.path) continue

    const match = endpoints.find(e =>
      e.path === cmd.path && e.method === cmd.method
    )

    if (!match) {
      // Check if path exists but was version-filtered
      const pathExists = Object.keys(spec.paths).some(p =>
        p === cmd.path || p.startsWith(cmd.path + '/v')
      )
      if (pathExists) {
        console.log(`⚠  ${cmd.name}: path ${cmd.path} exists in spec but may have a newer version`)
      } else {
        console.log(`✗  ${cmd.name}: ${cmd.method} ${cmd.path} NOT FOUND in spec`)
      }
      issues++
      continue
    }

    // Check parameters
    const specParamNames = new Set([
      ...match.queryParams.map(p => p.name),
      ...match.pathParams.map(p => p.name),
    ])
    const catalogParamNames = new Set(cmd.parameters.map(p => p.name))

    const missingFromCatalog = [...specParamNames].filter(n => !catalogParamNames.has(n))
    const extraInCatalog = [...catalogParamNames].filter(n => !specParamNames.has(n))

    if (missingFromCatalog.length > 0) {
      console.log(`⚠  ${cmd.name}: spec has params not in catalog: ${missingFromCatalog.join(', ')}`)
      issues++
    }
    if (extraInCatalog.length > 0) {
      // Body params won't be in query/path — only warn for non-POST methods
      if (cmd.method === 'GET') {
        console.log(`⚠  ${cmd.name}: catalog has params not in spec: ${extraInCatalog.join(', ')}`)
        issues++
      }
    }
  }

  // 2. Check for spec endpoints not in catalog
  console.log('\n--- Spec → Catalog ---')
  const catalogPaths = new Set(catalog.commands.map(c => `${c.method}:${c.path}`))

  for (const ep of endpoints) {
    const key = `${ep.method}:${ep.path}`
    if (!catalogPaths.has(key)) {
      console.log(`⚠  ${ep.method} ${ep.path} in spec but NOT in catalog (command: ${ep.commandParts.join(' ')})`)
      issues++
    }
  }

  // Summary
  console.log(`\n--- Summary ---`)
  console.log(`Catalog commands: ${catalog.commands.length}`)
  console.log(`Spec endpoints (after filtering): ${endpoints.length}`)
  console.log(`Issues found: ${issues}`)

  if (issues > 0) {
    console.log('\nCatalog is out of sync with the live spec. Update agents/tool-catalog.json.')
    process.exit(1)
  } else {
    console.log('\nCatalog is in sync with the live spec.')
  }
}

main().catch(err => {
  console.error('Failed to validate catalog:', err.message)
  process.exit(1)
})
