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
exports.resolveWorkspacePaths = resolveWorkspacePaths;
exports.relativeSource = relativeSource;
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
const TOOLCHAIN_FILES = Object.freeze(['rust-toolchain', 'rust-toolchain.toml']);
async function resolveWorkspacePaths(workspaceValue, workingDirectoryValue) {
    const workspace = await (0, promises_1.realpath)(path.resolve(workspaceValue));
    const requested = path.resolve(workspace, workingDirectoryValue);
    const workingDirectory = await (0, promises_1.realpath)(requested);
    const details = await (0, promises_1.stat)(workingDirectory);
    if (!details.isDirectory()) {
        throw new Error(`working-directory is not a directory: ${workingDirectoryValue}`);
    }
    if (!isWithin(workspace, workingDirectory)) {
        throw new Error('working-directory must remain inside GITHUB_WORKSPACE');
    }
    return {
        toolchainFile: await findToolchainFile(workspace, workingDirectory),
        workingDirectory,
        workspace
    };
}
function relativeSource(workspace, file) {
    const relative = path.relative(workspace, file);
    return relative.length === 0 ? path.basename(file) : relative.split(path.sep).join('/');
}
async function findToolchainFile(workspace, workingDirectory) {
    let current = workingDirectory;
    while (isWithin(workspace, current)) {
        for (const filename of TOOLCHAIN_FILES) {
            const candidate = path.join(current, filename);
            if (await exists(candidate))
                return candidate;
        }
        if (current === workspace)
            break;
        current = path.dirname(current);
    }
    return undefined;
}
function isWithin(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}
async function exists(file) {
    try {
        await (0, promises_1.access)(file);
        return true;
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT')
            return false;
        throw error;
    }
}
function isNodeError(error) {
    return error instanceof Error;
}
