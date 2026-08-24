import { readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'
import {
  optionalInstallableToolchain,
  optionalProfile,
  rustupItems,
  type RustupProfile
} from './contracts'

export interface ToolchainFileConfig {
  components: readonly string[]
  profile: RustupProfile | undefined
  targets: readonly string[]
  toolchain: string
}

type ParsedValue = string | readonly string[]
const MAX_TOOLCHAIN_FILE_BYTES = 64 * 1024

export async function readToolchainFile(file: string): Promise<ToolchainFileConfig> {
  const details = await stat(file)
  if (details.size > MAX_TOOLCHAIN_FILE_BYTES) {
    throw new Error(`Rust toolchain file exceeds ${String(MAX_TOOLCHAIN_FILE_BYTES)} bytes`)
  }
  const contents = await readFile(file, 'utf8')
  return parseToolchainFile(contents, path.basename(file))
}

export function parseToolchainFile(contents: string, filename: string): ToolchainFileConfig {
  if (contents.includes('\0')) throw new Error(`${filename} cannot contain NUL bytes`)
  const normalized = contents.replaceAll('\r\n', '\n').replaceAll('\r', '\n')

  if (filename === 'rust-toolchain' && isLegacyFile(normalized)) {
    const toolchain = optionalInstallableToolchain(normalized)
    if (!toolchain) throw new Error('rust-toolchain cannot be empty')
    return { components: [], profile: undefined, targets: [], toolchain }
  }

  const values = parseToolchainTable(normalized, filename)
  if (values.has('path')) {
    throw new Error(
      `${filename} uses a path toolchain, which setup-rust does not support; ` +
        'use an installable rustup channel'
    )
  }

  const channel = stringValue(values, 'channel', filename)
  if (!channel) throw new Error(`${filename} must define toolchain.channel`)
  const toolchain = optionalInstallableToolchain(channel)
  if (!toolchain) throw new Error(`${filename} must define a non-empty toolchain.channel`)

  const profileValue = stringValue(values, 'profile', filename)
  const components = arrayValue(values, 'components', filename)
  const targets = arrayValue(values, 'targets', filename)
  return {
    components: rustupItems(components, 'components'),
    profile: optionalProfile(profileValue ?? ''),
    targets: rustupItems(targets, 'targets'),
    toolchain
  }
}

function isLegacyFile(contents: string): boolean {
  return !contents.trimStart().startsWith('[')
}

function parseToolchainTable(contents: string, filename: string): ReadonlyMap<string, ParsedValue> {
  const values = new Map<string, ParsedValue>()
  const lines = contents.split('\n')
  let inToolchain = false
  let sawToolchain = false
  let pending: { key: string; value: string } | undefined

  for (const rawLine of lines) {
    const line = stripComment(rawLine)
    if (pending) {
      pending.value += `\n${line}`
      if (isCompleteValue(pending.value)) {
        setValue(values, pending.key, parseValue(pending.value, filename), filename)
        pending = undefined
      }
      continue
    }

    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const header = /^\[([^\]]+)\]$/u.exec(trimmed)
    if (header) {
      const table = header[1]?.trim()
      if (table !== 'toolchain') {
        throw new Error(`Unsupported table ${JSON.stringify(table)} in ${filename}`)
      }
      if (sawToolchain) throw new Error(`Duplicate [toolchain] table in ${filename}`)
      sawToolchain = true
      inToolchain = true
      continue
    }
    if (!inToolchain) throw new Error(`Content outside [toolchain] in ${filename}`)

    const assignment = splitAssignment(line, filename)
    requireKnownKey(assignment.key, filename)
    if (isCompleteValue(assignment.value)) {
      setValue(values, assignment.key, parseValue(assignment.value, filename), filename)
    } else {
      pending = assignment
    }
  }

  if (pending) throw new Error(`Unterminated ${pending.key} value in ${filename}`)
  if (values.size === 0) throw new Error(`${filename} must contain a [toolchain] table`)
  return values
}

function splitAssignment(line: string, filename: string): { key: string; value: string } {
  const separator = findOutsideString(line, '=')
  if (separator < 0) throw new Error(`Invalid assignment in ${filename}: ${line.trim()}`)
  const key = line.slice(0, separator).trim()
  const value = line.slice(separator + 1).trim()
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key) || value.length === 0) {
    throw new Error(`Invalid assignment in ${filename}: ${line.trim()}`)
  }
  return { key, value }
}

