import {
  booleanInput,
  nonEmptyDirectory,
  optionalInstallableToolchain,
  optionalProfile,
  rustupList,
  rustupItems,
  type ActionInputs
} from './contracts'
import * as github from './github'
import { runCommand, type CommandResult, type RunCommand } from './process'
import { installRustupToolchain } from './rustup'
import { readToolchainFile, type ToolchainFileConfig } from './toolchain-file'
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
  requireCompatibleInputs(inputs)
  const workspaceValue = environment.GITHUB_WORKSPACE || process.cwd()
  const paths = await resolveWorkspacePaths(workspaceValue, inputs.workingDirectory)

  if (!inputs.toolchain && !paths.toolchainFile) {
    throw new Error(
      'No Rust toolchain selected; provide the toolchain input or commit rust-toolchain.toml'
    )
  }

  const file = inputs.toolchain
    ? undefined
    : await readToolchainFile(requireValue(paths.toolchainFile))
  const toolchainSource = inputs.toolchain
    ? 'input'
    : relativeSource(paths.workspace, requireValue(paths.toolchainFile))
  const selection = selectToolchain(inputs, file)

  github.startGroup(`Install Rust toolchain from ${toolchainSource}`)
  let installed: Awaited<ReturnType<typeof installRustupToolchain>>
  try {
    installed = await installRustupToolchain(
      {
        ...selection,
        allowDowngrade: inputs.allowDowngrade,
        cwd: paths.workingDirectory,
        environment,
        update: inputs.update
      },
      dependencies.runCommand
    )
  } finally {
    github.endGroup()
  }

  const [rustc, cargo] = await Promise.all([
    dependencies.runCommand('rustc', ['--version', '--verbose'], {
      cwd: paths.workingDirectory,
      environment: installed.environment,
      quiet: true
    }),
    dependencies.runCommand('cargo', ['--version'], {
      cwd: paths.workingDirectory,
      environment: installed.environment,
      quiet: true
    })
  ])

  const rustcDetails = parseRustc(rustc.stdout)
  const result: ActionResult = {
    cargoVersion: firstVersionLine(cargo, 'cargo'),
    host: rustcDetails.host,
    rustcCommit: rustcDetails.commit,
    rustcVersion: rustcDetails.release,
    rustupVersion: installed.rustupVersion,
    toolchain: installed.toolchain,
    toolchainSource
  }

  await publishResult(result, environment)
  github.info(
    `Selected Rust ${result.rustcVersion} (${result.host}) from ${result.toolchainSource}`
  )
  return result
}

function requireCompatibleInputs(inputs: ActionInputs): void {
  if (!inputs.update && inputs.allowDowngrade) {
    throw new Error('allow-downgrade requires update to be true')
  }
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
    toolchain: optionalInstallableToolchain(github.input('toolchain', environment)),
    update: booleanInput(github.input('update', environment) || 'true', 'update'),
    workingDirectory: nonEmptyDirectory(
      github.input('working-directory', environment) || '.'
    )
  }
}

function selectToolchain(
  inputs: ActionInputs,
  file: ToolchainFileConfig | undefined
): Pick<ToolchainFileConfig, 'components' | 'profile' | 'targets' | 'toolchain'> & {
  profile: NonNullable<ToolchainFileConfig['profile']>
} {
  return {
    components: rustupItems([...(file?.components ?? []), ...inputs.components], 'components'),
    profile: inputs.profile ?? file?.profile ?? 'minimal',
    targets: rustupItems([...(file?.targets ?? []), ...inputs.targets], 'targets'),
    toolchain: inputs.toolchain ?? requireValue(file).toolchain
  }
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
