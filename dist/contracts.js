"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalToolchain = optionalToolchain;
exports.optionalProfile = optionalProfile;
exports.rustupList = rustupList;
exports.booleanInput = booleanInput;
exports.nonEmptyDirectory = nonEmptyDirectory;
const RUSTUP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const PROFILES = new Set(['minimal', 'default', 'complete']);
function optionalToolchain(value) {
    const toolchain = value.trim();
    if (toolchain.length === 0)
        return undefined;
    requireRustupName(toolchain, 'toolchain');
    return toolchain;
}
function optionalProfile(value) {
    const profile = value.trim();
    if (profile.length === 0)
        return undefined;
    if (!PROFILES.has(profile)) {
        throw new Error(`Invalid profile ${JSON.stringify(value)}; expected minimal, default, or complete`);
    }
    return profile;
}
function rustupList(value, inputName) {
    const items = value
        .split(/[\s,]+/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    const unique = [];
    const seen = new Set();
    for (const item of items) {
        requireRustupName(item, inputName);
        if (!seen.has(item)) {
            seen.add(item);
            unique.push(item);
        }
    }
    return Object.freeze(unique);
}
function booleanInput(value, inputName) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true')
        return true;
    if (normalized === 'false')
        return false;
    throw new Error(`Invalid ${inputName} ${JSON.stringify(value)}; expected true or false`);
}
function nonEmptyDirectory(value) {
    const directory = value.trim();
    if (directory.length === 0) {
        throw new Error('working-directory cannot be empty');
    }
    if (/[\r\n\0]/u.test(directory)) {
        throw new Error('working-directory cannot contain newlines or NUL bytes');
    }
    return directory;
}
function requireRustupName(value, inputName) {
    if (!RUSTUP_NAME_PATTERN.test(value)) {
        throw new Error(`Invalid ${inputName} item ${JSON.stringify(value)}; expected a rustup name containing ` +
            'only letters, numbers, periods, underscores, and hyphens');
    }
}
