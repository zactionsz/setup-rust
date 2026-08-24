'use strict'

const assert = require('node:assert/strict')
const { mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { runAction } = require('../dist/action')

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

test('installs and exports an explicit toolchain with safe argv boundaries', async (context) => {
  const fixture = await createFixture(context)
  const calls = []
  const environment = {
    ...fixture.environment,
    'INPUT_ALLOW-DOWNGRADE': 'true',
    INPUT_COMPONENTS: 'clippy, rustfmt,clippy',
    INPUT_PROFILE: '',
    INPUT_TARGETS: 'wasm32-unknown-unknown',
    INPUT_TOOLCHAIN: '1.88.0',
    INPUT_UPDATE: 'false',
    'INPUT_WORKING-DIRECTORY': '.'
  }
  const result = await runAction(environment, { runCommand: fakeRunner(calls) })

  assert.deepEqual(calls[0].arguments, [
    'toolchain',
    'install',
    '1.88.0',
    '--profile',
    'minimal',
    '--component',
    'clippy,rustfmt',
    '--target',
    'wasm32-unknown-unknown',
    '--no-update',
    '--allow-downgrade'
  ])
  assert.equal(calls[0].environment.RUSTUP_TOOLCHAIN, '1.88.0')
  assert.equal(result.toolchain, '1.88.0-x86_64-unknown-linux-gnu')
  assert.equal(result.toolchainSource, 'input')
  assert.equal(result.rustcVersion, '1.88.0')
  assert.equal(result.rustcCommit, '6b00bc3880198600130e1cf62b8f8a93494488cc')
  assert.equal(result.host, 'x86_64-unknown-linux-gnu')
  assert.equal(
    environment.RUSTUP_TOOLCHAIN,
    '1.88.0-x86_64-unknown-linux-gnu'
  )
  assert.match(
    await readFile(fixture.environmentFile, 'utf8'),
    /^RUSTUP_TOOLCHAIN=1\.88\.0-x86_64-unknown-linux-gnu$/mu
  )
  const outputs = await readFile(fixture.outputFile, 'utf8')
  assert.match(outputs, /^toolchain-source=input$/mu)
  assert.match(outputs, /^cargo-version=cargo 1\.88\.0 .*$/mu)
})

test('uses the repository toolchain file and clears inherited selection', async (context) => {
  const fixture = await createFixture(context)
  const nested = path.join(fixture.root, 'crates', 'core')
  await mkdir(nested, { recursive: true })
  await writeFile(
    path.join(fixture.root, 'rust-toolchain.toml'),
    '[toolchain]\nchannel = "1.88.0"\nprofile = "minimal"\n'
  )
  const calls = []

  const result = await runAction(
    {
      ...fixture.environment,
      RUSTUP_TOOLCHAIN: 'stable',
      'INPUT_WORKING-DIRECTORY': 'crates/core'
    },
    { runCommand: fakeRunner(calls) }
  )

  assert.deepEqual(calls[0].arguments, ['toolchain', 'install'])
  assert.equal(calls[0].cwd, await realpath(nested))
  assert.equal(calls[0].environment.RUSTUP_TOOLCHAIN, undefined)
  assert.equal(calls[1].environment.RUSTUP_TOOLCHAIN, undefined)
  assert.equal(result.toolchainSource, 'rust-toolchain.toml')
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
  assert.equal(await readFile(fixture.environmentFile, 'utf8'), '')
  assert.equal(await readFile(fixture.outputFile, 'utf8'), '')
})

test('does not publish outputs when rustup installation fails', async (context) => {
  const fixture = await createFixture(context)

  await assert.rejects(
    runAction(
      { ...fixture.environment, INPUT_TOOLCHAIN: '1.88.0' },
      { runCommand: async () => Promise.reject(new Error('rustup failed')) }
    ),
    /rustup failed/u
  )
  assert.equal(await readFile(fixture.environmentFile, 'utf8'), '')
  assert.equal(await readFile(fixture.outputFile, 'utf8'), '')
})

test('rejects an invalid active toolchain reported by rustup', async (context) => {
  const fixture = await createFixture(context)
  const runner = fakeRunner([])

  await assert.rejects(
    runAction(
      { ...fixture.environment, INPUT_TOOLCHAIN: '1.88.0' },
      {
        runCommand: async (command, arguments_, options) => {
          if (command === 'rustup' && arguments_[0] === 'show') {
            return { stderr: '', stdout: '--help (unexpected)\n' }
          }
          return runner(command, arguments_, options)
        }
      }
    ),
    /Invalid toolchain item/u
  )
  assert.equal(await readFile(fixture.environmentFile, 'utf8'), '')
  assert.equal(await readFile(fixture.outputFile, 'utf8'), '')
})

function fakeRunner(calls) {
  return async (command, arguments_, options) => {
    calls.push({ arguments: [...arguments_], command, ...options })
    if (command === 'rustup' && arguments_[0] === 'toolchain') {
      return { stderr: '', stdout: '' }
    }
    if (command === 'rustup' && arguments_[0] === 'show') {
      return {
        stderr: '',
        stdout: '1.88.0-x86_64-unknown-linux-gnu (overridden by RUSTUP_TOOLCHAIN)\n'
      }
    }
    if (command === 'rustc') return { stderr: '', stdout: RUSTC_VERBOSE }
    if (command === 'cargo') {
      return { stderr: '', stdout: 'cargo 1.88.0 (873a06493 2025-05-10)\n' }
    }
    if (command === 'rustup') return { stderr: '', stdout: 'rustup 1.28.2 (e4f3ad6f8 2025-04-28)\n' }
    throw new Error(`Unexpected command ${command}`)
  }
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
