import { spawn } from 'node:child_process'

export interface CommandOptions {
  cwd: string
  environment: NodeJS.ProcessEnv
  quiet?: boolean
}

export interface CommandResult {
  stderr: string
  stdout: string
}

export type RunCommand = (
  command: string,
  arguments_: readonly string[],
  options: CommandOptions
) => Promise<CommandResult>

export const runCommand: RunCommand = async (command, arguments_, options) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (!options.quiet) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (!options.quiet) process.stderr.write(chunk)
    })
    child.on('error', (error) => reject(error))
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({ stderr, stdout })
        return
      }
      const rendered = [command, ...arguments_].map(renderArgument).join(' ')
      const status = signal ? `signal ${signal}` : `exit code ${String(code)}`
      const details = (stderr.trim() || stdout.trim()).slice(0, 2_000)
      const suffix = details.length > 0 ? `: ${details}` : ''
      reject(new Error(`${rendered} failed with ${status}${suffix}`))
    })
  })

function renderArgument(value: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/u.test(value) ? value : JSON.stringify(value)
}
