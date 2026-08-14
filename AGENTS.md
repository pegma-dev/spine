# Working in this repository

Read this before changing anything. It is short on purpose, and so is the
package.

## What this is part of

Spine holds the small, stable contracts every **Pegma** component shares.
Pegma is a family of MIT-licensed packages a host application composes:
persistence in `@pegma/storage-core`, identity and permissions in
`@pegma/authorization-core`, a support desk and others to follow. They publish
under the `@pegma` scope, one repository per component.

The governing principle, which every rule below follows from:

> **Optimize for a fresh agent context window.** How much must be read to make
> a correct change, and how does the change prove itself correct? Minimize the
> first, mechanize the second.

## Hard rules

**Adding anything here changes every component.** This package is deliberately
tiny and close to frozen. The bar is not "is this useful" but "do at least two
components genuinely need to agree on it". Let a type live in the component
that owns it until a second component needs the same one.

**The event bus is the lossy tier, on purpose.** Handlers run in subscription
order, a throwing handler is logged rather than surfaced, and `publish` never
rejects. Do not add retries, persistence, or delivery guarantees to it. Work
that must survive a crash belongs in a durable outbox written in the same
operation as the state change, which is `@pegma/storage-core`'s job. Making the
in-process bus look reliable would be worse than leaving it obviously not,
because it would be reliable on a developer's machine and lossy in production.

**No runtime dependencies, ever.** Web-standard APIs only, so this runs
unmodified on Node, Workers, Deno, and Bun.

**No dynamic event names and no wildcards.** Events are typed constants
exported from a component's contracts package, so one search finds every
publisher and subscriber, and payload mismatches fail at compile time.

**Never write literal control characters into source.** Write them as escape
sequences such as backslash-u-0000 through backslash-u-001F, and verify the
bytes after any tool-assisted edit.

## Packaging traps already paid for

The published package needs its **own** README and LICENSE inside the package
directory; npm ignores files at the repository root. It needs `prepack`
running the build, or a stale `dist` ships silently. Its `tsconfig.json` must
exclude `src/**/*.test.ts`, or compiled tests are published to consumers.

## Workflow

Work on a `claude/*` branch and open a pull request. The gate is
`pnpm run format:check`, `pnpm run check`, `pnpm test` — all three, on Node 22 and 24.

Publishing is trusted-publisher only; no tokens exist. A release starts from a
protected signed annotated `vX.Y.Z` tag already on `origin/main`, followed by
`gh release create vX.Y.Z --verify-tag`. The unprivileged preparation job runs
the gate and packs the exact artifact; only the minimal publish job receives
OIDC authority. See `docs/RELEASING.md`.

## Where things stand

`@pegma/spine` is published at `0.1.1`: shared identity and time types, a clock
and logger port, typed event declarations, and the in-process bus.

A shared error taxonomy is still deliberately absent. `@pegma/storage-core`
defined its own `StorageError` and `ConcurrencyError` when it needed them; if a
second component wants the same shapes, that is the signal to move them here.

The README describes a durable outbox as `@pegma/storage-core`'s
responsibility. `transact` now exists there, so that is buildable rather than
aspirational, but it has not been built.

Siblings: [storage-core](https://github.com/pegma-dev/storage-core),
[authorization-core](https://github.com/pegma-dev/authorization-core), and the
organization profile at [github.com/pegma-dev](https://github.com/pegma-dev).
