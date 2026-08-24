import { access, realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'

const TOOLCHAIN_FILES = Object.freeze(['rust-toolchain', 'rust-toolchain.toml'])

export interface WorkspacePaths {
  toolchainFile: string | undefined
  workingDirectory: string
  workspace: string
}

export async function resolveWorkspacePaths(
  workspaceValue: string,
  workingDirectoryValue: string
): Promise<WorkspacePaths> {
  const workspace = await realpath(path.resolve(workspaceValue))
  const requested = path.resolve(workspace, workingDirectoryValue)
  const workingDirectory = await realpath(requested)
  const details = await stat(workingDirectory)
  if (!details.isDirectory()) {
    throw new Error(`working-directory is not a directory: ${workingDirectoryValue}`)
  }
  if (!isWithin(workspace, workingDirectory)) {
    throw new Error('working-directory must remain inside GITHUB_WORKSPACE')
  }
  return {
    toolchainFile: await findToolchainFile(workspace, workingDirectory),
    workingDirectory,
    workspace
  }
}

export function relativeSource(workspace: string, file: string): string {
  const relative = path.relative(workspace, file)
  return relative.length === 0 ? path.basename(file) : relative.split(path.sep).join('/')
}

async function findToolchainFile(
  workspace: string,
  workingDirectory: string
): Promise<string | undefined> {
  let current = workingDirectory
  while (isWithin(workspace, current)) {
    for (const filename of TOOLCHAIN_FILES) {
      const candidate = path.join(current, filename)
      if (await exists(candidate)) return candidate
    }
    if (current === workspace) break
    current = path.dirname(current)
  }
  return undefined
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..')
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}
