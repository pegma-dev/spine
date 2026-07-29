# Security Scan Report

Repository: `spine` (`@pegma/spine`)
Date: 2026-07-28
Scope: repository-wide (source, scripts, CI/CD workflows, packaging, dependencies)

Findings are appended as they are discovered during the scan.

---

## Findings Log

### FINDING-001 — Local stale release artifacts in `.release/` (schema-mismatched manifest)

- **Severity:** Informational (corrected from Low after verification)
- **Category:** Repository hygiene / supply-chain integrity
- **Evidence:** `.release/package-manifest.json` and `.release/pegma-spine-0.1.1.tgz` exist in the working tree. `git ls-files .release` returns nothing and `git check-ignore -v` confirms both are ignored via `.gitignore` line 4 (`.release/`) — they are **not** committed to git. The local manifest's schema does not match what the current `scripts/release-packages.mjs` produces: it has `"releaseTag": null` and a `"packages"` array, whereas the current script writes a top-level `"package"` object and requires `releaseTag === "v" + version` (script lines 359–373, 435–445).
- **Exploitability:** Negligible. The files cannot affect CI or publishing (never tracked, `.gitignore`d, and `verifyPreparedManifest` would reject the stale schema). The only residual risk is a local operator manually pointing `release:publish --manifest` at this stale file, which the script's own validation would refuse.
- **File references:** `.release/package-manifest.json`, `.release/pegma-spine-0.1.1.tgz`, `.gitignore:4`, `scripts/release-packages.mjs:432-470`
- **Recommendation:** Optionally delete the local `.release/` directory; no repository change required.

### FINDING-002 — Release job installs npm from the registry pinned by version only

- **Severity:** Low
- **Category:** CI/CD supply chain
- **Evidence:** `.github/workflows/publish.yml` line 57: `npm install --global npm@11.18.0`. The version is pinned but there is no integrity/signature verification of the downloaded npm tarball in a release-critical job that also runs `npm ci` and builds the artifact.
- **Exploitability:** Low. Exploitation would require compromise of the npm registry or the npm@11.18.0 package itself; version pinning prevents silent upgrades, and trusted-publisher OIDC limits token exposure. Registry compromise would affect the entire ecosystem, but this job is a single point where unverified code runs with release-adjacent privileges (though the OIDC token is only granted to the separate `publish` job, mitigating this).
- **File references:** `.github/workflows/publish.yml:56-57`
- **Recommendation:** Acceptable as-is given the OIDC token isolation; optionally verify npm's integrity hash after install or use a corepack-pinned npm.

### FINDING-003 — CI runs `npm ci` on untrusted pull-request code

- **Severity:** Informational (risk accepted and mitigated)
- **Category:** CI/CD supply chain
- **Evidence:** `.github/workflows/ci.yml` triggers on `pull_request` (line 7) and runs `npm ci` (line 38), which executes dependency lifecycle scripts from PR-modified manifests.
- **Exploitability:** Very low. The workflow declares `permissions: contents: read` (lines 9–10), holds no secrets, and has no `id-token: write`, so a malicious install script gains nothing exfiltratable. The release workflow is gated on protected signed tags and does not run on PRs. This is the standard, accepted PR-CI risk profile.
- **File references:** `.github/workflows/ci.yml:7,9-10,38`
- **Recommendation:** None required. Optionally set `ignore-scripts: true` in a committed `.npmrc` if lifecycle scripts are never needed in CI.

### FINDING-004 — README claims the package is unpublished, but `0.1.1` is on npm

- **Severity:** Informational (documentation accuracy, not exploitable)
- **Category:** Documentation / trust signal
- **Evidence:** `README.md:9-10` and `packages/spine/README.md:9-10` state "its packages are not published, and it is not ready for production use." Verified via `npm view @pegma/spine@0.1.1 dist.integrity` that `0.1.1` is published; its integrity (`sha512-EV0Zq8KJX7...`) matches the local `.release/pegma-spine-0.1.1.tgz` byte-for-byte.
- **Exploitability:** None. Stale trust guidance could confuse consumers about the package's maturity, and AGENTS.md (`Where things stand`) already documents the published state correctly.
- **File references:** `README.md:9-10`, `packages/spine/README.md:9-10`, `AGENTS.md`
- **Recommendation:** Update both READMEs' disclaimer to reflect the published `0.1.1` state.

---

## Scan Summary

### Scope covered

- Library source: `packages/spine/src/index.ts` (203 lines — the entire public API)
- Tests: `packages/spine/src/index.test.ts`, `tests/release-packages.test.ts`
- Release tooling: `scripts/release-packages.mjs` (584 lines), `scripts/release-packages.d.mts`
- CI/CD: `.github/workflows/ci.yml`, `codeql.yml`, `publish.yml`
- Packaging: root and package `package.json`, `package-lock.json` (102 entries), tsconfig chain, `.gitignore`, `.gitattributes`, `vitest.config.ts`
- Docs: `README.md`, `packages/spine/README.md`, `docs/RELEASING.md`
- Live checks: `npm audit` (dev + prod), lockfile resolved-URL/integrity sweep, secret-pattern sweep, literal control-character sweep, registry-vs-local tarball integrity comparison

### Result: no vulnerabilities found at Medium severity or above

All four findings are Low or Informational. The repository's security posture is strong:

- **Library code** (`packages/spine/src/index.ts`): no dependencies, no I/O, no eval, no dynamic property access. Subscriptions use a `Map` (immune to prototype pollution via event names like `__proto__`). Event IDs default to `crypto.randomUUID()` (CSPRNG). Handler errors are logged with event name and ID only — payloads are not logged. The error-swallowing bus semantics are documented, deliberate, and consistent with the AGENTS.md design contract.
- **Release tooling** (`scripts/release-packages.mjs`): timing-safe hash comparisons (`timingSafeEqual` with length pre-check), signed-annotated-tag verification via `git verify-tag --raw` against an allowed-signers file, path-traversal guards on the prepared tarball name, `--ignore-scripts` on the smoke-test install, no `shell: true` except the Windows `npm.cmd` fallback with internally-derived static arguments, and no `eval`/`new Function` anywhere.
- **CI/CD**: all actions pinned by full commit SHA, minimal token permissions, OIDC trusted publishing with no token fallback (enforced in docs and by test at `tests/release-packages.test.ts:138-162`), OIDC scope isolated to the publish job only, artifact names keyed by `github.run_id` (no cross-run artifact collision), and retry logic that fails closed on integrity mismatch.
- **Dependencies**: `npm audit` reports **0 vulnerabilities** (with and without dev). Lockfile v3; every non-workspace entry resolves from `https://registry.npmjs.org/` with an integrity hash. The only entry without one is the workspace self-link (`node_modules/@pegma/spine`), which is expected.
- **Secrets**: no credentials, tokens, or private keys anywhere in the tree. `RELEASE_ALLOWED_SIGNERS` is public-key material, correctly stored as a repo variable rather than a secret.
- **Hygiene**: no literal control characters in any tracked source file (per the AGENTS.md rule); `.gitattributes` normalizes LF line endings.

### Verified out-of-band

The published registry artifact `@pegma/spine@0.1.1` has `dist.integrity` and `dist.shasum` identical to the hashes recorded in the local `.release/package-manifest.json` — the published bytes match the reviewed build.

_Scan completed 2026-07-28._
