# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/zactionsz/setup-rust/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include the action commit, runner operating system, relevant inputs, toolchain
file, and a minimal reproduction. Do not include credentials or private
repository data.

## Supported versions

Security fixes are applied to the current major action line. Consumers should
pin a reviewed full commit SHA and update that pin after a fix is released.

## Security boundary

Inputs and repository paths are treated as untrusted data. The action validates
rustup names and its supported toolchain-file subset, rejects working
directories outside `GITHUB_WORKSPACE`, invokes commands without a shell, and
stops when no explicit input or repository toolchain file selects Rust. The
selected channel is forced through `RUSTUP_TOOLCHAIN`, so persistent rustup
directory overrides cannot replace repository policy.

Local path and linked custom toolchains are deliberately unsupported. The
action disables rustup self-update and restores an initially absent global
default after installation.

The action trusts the selected action commit, the runner, the installed rustup
executable, and rustup's configured distribution server. It does not verify the
Rust distribution independently and does not protect a workflow from a
compromised self-hosted runner or a malicious workflow author.
