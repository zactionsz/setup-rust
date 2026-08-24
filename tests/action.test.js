'use strict'

const assert = require('node:assert/strict')
const { mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { runAction } = require('../dist/action')

const ACTIVE_TOOLCHAIN = '1.88.0-x86_64-unknown-linux-gnu'
const RUSTC_VERBOSE = [
  'rustc 1.88.0 (6b00bc388 2025-06-23)',
  'binary: rustc',
  'commit-hash: 6b00bc3880198600130e1cf62b8f8a93494488cc',
  'commit-date: 2025-06-23',
  'host: x86_64-unknown-linux-gnu',
  'release: 1.88.0',
  'LLVM version: 20.1.5',
  ''
].join('\n')

test('keeps no-update explicit installs additive and argument-safe', async (context) => {
  const fixture = await createFixture(context)
  const calls = []
  const environment = {
    ...fixture.environment,
    INPUT_COMPONENTS: 'clippy, rustfmt,clippy',
    INPUT_TARGETS: 'wasm32-unknown-unknown',
    INPUT_TOOLCHAIN: '1.88.0',
    INPUT_UPDATE: 'false'
  }
  const result = await runAction(environment, { runCommand: fakeRunner(calls) })

  assert.deepEqual(command(calls, 'toolchain', 'install').arguments, [
    'toolchain',
    'install',
    '1.88.0',
    '--profile',
    'minimal',
    '--no-self-update',
    '--no-update'
  ])
  assert.deepEqual(command(calls, 'component', 'add').arguments, [
    'component',
    'add',
    'clippy',
    'rustfmt',
    '--toolchain',
    ACTIVE_TOOLCHAIN
  ])
  assert.deepEqual(command(calls, 'target', 'add').arguments, [
    'target',
    'add',
    'wasm32-unknown-unknown',
    '--toolchain',
    ACTIVE_TOOLCHAIN
  ])
  assert.equal(command(calls, 'toolchain', 'list').environment.RUSTUP_TOOLCHAIN, undefined)
  assert.equal(command(calls, 'toolchain', 'install').environment.RUSTUP_TOOLCHAIN, '1.88.0')
  assert.equal(result.toolchain, ACTIVE_TOOLCHAIN)
  assert.equal(result.toolchainSource, 'input')
  assert.equal(environment.RUSTUP_TOOLCHAIN, ACTIVE_TOOLCHAIN)
  assert.match(await readFile(fixture.environmentFile, 'utf8'), /^RUSTUP_TOOLCHAIN=1\.88\.0-/mu)
})

test('merges repository and action modifiers into an explicit file-selected install', async (context) => {
  const fixture = await createFixture(context)
  const nested = path.join(fixture.root, 'crates', 'core')
  await mkdir(nested, { recursive: true })
  await writeFile(
    path.join(fixture.root, 'rust-toolchain.toml'),
    '[toolchain]\nchannel = "1.88.0"\nprofile = "minimal"\ncomponents = ["clippy"]\n'
  )
  const calls = []
  const result = await runAction(
    {
      ...fixture.environment,
      'INPUT_ALLOW-DOWNGRADE': 'true',
      RUSTUP_TOOLCHAIN: 'stable',
      INPUT_COMPONENTS: 'rustfmt,clippy',
      INPUT_TARGETS: 'wasm32-unknown-unknown',
      'INPUT_WORKING-DIRECTORY': 'crates/core'
    },
    { runCommand: fakeRunner(calls) }
  )

  assert.deepEqual(command(calls, 'toolchain', 'install').arguments, [
    'toolchain',
    'install',
    '1.88.0',
    '--profile',
    'minimal',
    '--no-self-update',
    '--component',
    'clippy,rustfmt',
    '--target',
    'wasm32-unknown-unknown',
    '--allow-downgrade'
  ])
  assert.equal(command(calls, 'toolchain', 'install').cwd, await realpath(nested))
  assert.equal(command(calls, 'toolchain', 'list').environment.RUSTUP_TOOLCHAIN, undefined)
  assert.equal(command(calls, 'toolchain', 'install').environment.RUSTUP_TOOLCHAIN, '1.88.0')
  assert.equal(result.toolchainSource, 'rust-toolchain.toml')
})

test('restores an absent global default after installation', async (context) => {
  const fixture = await createFixture(context)
  const calls = []
  await runAction(
    { ...fixture.environment, INPUT_TOOLCHAIN: '1.88.0' },
    { runCommand: fakeRunner(calls, { hasDefault: false }) }
  )

  const installIndex = calls.findIndex(
    (call) => call.arguments[0] === 'toolchain' && call.arguments[1] === 'install'
  )
  const restoreIndex = calls.findIndex((call) => call.arguments[0] === 'default')
  const showIndex = calls.findIndex((call) => call.arguments[0] === 'show')
  assert.ok(installIndex >= 0 && restoreIndex > installIndex && showIndex > restoreIndex)
  assert.deepEqual(calls[restoreIndex].arguments, ['default', 'none'])
})

test('restores an absent global default even when installation fails', async (context) => {
  const fixture = await createFixture(context)
  const calls = []
  const runner = fakeRunner(calls, { hasDefault: false, installError: new Error('rustup failed') })

  await assert.rejects(
    runAction({ ...fixture.environment, INPUT_TOOLCHAIN: '1.88.0' }, { runCommand: runner }),
    /rustup failed/u
  )
  assert.deepEqual(command(calls, 'default', 'none').arguments, ['default', 'none'])
  assert.equal(await readFile(fixture.environmentFile, 'utf8'), '')
  assert.equal(await readFile(fixture.outputFile, 'utf8'), '')
})

test('fails closed when neither an input nor a toolchain file selects Rust', async (context) => {
  const fixture = await createFixture(context)
  let called = false

  await assert.rejects(
    runAction(fixture.environment, {
      runCommand: async () => {
        called = true
        throw new Error('unexpected command')
      }
    }),
    /No Rust toolchain selected/u
  )
  assert.equal(called, false)
})

test('rejects path toolchain files before invoking rustup', async (context) => {
  const fixture = await createFixture(context)
  await writeFile(
    path.join(fixture.root, 'rust-toolchain.toml'),
    '[toolchain]\npath = "/opt/rust/custom"\n'
  )
  let called = false

  await assert.rejects(
    runAction(fixture.environment, {
      runCommand: async () => {
        called = true
        throw new Error('unexpected command')
      }
    }),
    /path toolchain.*does not support/u
  )
  assert.equal(called, false)
})

test('rejects unsupported rustup before installation', async (context) => {
  const fixture = await createFixture(context)
  const calls = []
  const runner = fakeRunner(calls, { rustupVersion: 'rustup 1.27.1 (old 2024-01-01)' })

  await assert.rejects(
    runAction({ ...fixture.environment, INPUT_TOOLCHAIN: '1.88.0' }, { runCommand: runner }),
    /requires rustup 1\.28\.0 or newer/u
  )
  assert.equal(calls.some((call) => call.arguments[0] === 'toolchain'), false)
})

test('rejects downgrade permission when updates are disabled', async (context) => {
  const fixture = await createFixture(context)
  let called = false

  await assert.rejects(
    runAction(
      {
        ...fixture.environment,
        'INPUT_ALLOW-DOWNGRADE': 'true',
        INPUT_TOOLCHAIN: 'stable',
        INPUT_UPDATE: 'false'
      },
      {
        runCommand: async () => {
          called = true
          throw new Error('unexpected command')
        }
      }
    ),
    /allow-downgrade requires update to be true/u
  )
  assert.equal(called, false)
})

test('rejects an invalid active toolchain reported by rustup', async (context) => {
  const fixture = await createFixture(context)
  const calls = []
  const runner = fakeRunner(calls, { activeToolchain: '/outside/toolchain' })

  await assert.rejects(
    runAction({ ...fixture.environment, INPUT_TOOLCHAIN: '1.88.0' }, { runCommand: runner }),
    /unsupported active toolchain/u
  )
})

function fakeRunner(calls, options = {}) {
  const activeToolchain = options.activeToolchain ?? ACTIVE_TOOLCHAIN
  const hasDefault = options.hasDefault ?? true
  const rustupVersion = options.rustupVersion ?? 'rustup 1.29.0 (28d1352db 2026-03-05)'
  return async (executable, arguments_, commandOptions) => {
    calls.push({ arguments: [...arguments_], command: executable, ...commandOptions })
    if (executable === 'rustup' && arguments_[0] === '--version') {
      return { stderr: '', stdout: `${rustupVersion}\n` }
    }
    if (executable === 'rustup' && arguments_[0] === 'toolchain' && arguments_[1] === 'list') {
      return { stderr: '', stdout: hasDefault ? 'stable-x86_64-unknown-linux-gnu (default)\n' : '' }
    }
    if (executable === 'rustup' && arguments_[0] === 'toolchain') {
      if (options.installError) throw options.installError
      return { stderr: '', stdout: '' }
    }
    if (executable === 'rustup' && arguments_[0] === 'default') {
      return { stderr: '', stdout: '' }
    }
    if (executable === 'rustup' && arguments_[0] === 'show') {
      return { stderr: '', stdout: `${activeToolchain} (overridden by RUSTUP_TOOLCHAIN)\n` }
    }
    if (executable === 'rustup' && ['component', 'target'].includes(arguments_[0])) {
      return { stderr: '', stdout: '' }
    }
    if (executable === 'rustc') return { stderr: '', stdout: RUSTC_VERBOSE }
    if (executable === 'cargo') {
      return { stderr: '', stdout: 'cargo 1.88.0 (873a06493 2025-05-10)\n' }
    }
    throw new Error(`Unexpected command ${executable} ${arguments_.join(' ')}`)
  }
}

function command(calls, first, second) {
  const found = calls.find(
    (call) => call.arguments[0] === first && (second === undefined || call.arguments[1] === second)
  )
  assert.ok(found, `Expected command arguments starting with ${first} ${second ?? ''}`)
  return found
}

async function createFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-rust-action-'))
  context.after(() => rm(root, { force: true, recursive: true }))
  const environmentFile = path.join(root, 'environment')
  const outputFile = path.join(root, 'output')
  await Promise.all([writeFile(environmentFile, ''), writeFile(outputFile, '')])
  const environment = {
    GITHUB_ENV: environmentFile,
    GITHUB_OUTPUT: outputFile,
    GITHUB_WORKSPACE: root,
    'INPUT_ALLOW-DOWNGRADE': 'false',
    INPUT_COMPONENTS: '',
    INPUT_PROFILE: '',
    INPUT_TARGETS: '',
    INPUT_TOOLCHAIN: '',
    INPUT_UPDATE: 'true',
    'INPUT_WORKING-DIRECTORY': '.'
  }
  return { environment, environmentFile, outputFile, root }
}
