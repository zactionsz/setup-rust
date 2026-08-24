'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  booleanInput,
  nonEmptyDirectory,
  optionalInstallableToolchain,
  optionalProfile,
  optionalToolchain,
  rustupList
} = require('../dist/contracts')

test('accepts an explicit rustup toolchain name', () => {
  assert.equal(optionalToolchain('  nightly-2026-08-01  '), 'nightly-2026-08-01')
  assert.equal(optionalToolchain(''), undefined)
})

test('rejects toolchain values that could become command options', () => {
  assert.throws(() => optionalToolchain('--help'), /Invalid toolchain item/u)
  assert.throws(() => optionalToolchain('stable latest'), /Invalid toolchain item/u)
})

test('accepts only installable distribution toolchains at the action boundary', () => {
  assert.equal(optionalInstallableToolchain('stable'), 'stable')
  assert.equal(
    optionalInstallableToolchain('nightly-2026-08-01-x86_64-unknown-linux-gnu'),
    'nightly-2026-08-01-x86_64-unknown-linux-gnu'
  )
  assert.equal(optionalInstallableToolchain('1.88.0-beta.1'), '1.88.0-beta.1')
  assert.throws(() => optionalInstallableToolchain('review-custom'), /expected an installable/u)
})

test('parses and deduplicates rustup lists without reordering them', () => {
  assert.deepEqual(rustupList('clippy, rustfmt\nclippy', 'components'), [
    'clippy',
    'rustfmt'
  ])
  assert.throws(() => rustupList('clippy,--force', 'components'), /Invalid components item/u)
})

test('accepts only rustup profiles', () => {
  assert.equal(optionalProfile(' minimal '), 'minimal')
  assert.equal(optionalProfile(''), undefined)
  assert.throws(() => optionalProfile('tiny'), /expected minimal, default, or complete/u)
})

test('parses booleans strictly', () => {
  assert.equal(booleanInput('TRUE', 'update'), true)
  assert.equal(booleanInput(' false ', 'update'), false)
  assert.throws(() => booleanInput('yes', 'update'), /expected true or false/u)
})

test('rejects an empty or multiline working directory', () => {
  assert.equal(nonEmptyDirectory(' crates/core '), 'crates/core')
  assert.throws(() => nonEmptyDirectory('  '), /cannot be empty/u)
  assert.throws(() => nonEmptyDirectory('crates\ncore'), /cannot contain/u)
})
