import { appendFile } from 'node:fs/promises'

export function input(name: string, environment: NodeJS.ProcessEnv = process.env): string {
  const key = `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`
  return environment[key] ?? ''
}

export async function exportVariable(
  name: string,
  value: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  requireSingleLine(name, value)
  environment[name] = value
  const environmentFile = environment.GITHUB_ENV
  if (environmentFile) await appendFile(environmentFile, `${name}=${value}\n`, 'utf8')
}

export async function setOutput(
  name: string,
  value: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  requireSingleLine(name, value)
  const outputFile = environment.GITHUB_OUTPUT
  if (outputFile) await appendFile(outputFile, `${name}=${value}\n`, 'utf8')
}

export function info(message: string): void {
  process.stdout.write(`${message}\n`)
}

export function startGroup(message: string): void {
  process.stdout.write(`::group::${escapeWorkflowCommand(message)}\n`)
}

export function endGroup(): void {
  process.stdout.write('::endgroup::\n')
}

export function setFailed(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`::error::${escapeWorkflowCommand(message)}\n`)
  process.exitCode = 1
}

function requireSingleLine(name: string, value: string): void {
  if (/[\r\n\0]/u.test(name) || /[\r\n\0]/u.test(value)) {
    throw new Error(`GitHub output ${JSON.stringify(name)} must be a single line`)
  }
}

function escapeWorkflowCommand(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}
