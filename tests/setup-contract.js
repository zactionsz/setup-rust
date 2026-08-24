'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const expectedVersion = required('EXPECTED_RUST_VERSION')
const expectedSource = required('EXPECTED_TOOLCHAIN_SOURCE')
const installedToolchain = required('INSTALLED_TOOLCHAIN')
const installedSource = required('INSTALLED_TOOLCHAIN_SOURCE')
const installedRustc = required('INSTALLED_RUSTC_VERSION')
const installedCargo = required('INSTALLED_CARGO_VERSION')
const installedRustup = required('INSTALLED_RUSTUP_VERSION')
const installedHost = required('INSTALLED_HOST')

assert.equal(installedSource, expectedSource)
assert.equal(installedRustc, expectedVersion)
assert.equal(process.env.RUSTUP_TOOLCHAIN, installedToolchain)
assert.match(installedToolchain, new RegExp(`^${escapePattern(expectedVersion)}-`))
assert.match(installedCargo, /^cargo \d+\.\d+\.\d+/u)
assert.match(installedRustup, /^rustup \d+\.\d+\.\d+/u)
assert.match(installedHost, /^[A-Za-z0-9_.-]+$/u)
assert.match(command('rustc', ['--version']), new RegExp(`^rustc ${escapePattern(expectedVersion)}`))
assert.match(command('cargo', ['--version']), /^cargo \d+\.\d+\.\d+/u)
assert.match(command('rustfmt', ['--version']), /^rustfmt \d+\.\d+\.\d+/u)
assert.match(command('cargo', ['clippy', '--version']), /^clippy \d+\.\d+\.\d+/u)
assert.match(
  command('rustup', ['target', 'list', '--installed']),
  /^wasm32-unknown-unknown$/mu
)

function command(executable, arguments_) {
  return execFileSync(executable, arguments_, { encoding: 'utf8' }).trim()
}

function required(name) {
  const value = process.env[name]
  assert.ok(value, `${name} is required`)
  return value
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