function requireKnownKey(key: string, filename: string): void {
  if (!['channel', 'components', 'path', 'profile', 'targets'].includes(key)) {
    throw new Error(`Unsupported toolchain key ${JSON.stringify(key)} in ${filename}`)
  }
}

function setValue(
  values: Map<string, ParsedValue>,
  key: string,
  value: ParsedValue,
  filename: string
): void {
  if (values.has(key)) throw new Error(`Duplicate toolchain key ${JSON.stringify(key)} in ${filename}`)
  values.set(key, value)
}

function parseValue(value: string, filename: string): ParsedValue {
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) return parseStringArray(trimmed, filename)
  return parseString(trimmed, filename)
}

function parseStringArray(value: string, filename: string): readonly string[] {
  if (!value.endsWith(']')) throw new Error(`Unterminated array in ${filename}`)
  const items: string[] = []
  let index = 1

  while (index < value.length - 1) {
    index = skipWhitespace(value, index)
    if (value[index] === ']') break
    const parsed = parseStringAt(value, index, filename)
    items.push(parsed.value)
    index = skipWhitespace(value, parsed.next)
    if (value[index] === ',') {
      index += 1
      continue
    }
    if (value[index] !== ']') throw new Error(`Expected a comma in an array in ${filename}`)
  }

  index = skipWhitespace(value, index)
  if (value[index] !== ']' || value.slice(index + 1).trim().length > 0) {
    throw new Error(`Invalid array in ${filename}`)
  }
  return items
}

function parseString(value: string, filename: string): string {
  const parsed = parseStringAt(value, 0, filename)
  if (value.slice(parsed.next).trim().length > 0) {
    throw new Error(`Invalid string value in ${filename}`)
  }
  return parsed.value
}

function parseStringAt(
  value: string,
  start: number,
  filename: string
): { next: number; value: string } {
  const quote = value[start]
  if (quote !== '"' && quote !== "'") {
    throw new Error(`Expected a quoted string in ${filename}`)
  }
  let escaped = false
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index]
    if (quote === '"' && character === '\\' && !escaped) {
      escaped = true
      continue
    }
    if (character === quote && !escaped) {
      const raw = value.slice(start, index + 1)
      return {
        next: index + 1,
        value: quote === '"' ? parseBasicString(raw, filename) : raw.slice(1, -1)
      }
    }
    escaped = false
  }
  throw new Error(`Unterminated string in ${filename}`)
}

function parseBasicString(value: string, filename: string): string {
  try {
    return JSON.parse(value) as string
  } catch {
    throw new Error(`Unsupported string escape in ${filename}`)
  }
}

function isCompleteValue(value: string): boolean {
  let quote: string | undefined
  let escaped = false
  let depth = 0
  for (const character of value) {
    if (quote) {
      if (quote === '"' && character === '\\' && !escaped) {
        escaped = true
        continue
      }
      if (character === quote && !escaped) quote = undefined
      escaped = false
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '[') depth += 1
    else if (character === ']') depth -= 1
  }
  return quote === undefined && depth === 0
}

function stripComment(line: string): string {
  const comment = findOutsideString(line, '#')
  return comment < 0 ? line : line.slice(0, comment)
}

function findOutsideString(value: string, sought: string): number {
  let quote: string | undefined
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (quote === '"' && character === '\\' && !escaped) {
        escaped = true
        continue
      }
      if (character === quote && !escaped) quote = undefined
      escaped = false
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === sought) return index
  }
  return -1
}

function skipWhitespace(value: string, start: number): number {
  let index = start
  while (/\s/u.test(value[index] ?? '')) index += 1
  return index
}

function stringValue(
  values: ReadonlyMap<string, ParsedValue>,
  key: string,
  filename: string
): string | undefined {
  const value = values.get(key)
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string in ${filename}`)
  return value
}

function arrayValue(
  values: ReadonlyMap<string, ParsedValue>,
  key: string,
  filename: string
): readonly string[] {
  const value = values.get(key)
  if (value === undefined) return []
  if (typeof value === 'string') throw new Error(`${key} must be an array in ${filename}`)
  return value
}
