# Contributing

Keep each change small enough to review as one action-contract decision.

Install Node.js 24 and `actionlint`, then run:

```console
npm ci
scripts/check
npm audit
git diff --check
```

Requirements:

- preserve the fail-closed toolchain selection contract;
- pass external values to child processes as arguments, never shell text;
- add a failure-path test for every new input or process boundary;
- keep Cargo tools, native packages, caching, and compiler flags out of scope;
- commit the deterministic `dist/` output when runtime code changes;
- pin every workflow action to a full commit SHA;
- use conventional, OpenPGP-signed commits with no coauthor trailers.

Adding automatic rustup installation, an implicit moving toolchain, arbitrary
command execution, or new workflow permissions changes the security model and
requires explicit design review.
