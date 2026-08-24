'use strict'

const assert = require('node:assert/strict')
const { mkdir, mkdtemp, realpath, rm, symlink, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { relativeSource, resolveWorkspacePaths } = require('../dist/workspace')

test('finds the nearest toolchain file inside the workspace', async (context) => {
  const root = await fixture(context)
  const nested = path.join(root, 'crates', 'core')
  await mkdir(nested, { recursive: true })
  await writeFile(path.join(root, 'rust-toolchain.toml'), '[toolchain]\nchannel = "stable"\n')

  const paths = await resolveWorkspacePaths(root, 'crates/core')

  assert.equal(paths.workingDirectory, await realpath(nested))
  assert.equal(paths.toolchainFile, path.join(await realpath(root), 'rust-toolchain.toml'))
  assert.equal(relativeSource(paths.workspace, paths.toolchainFile), 'rust-toolchain.toml')
})

test('matches rustup precedence when both toolchain filenames exist', async (context) => {
  const root = await fixture(context)
  await Promise.all([
    writeFile(path.join(root, 'rust-toolchain'), 'stable\n'),
    writeFile(path.join(root, 'rust-toolchain.toml'), '[toolchain]\nchannel = "beta"\n')
  ])

  const paths = await resolveWorkspacePaths(root, '.')

  assert.equal(paths.toolchainFile, path.join(await realpath(root), 'rust-toolchain'))
})

test('rejects lexical and symlink escapes from the workspace', async (context) => {
  const root = await fixture(context)
  const outside = await fixture(context)

  await assert.rejects(resolveWorkspacePaths(root, outside), /must remain inside/u)

  const link = path.join(root, 'outside')
  await symlink(outside, link, 'dir')
  await assert.rejects(resolveWorkspacePaths(root, 'outside'), /must remain inside/u)

  const externalToolchain = path.join(outside, 'external-toolchain.toml')
  await writeFile(externalToolchain, '[toolchain]\nchannel = "stable"\n')
  await symlink(externalToolchain, path.join(root, 'rust-toolchain.toml'))
  await assert.rejects(resolveWorkspacePaths(root, '.'), /toolchain file must remain inside/iu)
})

test('rejects a directory named like a toolchain file', async (context) => {
  const root = await fixture(context)
  await mkdir(path.join(root, 'rust-toolchain.toml'))
  await assert.rejects(resolveWorkspacePaths(root, '.'), /is not a file/u)
})

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-rust-workspace-'))
  context.after(() => rm(root, { force: true, recursive: true }))
  return root
}
