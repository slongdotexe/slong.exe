import { copyFile, mkdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function buildCacheArtifact(outputDirectory = new URL('../infra/cache/out/', import.meta.url)) {
  await mkdir(outputDirectory, { recursive: true })
  await copyFile(new URL('../infra/cache/template.yaml', import.meta.url), new URL('template.yaml', outputDirectory))
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length > 3) throw new Error('Usage: node build-cache-artifact.mts [OUTPUT_DIRECTORY]')
  await buildCacheArtifact(process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + sep) : undefined)
}
