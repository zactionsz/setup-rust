# setup-rust

Install and select one reviewed Rust toolchain in GitHub Actions without hidden
cache, compiler-flag, or native-package policy.

The action requires `rustup` on `PATH`, installs the selected toolchain with
argument-safe process execution, exports the fully resolved toolchain through
`RUSTUP_TOOLCHAIN`, and reports the resolved Rust, Cargo, rustup, commit, and
host identities as outputs.

## Usage

Prefer a checked-in `rust-toolchain.toml` as the repository's source of truth:

```toml
[toolchain]
channel = "1.88.0"
profile = "minimal"
components = ["clippy", "rustfmt"]
```

```yaml
- name: Set up Rust
  uses: zactionsz/setup-rust@FULL_COMMIT_SHA
```

An explicit input overrides any repository toolchain file. This is useful for
compatibility and latest-stable jobs:

```yaml
- name: Set up Rust 1.88
  id: rust
  uses: zactionsz/setup-rust@FULL_COMMIT_SHA
  with:
    toolchain: "1.88.0"
    components: rustfmt,clippy
    targets: wasm32-unknown-unknown
```

Pin the action to a full commit SHA. A moving Rust channel such as `stable` is
also explicit moving behavior; use an exact Rust version for reproducible jobs.

## Inputs

| Input | Default | Contract |
| --- | --- | --- |
| `toolchain` | repository file | One rustup toolchain name. Without it, `rust-toolchain` or `rust-toolchain.toml` must exist. |
| `profile` | file setting or `minimal` | `minimal`, `default`, or `complete`. Explicit toolchain installs default to `minimal`. |
| `components` | none | Comma- or whitespace-separated additional rustup components. |
| `targets` | none | Comma- or whitespace-separated additional compilation targets. |
| `working-directory` | `.` | Repository-relative directory from which rustup discovers the nearest toolchain file. |
| `update` | `true` | Update an installed moving toolchain. Set `false` to pass rustup's `--no-update`. |
| `allow-downgrade` | `false` | Allow rustup to select an older release when requested components are unavailable. |

List inputs are deduplicated without reordering. The action invokes rustup
directly with an argument array; input text is never evaluated by a shell.

## Outputs

| Output | Example |
| --- | --- |
| `toolchain` | `1.88.0-x86_64-unknown-linux-gnu` |
| `toolchain-source` | `rust-toolchain.toml` or `input` |
| `rustc-version` | `1.88.0` |
| `rustc-commit` | `6b00bc3880198600130e1cf62b8f8a93494488cc` |
| `cargo-version` | `cargo 1.88.0 (873a06493 2025-05-10)` |
| `rustup-version` | `rustup 1.28.2 (e4f3ad6f8 2025-04-28)` |
| `host` | `x86_64-unknown-linux-gnu` |

The resolved `toolchain` is also exported as `RUSTUP_TOOLCHAIN` for subsequent
steps. This selects Rust without writing a directory override or changing the
runner's global default.

## Deliberate boundaries

This action does not:

- install rustup;
- set `RUSTFLAGS` or other compiler policy;
- cache Cargo registries, Git repositories, or build outputs;
- install Cargo binaries such as `cargo-deny`, `zcheck`, or `zrail`;
- install native packages such as `protoc`, OpenSSL, or libcurl;
- run Cargo commands against the checked-out repository.

Those decisions vary by repository and remain visible in the consuming
workflow or in a dedicated, independently pinned setup action.

## Development

The action is strict TypeScript under `src/`. GitHub executes the committed
CommonJS files under `dist/`; tests import those exact files.

```console
npm ci
scripts/check
npm audit
```

`scripts/check` requires `actionlint`, rebuilds `dist`, validates every emitted
JavaScript file, runs the unit tests, checks workflow syntax, and rejects stale
generated output.
