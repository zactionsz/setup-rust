'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { runCommand } = require('../dist/process')

test('captures command output and preserves argument boundaries', async () => {
  const marker = 'value with spaces; $(never-evaluated)'
  const result = await runCommand(
    process.execPath,
    ['-e', 'process.stdout.write(process.argv[1])', marker],
    { cwd: process.cwd(), environment: process.env, quiet: true }
  )

  assert.equal(result.stdout, marker)
  assert.equal(result.stderr, '')
})

test('includes captured diagnostics when a quiet command fails', async () => {
  await assert.rejects(
    runCommand(
      process.execPath,
      ['-e', 'process.stderr.write("specific failure"); process.exit(7)'],
      { cwd: process.cwd(), environment: process.env, quiet: true }
    ),
    /exit code 7: specific failure/u
  )
})
