export type RustupProfile = 'minimal' | 'default' | 'complete'

export interface ActionInputs {
  allowDowngrade: boolean
  components: readonly string[]
  profile: RustupProfile | undefined
  targets: readonly string[]
  toolchain: string | undefined
  update: boolean
  workingDirectory: string
}

const RUSTUP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const INSTALLABLE_TOOLCHAIN_PATTERN = /^(?:stable|beta|nightly|\d+\.\d+(?:\.\d+)?(?:-beta(?:\.\d+)?)?)(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/u
const PROFILES = new Set<RustupProfile>(['minimal', 'default', 'complete'])

export function optionalToolchain(value: string): string | undefined {
  const toolchain = value.trim()
  if (toolchain.length === 0) return undefined
  requireRustupName(toolchain, 'toolchain')
  return toolchain
}

export function optionalInstallableToolchain(value: string): string | undefined {
  const toolchain = optionalToolchain(value)
  if (toolchain && !INSTALLABLE_TOOLCHAIN_PATTERN.test(toolchain)) {
    throw new Error(
      `Invalid toolchain ${JSON.stringify(value)}; expected an installable stable, beta, nightly, ` +
        'or versioned rustup channel'
    )
  }
  return toolchain
}

export function optionalProfile(value: string): RustupProfile | undefined {
  const profile = value.trim()
  if (profile.length === 0) return undefined
  if (!PROFILES.has(profile as RustupProfile)) {
    throw new Error(
      `Invalid profile ${JSON.stringify(value)}; expected minimal, default, or complete`
    )
  }
  return profile as RustupProfile
}

export function rustupList(value: string, inputName: string): readonly string[] {
  const items = value
    .split(/[\s,]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  return rustupItems(items, inputName)
}

export function rustupItems(items: readonly string[], inputName: string): readonly string[] {
  const unique: string[] = []
  const seen = new Set<string>()

  for (const item of items) {
    requireRustupName(item, inputName)
    if (!seen.has(item)) {
      seen.add(item)
      unique.push(item)
    }
  }
  return Object.freeze(unique)
}

export function booleanInput(value: string, inputName: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error(`Invalid ${inputName} ${JSON.stringify(value)}; expected true or false`)
}

export function nonEmptyDirectory(value: string): string {
  const directory = value.trim()
  if (directory.length === 0) {
    throw new Error('working-directory cannot be empty')
  }
  if (/[\r\n\0]/u.test(directory)) {
    throw new Error('working-directory cannot contain newlines or NUL bytes')
  }
  return directory
}

function requireRustupName(value: string, inputName: string): void {
  if (!RUSTUP_NAME_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${inputName} item ${JSON.stringify(value)}; expected a rustup name containing ` +
        'only letters, numbers, periods, underscores, and hyphens'
    )
  }
}
