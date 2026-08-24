"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.input = input;
exports.exportVariable = exportVariable;
exports.setOutput = setOutput;
exports.info = info;
exports.startGroup = startGroup;
exports.endGroup = endGroup;
exports.setFailed = setFailed;
const promises_1 = require("node:fs/promises");
function input(name, environment = process.env) {
    const key = `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`;
    return environment[key] ?? '';
}
async function exportVariable(name, value, environment = process.env) {
    requireSingleLine(name, value);
    environment[name] = value;
    const environmentFile = environment.GITHUB_ENV;
    if (environmentFile)
        await (0, promises_1.appendFile)(environmentFile, `${name}=${value}\n`, 'utf8');
}
async function setOutput(name, value, environment = process.env) {
    requireSingleLine(name, value);
    const outputFile = environment.GITHUB_OUTPUT;
    if (outputFile)
        await (0, promises_1.appendFile)(outputFile, `${name}=${value}\n`, 'utf8');
}
function info(message) {
    process.stdout.write(`${message}\n`);
}
function startGroup(message) {
    process.stdout.write(`::group::${escapeWorkflowCommand(message)}\n`);
}
function endGroup() {
    process.stdout.write('::endgroup::\n');
}
function setFailed(error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`::error::${escapeWorkflowCommand(message)}\n`);
    process.exitCode = 1;
}
function requireSingleLine(name, value) {
    if (/[\r\n\0]/u.test(name) || /[\r\n\0]/u.test(value)) {
        throw new Error(`GitHub output ${JSON.stringify(name)} must be a single line`);
    }
}
function escapeWorkflowCommand(value) {
    return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
