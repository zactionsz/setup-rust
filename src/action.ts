import {
  booleanInput,
  nonEmptyDirectory,
  optionalProfile,
  optionalToolchain,
  rustupList,
  type ActionInputs
} from './contracts'
import * as github from './github'
import { runCommand, type CommandResult, type RunCommand } from './process'
import { relativeSource, resolveWorkspacePaths } from './workspace'

interface Dependencies {
  runCommand: RunCommand
}

export interface ActionResult {
  cargoVersion: string
  host: string
  rustcCommit: string
  rustcVersion: string
  rustupVersion: string
  toolchain: string
  toolchainSource: string
}

export async function runAction(
  environment: NodeJS.ProcessEnv = process.env,
  overrides: Partial<Dependencies> = {}
): Promise<ActionResult> {
  const dependencies: Dependencies = { runCommand, ...overrides }
  const inputs = readInputs(environment)
  const workspaceValue = environment.GITHUB_WORKSPACE || process.cwd()
  const paths = await resolveWorkspacePaths(workspaceValue, inputs.workingDirectory)

  if (!inputs.toolchain && !paths.toolchainFile) {
    throw new Error(
      'No Rust toolchain selected; provide the toolchain input or commit rust-toolchain.toml'
    )
  }

  const toolchainSource = inputs.toolchain
    ? 'input'
    : relativeSource(paths.workspace, requireValue(paths.toolchainFile))
  const commandEnvironment = { ...environment }
  delete commandEnvironment.RUSTUP_TOOLCHAIN
  if (inputs.toolchain) commandEnvironment.RUSTUP_TOOLCHAIN = inputs.toolchain

  const installArguments = buildInstallArguments(inputs)
  github.startGroup(`Install Rust toolchain from ${toolchainSource}`)
  try {
    await dependencies.runCommand('rustup', installArguments, {
      cwd: paths.workingDirectory,
      environment: commandEnvironment
    })
  } finally {
    github.endGroup()
  }

  const selected = await dependencies.runCommand('rustup', ['show', 'active-toolchain'], {
    cwd: paths.workingDirectory,
    environment: commandEnvironment,
    quiet: true
  })
  const toolchain = parseActiveToolchain(selected.stdout)
  const selectedEnvironment = { ...commandEnvironment, RUSTUP_TOOLCHAIN: toolchain }

  const [rustc, cargo, rustup] = await Promise.all([
    dependencies.runCommand('rustc', ['--version', '--verbose'], {
      cwd: paths.workingDirectory,
      environment: selectedEnvironment,
      quiet: true
    }),
    dependencies.runCommand('cargo', ['--version'], {
      cwd: paths.workingDirectory,
      environment: selectedEnvironment,
      quiet: true
    }),
    dependencies.runCommand('rustup', ['--version'], {
      cwd: paths.workingDirectory,
      environment: selectedEnvironment,
      quiet: true
    })
  ])

  const rustcDetails = parseRustc(rustc.stdout)
  const result: ActionResult = {
    cargoVersion: firstVersionLine(cargo, 'cargo'),
    host: rustcDetails.host,
    rustcCommit: rustcDetails.commit,
    rustcVersion: rustcDetails.release,
    rustupVersion: firstVersionLine(rustup, 'rustup'),
    toolchain,
    toolchainSource
  }

  await publishResult(result, environment)
  github.info(
    `Selected Rust ${result.rustcVersion} (${result.host}) from ${result.toolchainSource}`
  )
  return result
}

function readInputs(environment: NodeJS.ProcessEnv): ActionInputs {
  return {
    allowDowngrade: booleanInput(
      github.input('allow-downgrade', environment) || 'false',
      'allow-downgrade'
    ),
    components: rustupList(github.input('components', environment), 'components'),
    profile: optionalProfile(github.input('profile', environment)),
    targets: rustupList(github.input('targets', environment), 'targets'),
    toolchain: optionalToolchain(github.input('toolchain', environment)),
    update: booleanInput(github.input('update', environment) || 'true', 'update'),
    workingDirectory: nonEmptyDirectory(
      github.input('working-directory', environment) || '.'
    )
  }
}

function buildInstallArguments(inputs: ActionInputs): readonly string[] {
  const arguments_ = ['toolchain', 'install']
  if (inputs.toolchain) arguments_.push(inputs.toolchain)

  const profile = inputs.profile ?? (inputs.toolchain ? 'minimal' : undefined)
  if (profile) arguments_.push('--profile', profile)
  if (inputs.components.length > 0) {
    arguments_.push('--component', inputs.components.join(','))
  }
  if (inputs.targets.length > 0) arguments_.push('--target', inputs.targets.join(','))
  if (!inputs.update) arguments_.push('--no-update')
  if (inputs.allowDowngrade) arguments_.push('--allow-downgrade')
  return arguments_
}

function parseActiveToolchain(stdout: string): string {
  const candidate = stdout.trim().split(/\s+/u)[0]
  if (!candidate) throw new Error('rustup did not report an active toolchain')
  const toolchain = optionalToolchain(candidate)
  if (!toolchain) throw new Error('rustup reported an empty active toolchain')
  return toolchain
}

function parseRustc(stdout: string): { commit: string; host: string; release: string } {
  const values = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/u)) {
    const separator = line.indexOf(':')
    if (separator > 0) {
      values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
    }
  }
  return {
    commit: requiredField(values, 'commit-hash', 'rustc --version --verbose'),
    host: requiredField(values, 'host', 'rustc --version --verbose'),
    release: requiredField(values, 'release', 'rustc --version --verbose')
  }
}

function firstVersionLine(result: CommandResult, command: string): string {
  const line = result.stdout.split(/\r?\n/u).find((candidate) => candidate.trim().length > 0)
  if (!line) throw new Error(`${command} did not report a version`)
  return line.trim()
}

function requiredField(values: ReadonlyMap<string, string>, field: string, source: string): string {
  const value = values.get(field)
  if (!value) throw new Error(`${source} did not report ${field}`)
  return value
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Internal error: expected a value')
  return value
}

async function publishResult(
  result: ActionResult,
  environment: NodeJS.ProcessEnv
): Promise<void> {
  await github.exportVariable('RUSTUP_TOOLCHAIN', result.toolchain, environment)
  const outputs: Readonly<Record<string, string>> = {
    'cargo-version': result.cargoVersion,
    host: result.host,
    'rustc-commit': result.rustcCommit,
    'rustc-version': result.rustcVersion,
    'rustup-version': result.rustupVersion,
    toolchain: result.toolchain,
    'toolchain-source': result.toolchainSource
  }
  for (const [name, value] of Object.entries(outputs)) {
    await github.setOutput(name, value, environment)
  }
}
