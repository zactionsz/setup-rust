"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installRustupToolchain = installRustupToolchain;
const contracts_1 = require("./contracts");
const MINIMUM_RUSTUP = Object.freeze([1, 28, 0]);
const MINIMUM_RUSTUP_TEXT = MINIMUM_RUSTUP.join('.');
async function installRustupToolchain(request, runCommand) {
    const neutralEnvironment = { ...request.environment };
    delete neutralEnvironment.RUSTUP_TOOLCHAIN;
    const rustupVersionResult = await runCommand('rustup', ['--version'], {
        cwd: request.cwd,
        environment: neutralEnvironment,
        quiet: true
    });
    const rustupVersion = firstVersionLine(rustupVersionResult, 'rustup');
    requireSupportedRustup(rustupVersion);
    const hadDefault = await hasDefaultToolchain(runCommand, request.cwd, neutralEnvironment);
    const installEnvironment = {
        ...neutralEnvironment,
        RUSTUP_AUTO_INSTALL: '0',
        RUSTUP_TOOLCHAIN: request.toolchain
    };
    try {
        await runCommand('rustup', buildInstallArguments(request), {
            cwd: request.cwd,
            environment: installEnvironment
        });
    }
    finally {
        if (!hadDefault) {
            await runCommand('rustup', ['default', 'none'], {
                cwd: request.cwd,
                environment: neutralEnvironment,
                quiet: true
            });
        }
    }
    const active = await runCommand('rustup', ['show', 'active-toolchain'], {
        cwd: request.cwd,
        environment: installEnvironment,
        quiet: true
    });
    const toolchain = parseActiveToolchain(active.stdout);
    const selectedEnvironment = { ...installEnvironment, RUSTUP_TOOLCHAIN: toolchain };
    if (!request.update) {
        await addRequestedItems(request, toolchain, selectedEnvironment, runCommand);
    }
    return { environment: selectedEnvironment, rustupVersion, toolchain };
}
function buildInstallArguments(request) {
    const arguments_ = [
        'toolchain',
        'install',
        request.toolchain,
        '--profile',
        request.profile,
        '--no-self-update'
    ];
    if (request.update) {
        if (request.components.length > 0) {
            arguments_.push('--component', request.components.join(','));
        }
        if (request.targets.length > 0)
            arguments_.push('--target', request.targets.join(','));
        if (request.allowDowngrade)
            arguments_.push('--allow-downgrade');
    }
    else {
        arguments_.push('--no-update');
    }
    return arguments_;
}
async function addRequestedItems(request, toolchain, environment, runCommand) {
    if (request.components.length > 0) {
        await runCommand('rustup', ['component', 'add', ...request.components, '--toolchain', toolchain], { cwd: request.cwd, environment });
    }
    if (request.targets.length > 0) {
        await runCommand('rustup', ['target', 'add', ...request.targets, '--toolchain', toolchain], {
            cwd: request.cwd,
            environment
        });
    }
}
async function hasDefaultToolchain(runCommand, cwd, environment) {
    const result = await runCommand('rustup', ['toolchain', 'list'], {
        cwd,
        environment,
        quiet: true
    });
    return result.stdout.split(/\r?\n/u).some((line) => /\((?:active, )?default\)$/u.test(line.trim()));
}
function requireSupportedRustup(versionLine) {
    const match = /^rustup (\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(versionLine);
    if (!match)
        throw new Error(`rustup reported an unsupported version line: ${versionLine}`);
    const actual = match.slice(1, 4).map(Number);
    for (let index = 0; index < MINIMUM_RUSTUP.length; index += 1) {
        const difference = (actual[index] ?? 0) - (MINIMUM_RUSTUP[index] ?? 0);
        if (difference > 0)
            return;
        if (difference < 0) {
            throw new Error(`setup-rust requires rustup ${MINIMUM_RUSTUP_TEXT} or newer; found ${versionLine}`);
        }
    }
}
function parseActiveToolchain(stdout) {
    const candidate = stdout.trim().split(/\s+/u)[0];
    if (!candidate)
        throw new Error('rustup did not report an active toolchain');
    try {
        const toolchain = (0, contracts_1.optionalInstallableToolchain)(candidate);
        if (toolchain)
            return toolchain;
    }
    catch {
        throw new Error(`rustup reported an unsupported active toolchain ${JSON.stringify(candidate)}`);
    }
    throw new Error('rustup reported an empty active toolchain');
}
function firstVersionLine(result, command) {
    const line = result.stdout.split(/\r?\n/u).find((candidate) => candidate.trim().length > 0);
    if (!line)
        throw new Error(`${command} did not report a version`);
    return line.trim();
}
