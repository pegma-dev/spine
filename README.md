# Spine

[![CI](https://github.com/pegma-dev/spine/actions/workflows/ci.yml/badge.svg)](https://github.com/pegma-dev/spine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

The small, stable contracts every [Pegma](https://pegma.dev) component shares.

> [!IMPORTANT]
> Spine is in early `0.x` development. Its public API is not stable, its
> packages are not published, and it is not ready for production use.

## Why it exists

Pegma components are independent packages that a host application composes:
storage, authorization, a support desk, a blog. They must agree on a handful
of things or they cannot be assembled — what a principal identifier is, how
time is read, where a log line goes, what an event looks like.

Spine is the one package everything peers on. It is deliberately tiny and
close to frozen: the more it changes, the more the ecosystem churns.

Everything else belongs in the component that owns it. Storage semantics live
in `@pegma/storage-core`. Permission semantics live in
`@pegma/authorization-core`.

## What is in it

| Export                               | Purpose                                     |
| ------------------------------------ | ------------------------------------------- |
| `PrincipalId`, `IsoTimestamp`        | Shared identity and time types              |
| `Clock`, `systemClock`, `fixedClock` | Time as an injected input, fixable in tests |
| `Logger`, `noopLogger`               | One-method structured logging port          |
| `defineEvent`, `EventDefinition`     | Typed event declarations                    |
| `EventBus`, `createEventBus`         | Best-effort in-process notification bus     |

## Events come in two tiers

**Notifications** — this package. In-process, best effort. Cache
invalidation, metrics, coordination inside one request. A notification that is
lost costs nothing.

**Durable events** — not this package. Anything that must survive a crash
(outbound mail, entitlement changes, webhook deliveries) is written to an
outbox in the same operation as the state change and delivered by a
dispatcher. That belongs to `@pegma/storage-core`, because it needs
persistence to be correct.

The two are separate APIs on purpose. An in-process bus is perfectly reliable
on a developer's machine and silently lossy in production, so the choice
between tiers should be visible in the code rather than left to memory.

## Example

```ts
import { createEventBus, defineEvent, type PrincipalId } from "@pegma/spine";

interface AccountCreated {
  readonly principalId: PrincipalId;
  readonly email: string;
}

// Declared in a component's contracts package and exported as a constant, so
// publishers and subscribers are checked against the same type.
const AccountCreated = defineEvent<AccountCreated>("account.created");

// Wired once at the host's composition root.
const bus = createEventBus();

bus.subscribe(AccountCreated, (envelope) => {
  welcomeCache.invalidate(envelope.payload.principalId);
});

await bus.publish(AccountCreated, {
  principalId: "account_123",
  email: "customer@example.com",
});
```

Handlers run in subscription order, one at a time, and `publish` resolves once
they have settled. A handler that throws is reported to the logger and does
not stop the handlers after it; `publish` never rejects.

## Design principles

- **Small and stable:** Every addition here is a change every component
  inherits. Prefer letting a component own a type until a second component
  genuinely needs it.
- **Ports, not implementations:** Spine defines what a clock, logger, and bus
  are. Hosts supply real ones.
- **Explicit wiring:** Subscriptions are registered at a composition root, not
  discovered by convention. The wiring file is the map of the system.
- **No dynamic event names:** Events are typed constants, so a single search
  finds every publisher and subscriber.
- **No dependencies:** Spine has no runtime dependencies and never will.

## Not here yet

A shared error taxonomy is deliberately deferred. `@pegma/storage-core` will
be the first package to need conflict and not-found semantics, and its real
requirements should shape the contract rather than a guess made in advance.

## Development

Spine requires Node.js 22 or newer.

```sh
npm ci
npm run check
npm test
npm run format:check
```

## License

[MIT](LICENSE) © 2026 RetireGolden, LLC
