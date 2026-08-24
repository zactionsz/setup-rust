"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readToolchainFile = readToolchainFile;
exports.parseToolchainFile = parseToolchainFile;
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
const contracts_1 = require("./contracts");
const MAX_TOOLCHAIN_FILE_BYTES = 64 * 1024;
async function readToolchainFile(file) {
    const handle = await (0, promises_1.open)(file, 'r');
    try {
        const details = await handle.stat();
        if (!details.isFile())
            throw new Error('Rust toolchain policy is not a regular file');
        if (details.size > MAX_TOOLCHAIN_FILE_BYTES) {
            throw new Error(`Rust toolchain file exceeds ${String(MAX_TOOLCHAIN_FILE_BYTES)} bytes`);
        }
        const contents = await handle.readFile({ encoding: 'utf8' });
        return parseToolchainFile(contents, path.basename(file));
    }
    finally {
        await handle.close();
    }
}
function parseToolchainFile(contents, filename) {
    if (contents.includes('\0'))
        throw new Error(`${filename} cannot contain NUL bytes`);
    const normalized = contents.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    if (filename === 'rust-toolchain' && isLegacyFile(normalized)) {
        const toolchain = (0, contracts_1.optionalInstallableToolchain)(normalized);
        if (!toolchain)
            throw new Error('rust-toolchain cannot be empty');
        return { components: [], profile: undefined, targets: [], toolchain };
    }
    const values = parseToolchainTable(normalized, filename);
    if (values.has('path')) {
        throw new Error(`${filename} uses a path toolchain, which setup-rust does not support; ` +
            'use an installable rustup channel');
    }
    const channel = stringValue(values, 'channel', filename);
    if (!channel)
        throw new Error(`${filename} must define toolchain.channel`);
    const toolchain = (0, contracts_1.optionalInstallableToolchain)(channel);
    if (!toolchain)
        throw new Error(`${filename} must define a non-empty toolchain.channel`);
    const profileValue = stringValue(values, 'profile', filename);
    const components = arrayValue(values, 'components', filename);
    const targets = arrayValue(values, 'targets', filename);
    return {
        components: (0, contracts_1.rustupItems)(components, 'components'),
        profile: (0, contracts_1.optionalProfile)(profileValue ?? ''),
        targets: (0, contracts_1.rustupItems)(targets, 'targets'),
        toolchain
    };
}
function isLegacyFile(contents) {
    return !contents.trimStart().startsWith('[');
}
function parseToolchainTable(contents, filename) {
    const values = new Map();
    const lines = contents.split('\n');
    let inToolchain = false;
    let sawToolchain = false;
    let pending;
    for (const rawLine of lines) {
        const line = stripComment(rawLine);
        if (pending) {
            pending.value += `\n${line}`;
            if (isCompleteValue(pending.value)) {
                setValue(values, pending.key, parseValue(pending.value, filename), filename);
                pending = undefined;
            }
            continue;
        }
        const trimmed = line.trim();
        if (trimmed.length === 0)
            continue;
        const header = /^\[([^\]]+)\]$/u.exec(trimmed);
        if (header) {
            const table = header[1]?.trim();
            if (table !== 'toolchain') {
                throw new Error(`Unsupported table ${JSON.stringify(table)} in ${filename}`);
            }
            if (sawToolchain)
                throw new Error(`Duplicate [toolchain] table in ${filename}`);
            sawToolchain = true;
            inToolchain = true;
            continue;
        }
        if (!inToolchain)
            throw new Error(`Content outside [toolchain] in ${filename}`);
        const assignment = splitAssignment(line, filename);
        requireKnownKey(assignment.key, filename);
        if (isCompleteValue(assignment.value)) {
            setValue(values, assignment.key, parseValue(assignment.value, filename), filename);
        }
        else {
            pending = assignment;
        }
    }
    if (pending)
        throw new Error(`Unterminated ${pending.key} value in ${filename}`);
    if (values.size === 0)
        throw new Error(`${filename} must contain a [toolchain] table`);
    return values;
}
function splitAssignment(line, filename) {
    const separator = findOutsideString(line, '=');
    if (separator < 0)
        throw new Error(`Invalid assignment in ${filename}: ${line.trim()}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key) || value.length === 0) {
        throw new Error(`Invalid assignment in ${filename}: ${line.trim()}`);
    }
    return { key, value };
}
function requireKnownKey(key, filename) {
    if (!['channel', 'components', 'path', 'profile', 'targets'].includes(key)) {
        throw new Error(`Unsupported toolchain key ${JSON.stringify(key)} in ${filename}`);
    }
}
function setValue(values, key, value, filename) {
    if (values.has(key))
        throw new Error(`Duplicate toolchain key ${JSON.stringify(key)} in ${filename}`);
    values.set(key, value);
}
function parseValue(value, filename) {
    const trimmed = value.trim();
    if (trimmed.startsWith('['))
        return parseStringArray(trimmed, filename);
    return parseString(trimmed, filename);
}
function parseStringArray(value, filename) {
    if (!value.endsWith(']'))
        throw new Error(`Unterminated array in ${filename}`);
    const items = [];
    let index = 1;
    while (index < value.length - 1) {
        index = skipWhitespace(value, index);
        if (value[index] === ']')
            break;
        const parsed = parseStringAt(value, index, filename);
        items.push(parsed.value);
        index = skipWhitespace(value, parsed.next);
        if (value[index] === ',') {
            index += 1;
            continue;
        }
        if (value[index] !== ']')
            throw new Error(`Expected a comma in an array in ${filename}`);
    }
    index = skipWhitespace(value, index);
    if (value[index] !== ']' || value.slice(index + 1).trim().length > 0) {
        throw new Error(`Invalid array in ${filename}`);
    }
    return items;
}
function parseString(value, filename) {
    const parsed = parseStringAt(value, 0, filename);
    if (value.slice(parsed.next).trim().length > 0) {
        throw new Error(`Invalid string value in ${filename}`);
    }
    return parsed.value;
}
function parseStringAt(value, start, filename) {
    const quote = value[start];
    if (quote !== '"' && quote !== "'") {
        throw new Error(`Expected a quoted string in ${filename}`);
    }
    let escaped = false;
    for (let index = start + 1; index < value.length; index += 1) {
        const character = value[index];
        if (quote === '"' && character === '\\' && !escaped) {
            escaped = true;
            continue;
        }
        if (character === quote && !escaped) {
            const raw = value.slice(start, index + 1);
            return {
                next: index + 1,
                value: quote === '"' ? parseBasicString(raw, filename) : raw.slice(1, -1)
            };
        }
        escaped = false;
    }
    throw new Error(`Unterminated string in ${filename}`);
}
function parseBasicString(value, filename) {
    try {
        return JSON.parse(value);
    }
    catch {
        throw new Error(`Unsupported string escape in ${filename}`);
    }
}
function isCompleteValue(value) {
    let quote;
    let escaped = false;
    let depth = 0;
    for (const character of value) {
        if (quote) {
            if (quote === '"' && character === '\\' && !escaped) {
                escaped = true;
                continue;
            }
            if (character === quote && !escaped)
                quote = undefined;
            escaped = false;
            continue;
        }
        if (character === '"' || character === "'")
            quote = character;
        else if (character === '[')
            depth += 1;
        else if (character === ']')
            depth -= 1;
    }
    return quote === undefined && depth === 0;
}
function stripComment(line) {
    const comment = findOutsideString(line, '#');
    return comment < 0 ? line : line.slice(0, comment);
}
function findOutsideString(value, sought) {
    let quote;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (quote) {
            if (quote === '"' && character === '\\' && !escaped) {
                escaped = true;
                continue;
            }
            if (character === quote && !escaped)
                quote = undefined;
            escaped = false;
            continue;
        }
        if (character === '"' || character === "'")
            quote = character;
        else if (character === sought)
            return index;
    }
    return -1;
}
function skipWhitespace(value, start) {
    let index = start;
    while (/\s/u.test(value[index] ?? ''))
        index += 1;
    return index;
}
function stringValue(values, key, filename) {
    const value = values.get(key);
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string')
        throw new Error(`${key} must be a string in ${filename}`);
    return value;
}
function arrayValue(values, key, filename) {
    const value = values.get(key);
    if (value === undefined)
        return [];
    if (typeof value === 'string')
        throw new Error(`${key} must be an array in ${filename}`);
    return value;
}
