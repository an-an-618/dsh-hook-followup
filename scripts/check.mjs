#!/usr/bin/env node
/**
 * Release preflight for @an-an-618/dsh-hook-followup.
 *
 * Run before installing the bundle into any profile. It checks the class of
 * failure that broke the Intelligent UI v2.0.0 install (a double-brace sequence
 * in a system-prompt section makes DSH treat it as a malformed template and
 * fails every turn), plus syntax, both test suites, the manifest and source
 * hygiene.
 *
 * Usage: node scripts/check.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function ok(name) {
  console.log(`ok   ${name}`)
}

function fail(name, detail) {
  failures.push(name)
  console.error(`FAIL ${name}${detail === undefined ? '' : `: ${detail}`}`)
}

function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' })
  if (result.status === 0) {
    ok(name)
    return true
  }
  if (result.stdout.trim() !== '') console.error(result.stdout.trim())
  if (result.stderr.trim() !== '') console.error(result.stderr.trim())
  fail(name, `exit ${result.status ?? result.signal}`)
  return false
}

function jsFiles(dir) {
  const absolute = join(root, dir)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute)
    .filter((entry) => entry.endsWith('.js') || entry.endsWith('.mjs'))
    .map((entry) => join(dir, entry))
}

/* 1. Syntax ---------------------------------------------------------------- */

const syntaxTargets = ['index.js', 'client.js', ...jsFiles('lib'), ...jsFiles('scripts'), ...jsFiles('test')]
for (const file of syntaxTargets) {
  if (file === 'scripts/check.mjs') continue
  run(`node --check ${file}`, ['--check', file])
}

/* 2. Tests ----------------------------------------------------------------- */

run('host tests', ['test/host.test.mjs'])
run('client tests', ['test/client.test.mjs'])

/* 3. Prompt template guard ------------------------------------------------- */

const { buildPromptSection, toolDescription } = await import(pathToFileURL(join(root, 'lib/prompt.js')).href)

for (const language of ['zh', 'en']) {
  for (const mode of ['ui', 'markdown', 'tag']) {
    const section = buildPromptSection({ language, maxReplies: 3, renderMode: mode })
    if (section.includes('{{')) fail(`prompt section (${language}/${mode})`, 'contains "{{"; DSH will fail every turn')
    else ok(`prompt section (${language}/${mode}) has no "{{"`)
    if (section.length < 900) fail(`prompt section (${language}/${mode})`, `too short: ${section.length}`)
  }
  const description = toolDescription(language, 3)
  if (description.includes('{{')) fail(`tool description (${language})`, 'contains "{{"')
  else ok(`tool description (${language}) has no "{{"`)
}

/* 4. Manifest -------------------------------------------------------------- */

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (manifest.name !== '@an-an-618/dsh-hook-followup') fail('manifest name', manifest.name)
else ok('manifest name')

for (const [key, target] of Object.entries(manifest.exports ?? {})) {
  if (target.includes('*')) continue
  if (!existsSync(join(root, target))) fail(`export ${key}`, `${target} does not exist`)
  else ok(`export ${key}`)
}
for (const entry of manifest.files ?? []) {
  if (entry.includes('*')) continue
  if (!existsSync(join(root, entry))) fail(`files entry ${entry}`, 'does not exist')
  else ok(`files entry ${entry}`)
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch', String(manifest.dsh?.bundle?.patch))
else ok('dsh.bundle.patch')
if (manifest.dsh?.client?.platform !== 'web') fail('dsh.client.platform', String(manifest.dsh?.client?.platform))
else ok('dsh.client.platform')
if (!manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-chat')) fail('dsh.client.inject', 'missing ui-chat')
else ok('dsh.client.inject')

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
if (!patch.includes("name: '@an-an-618/dsh-hook-followup'")) fail('cordis.patch.yml', 'row name missing')
else ok('cordis.patch.yml row')

/* 5. Locale resources ------------------------------------------------------ */

for (const language of ['zh', 'en']) {
  const file = join(root, 'locale', language + '.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const meta = parsed.meta
    if (typeof meta?.title !== 'string' || meta.title.trim() === '') fail(`locale ${language}`, 'meta.title missing')
    else if (typeof meta?.description !== 'string' || meta.description.trim() === '') fail(`locale ${language}`, 'meta.description missing')
    else ok(`locale ${language}`)
  } catch (error) {
    fail(`locale ${language}`, error.message)
  }
}

/* 6. Source hygiene -------------------------------------------------------- */

const runtimeSources = ['index.js', 'client.js', ...jsFiles('lib')]
const forbidden = [
  [/\bnew\s+Function\b/, 'new Function'],
  [/\beval\s*\(/, 'eval('],
  [/\bdocument\s*\./, 'document.*'],
  [/\bfetch\s*\(/, 'fetch('],
  [/position\s*:\s*fixed/, 'position: fixed'],
]
let clean = true
for (const file of runtimeSources) {
  if (!existsSync(join(root, file))) continue
  const source = readFileSync(join(root, file), 'utf8')
  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) {
      clean = false
      fail(`${file} contains ${label}`, 'source hygiene')
    }
  }
}
if (clean) ok('source hygiene')

/* 7. Summary --------------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`\nPREFLIGHT FAILED (${failures.length}): ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nPREFLIGHT OK: syntax, tests, prompt template, manifest, locale and source hygiene.')
