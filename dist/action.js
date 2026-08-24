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
exports.runAction = runAction;
const contracts_1 = require("./contracts");
const github = __importStar(require("./github"));
const process_1 = require("./process");
const workspace_1 = require("./workspace");
async function runAction(environment = process.env, overrides = {}) {
    const dependencies = { runCommand: process_1.runCommand, ...overrides };
    const inputs = readInputs(environment);
    const workspaceValue = environment.GITHUB_WORKSPACE || process.cwd();
    const paths = await (0, workspace_1.resolveWorkspacePaths)(workspaceValue, inputs.workingDirectory);
    if (!inputs.toolchain && !paths.toolchainFile) {
        throw new Error('No Rust toolchain selected; provide the toolchain input or commit rust-toolchain.toml');
    }
    const toolchainSource = inputs.toolchain
        ? 'input'
        : (0, workspace_1.relativeSource)(paths.workspace, requireValue(paths.toolchainFile));
    const commandEnvironment = { ...environment };
    delete commandEnvironment.RUSTUP_TOOLCHAIN;
    if (inputs.toolchain)
        commandEnvironment.RUSTUP_TOOLCHAIN = inputs.toolchain;
    const installArguments = buildInstallArguments(inputs);
    github.startGroup(`Install Rust toolchain from ${toolchainSource}`);
    try {
        await dependencies.runCommand('rustup', installArguments, {
            cwd: paths.workingDirectory,
            environment: commandEnvironment
        });
    }
    finally {
        github.endGroup();
    }
    const selected = await dependencies.runCommand('rustup', ['show', 'active-toolchain'], {
        cwd: paths.workingDirectory,
        environment: commandEnvironment,
        quiet: true
    });
    const toolchain = parseActiveToolchain(selected.stdout);
    const selectedEnvironment = { ...commandEnvironment, RUSTUP_TOOLCHAIN: toolchain };
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
    ]);
    const rustcDetails = parseRustc(rustc.stdout);
    const result = {
        cargoVersion: firstVersionLine(cargo, 'cargo'),
        host: rustcDetails.host,
        rustcCommit: rustcDetails.commit,
        rustcVersion: rustcDetails.release,
        rustupVersion: firstVersionLine(rustup, 'rustup'),
        toolchain,
        toolchainSource
    };
    await publishResult(result, environment);
    github.info(`Selected Rust ${result.rustcVersion} (${result.host}) from ${result.toolchainSource}`);
    return result;
}
function readInputs(environment) {
    return {
        allowDowngrade: (0, contracts_1.booleanInput)(github.input('allow-downgrade', environment) || 'false', 'allow-downgrade'),
        components: (0, contracts_1.rustupList)(github.input('components', environment), 'components'),
        profile: (0, contracts_1.optionalProfile)(github.input('profile', environment)),
        targets: (0, contracts_1.rustupList)(github.input('targets', environment), 'targets'),
        toolchain: (0, contracts_1.optionalToolchain)(github.input('toolchain', environment)),
        update: (0, contracts_1.booleanInput)(github.input('update', environment) || 'true', 'update'),
        workingDirectory: (0, contracts_1.nonEmptyDirectory)(github.input('working-directory', environment) || '.')
    };
}
function buildInstallArguments(inputs) {
    const arguments_ = ['toolchain', 'install'];
    if (inputs.toolchain)
        arguments_.push(inputs.toolchain);
    const profile = inputs.profile ?? (inputs.toolchain ? 'minimal' : undefined);
    if (profile)
        arguments_.push('--profile', profile);
    if (inputs.components.length > 0) {
        arguments_.push('--component', inputs.components.join(','));
    }
    if (inputs.targets.length > 0)
        arguments_.push('--target', inputs.targets.join(','));
    if (!inputs.update)
        arguments_.push('--no-update');
    if (inputs.allowDowngrade)
        arguments_.push('--allow-downgrade');
    return arguments_;
}
function parseActiveToolchain(stdout) {
    const candidate = stdout.trim().split(/\s+/u)[0];
    if (!candidate)
        throw new Error('rustup did not report an active toolchain');
    const toolchain = (0, contracts_1.optionalToolchain)(candidate);
    if (!toolchain)
        throw new Error('rustup reported an empty active toolchain');
    return toolchain;
}
function parseRustc(stdout) {
    const values = new Map();
    for (const line of stdout.split(/\r?\n/u)) {
        const separator = line.indexOf(':');
        if (separator > 0) {
            values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        }
    }
    return {
        commit: requiredField(values, 'commit-hash', 'rustc --version --verbose'),
        host: requiredField(values, 'host', 'rustc --version --verbose'),
        release: requiredField(values, 'release', 'rustc --version --verbose')
    };
}
function firstVersionLine(result, command) {
    const line = result.stdout.split(/\r?\n/u).find((candidate) => candidate.trim().length > 0);
    if (!line)
        throw new Error(`${command} did not report a version`);
    return line.trim();
}
function requiredField(values, field, source) {
    const value = values.get(field);
    if (!value)
        throw new Error(`${source} did not report ${field}`);
    return value;
}
function requireValue(value) {
    if (value === undefined)
        throw new Error('Internal error: expected a value');
    return value;
}
async function publishResult(result, environment) {
    await github.exportVariable('RUSTUP_TOOLCHAIN', result.toolchain, environment);
    const outputs = {
        'cargo-version': result.cargoVersion,
        host: result.host,
        'rustc-commit': result.rustcCommit,
        'rustc-version': result.rustcVersion,
        'rustup-version': result.rustupVersion,
        toolchain: result.toolchain,
        'toolchain-source': result.toolchainSource
    };
    for (const [name, value] of Object.entries(outputs)) {
        await github.setOutput(name, value, environment);
    }
}
