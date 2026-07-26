import { describe, expect, it } from "vitest";

import {
  createEventBus,
  defineEvent,
  fixedClock,
  noopLogger,
  type EventEnvelope,
  type LogLevel,
  type Logger,
  type PrincipalId,
} from "./index.js";

interface AccountCreated {
  readonly principalId: PrincipalId;
  readonly email: string;
}

const AccountCreated = defineEvent<AccountCreated>("account.created");

interface RecordedLog {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

function recordingLogger(): Logger & { readonly entries: RecordedLog[] } {
  const entries: RecordedLog[] = [];
  return {
    entries,
    log: (level, message, fields) => {
      entries.push(
        fields === undefined ? { level, message } : { level, message, fields },
      );
    },
  };
}

const payload: AccountCreated = {
  principalId: "account_123",
  email: "customer@example.com",
};

function testBus(logger: Logger = noopLogger) {
  let counter = 0;
  return createEventBus({
    clock: fixedClock("2026-07-26T13:00:00.000Z"),
    logger,
    newId: () => `evt_${++counter}`,
  });
}

describe("defineEvent", () => {
  it("carries the event name", () => {
    expect(AccountCreated.name).toBe("account.created");
  });
});

describe("fixedClock", () => {
  it("always reports the same instant", () => {
    const clock = fixedClock("2026-07-26T13:00:00.000Z");
    expect(clock.now()).toBe("2026-07-26T13:00:00.000Z");
    expect(clock.now()).toBe("2026-07-26T13:00:00.000Z");
  });
});

describe("createEventBus", () => {
  it("delivers the payload to a subscriber", async () => {
    const bus = testBus();
    const received: AccountCreated[] = [];
    bus.subscribe(AccountCreated, (envelope) => {
      received.push(envelope.payload);
    });

    await bus.publish(AccountCreated, payload);

    expect(received).toEqual([payload]);
  });

  it("stamps id, name, and time from the injected clock", async () => {
    const bus = testBus();
    const envelopes: EventEnvelope<AccountCreated>[] = [];
    bus.subscribe(AccountCreated, (envelope) => {
      envelopes.push(envelope);
    });

    await bus.publish(AccountCreated, payload);

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.id).toBe("evt_1");
    expect(envelopes[0]?.name).toBe("account.created");
    expect(envelopes[0]?.occurredAt).toBe("2026-07-26T13:00:00.000Z");
  });

  it("includes a correlation id only when one is supplied", async () => {
    const bus = testBus();
    const envelopes: EventEnvelope<AccountCreated>[] = [];
    bus.subscribe(AccountCreated, (envelope) => {
      envelopes.push(envelope);
    });

    await bus.publish(AccountCreated, payload, { correlationId: "req_9" });
    await bus.publish(AccountCreated, payload);

    expect(envelopes[0]?.correlationId).toBe("req_9");
    expect(envelopes[1] !== undefined && "correlationId" in envelopes[1]).toBe(
      false,
    );
  });

  it("runs handlers in subscription order", async () => {
    const bus = testBus();
    const order: string[] = [];
    bus.subscribe(AccountCreated, () => {
      order.push("first");
    });
    bus.subscribe(AccountCreated, () => {
      order.push("second");
    });

    await bus.publish(AccountCreated, payload);

    expect(order).toEqual(["first", "second"]);
  });

  it("awaits asynchronous handlers before resolving", async () => {
    const bus = testBus();
    let settled = false;
    bus.subscribe(AccountCreated, async () => {
      await Promise.resolve();
      settled = true;
    });

    await bus.publish(AccountCreated, payload);

    expect(settled).toBe(true);
  });

  it("logs a failing handler and still runs the rest", async () => {
    const logger = recordingLogger();
    const bus = testBus(logger);
    const reached: string[] = [];
    bus.subscribe(AccountCreated, () => {
      throw new Error("handler exploded");
    });
    bus.subscribe(AccountCreated, () => {
      reached.push("second");
    });

    await expect(bus.publish(AccountCreated, payload)).resolves.toBeUndefined();

    expect(reached).toEqual(["second"]);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.level).toBe("error");
    expect(logger.entries[0]?.fields?.["event"]).toBe("account.created");
    expect(logger.entries[0]?.fields?.["eventId"]).toBe("evt_1");
  });

  it("stops delivery after unsubscribe", async () => {
    const bus = testBus();
    const received: AccountCreated[] = [];
    const unsubscribe = bus.subscribe(AccountCreated, (envelope) => {
      received.push(envelope.payload);
    });

    await bus.publish(AccountCreated, payload);
    unsubscribe();
    await bus.publish(AccountCreated, payload);

    expect(received).toHaveLength(1);
  });

  it("tolerates unsubscribing twice without disturbing later subscribers", async () => {
    const bus = testBus();
    const unsubscribe = bus.subscribe(AccountCreated, () => {});
    unsubscribe();
    unsubscribe();

    const received: AccountCreated[] = [];
    bus.subscribe(AccountCreated, (envelope) => {
      received.push(envelope.payload);
    });
    await bus.publish(AccountCreated, payload);

    expect(received).toEqual([payload]);
  });

  it("ignores events with no subscribers", async () => {
    const bus = testBus();

    await expect(bus.publish(AccountCreated, payload)).resolves.toBeUndefined();
  });

  it("does not deliver an in-flight event to a handler added during dispatch", async () => {
    const bus = testBus();
    const late: AccountCreated[] = [];
    bus.subscribe(AccountCreated, () => {
      bus.subscribe(AccountCreated, (envelope) => {
        late.push(envelope.payload);
      });
    });

    await bus.publish(AccountCreated, payload);
    expect(late).toHaveLength(0);

    await bus.publish(AccountCreated, payload);
    expect(late).toHaveLength(1);
  });

  it("keeps separate events isolated", async () => {
    const bus = testBus();
    const other = defineEvent<{ readonly ticketId: string }>("ticket.created");
    const received: string[] = [];
    bus.subscribe(AccountCreated, () => {
      received.push("account");
    });
    bus.subscribe(other, () => {
      received.push("ticket");
    });

    await bus.publish(other, { ticketId: "ticket_01" });

    expect(received).toEqual(["ticket"]);
  });
});
