'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { parseToolchainFile } = require('../dist/toolchain-file')

test('parses a legacy rust-toolchain file', () => {
  assert.deepEqual(parseToolchainFile('nightly-2026-08-01\n', 'rust-toolchain'), {
    components: [],
    profile: undefined,
    targets: [],
    toolchain: 'nightly-2026-08-01'
  })
})

test('parses the supported toolchain TOML contract', () => {
  const config = parseToolchainFile(
    [
      '# repository policy',
      '[toolchain]',
      'channel = "1.88.0" # exact release',
      "profile = 'minimal'",
      'components = [',
      '  "clippy",',
      '  "rustfmt", # formatting',
      '  "clippy",',
      ']',
      'targets = ["wasm32-unknown-unknown"]'
    ].join('\n'),
    'rust-toolchain.toml'
  )

  assert.deepEqual(config, {
    components: ['clippy', 'rustfmt'],
    profile: 'minimal',
    targets: ['wasm32-unknown-unknown'],
    toolchain: '1.88.0'
  })
})

test('rejects path toolchains with an explicit boundary', () => {
  assert.throws(
    () =>
      parseToolchainFile(
        '[toolchain]\npath = "/opt/rust/custom"\n',
        'rust-toolchain.toml'
      ),
    /path toolchain.*does not support/u
  )
})

test('rejects malformed and ambiguous toolchain tables', () => {
  assert.throws(
    () => parseToolchainFile('[toolchain]\ncomponents = ["clippy"]\n', 'rust-toolchain.toml'),
    /must define toolchain\.channel/u
  )
  assert.throws(
    () =>
      parseToolchainFile(
        '[toolchain]\nchannel = "stable"\nchannel = "beta"\n',
        'rust-toolchain.toml'
      ),
    /Duplicate toolchain key/u
  )
  assert.throws(
    () => parseToolchainFile('[toolchain]\nchannel = "stable\n', 'rust-toolchain.toml'),
    /Unterminated/u
  )
  assert.throws(
    () =>
      parseToolchainFile(
        '[toolchain]\nchannel = "stable"\n[other]\nvalue = "no"\n',
        'rust-toolchain.toml'
      ),
    /Unsupported table/u
  )
})
