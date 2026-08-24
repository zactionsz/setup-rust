"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = void 0;
const node_child_process_1 = require("node:child_process");
const runCommand = async (command, arguments_, options) => new Promise((resolve, reject) => {
    const child = (0, node_child_process_1.spawn)(command, arguments_, {
        cwd: options.cwd,
        env: options.environment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (!options.quiet)
            process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (!options.quiet)
            process.stderr.write(chunk);
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => {
        if (code === 0) {
            resolve({ stderr, stdout });
            return;
        }
        const rendered = [command, ...arguments_].map(renderArgument).join(' ');
        const status = signal ? `signal ${signal}` : `exit code ${String(code)}`;
        const details = (stderr.trim() || stdout.trim()).slice(0, 2_000);
        const suffix = details.length > 0 ? `: ${details}` : '';
        reject(new Error(`${rendered} failed with ${status}${suffix}`));
    });
});
exports.runCommand = runCommand;
function renderArgument(value) {
    return /^[A-Za-z0-9_./:@+-]+$/u.test(value) ? value : JSON.stringify(value);
}
