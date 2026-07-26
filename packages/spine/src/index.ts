/**
 * Opaque identifier for a subject that can act in the system.
 *
 * Every Pegma component that needs to name an actor uses this type, so that a
 * principal resolved by one component is the same value another component
 * stores, authorizes, or audits. Hosts choose the format.
 */
export type PrincipalId = string;

/** UTC timestamp in ISO 8601 form, e.g. `2026-07-26T13:00:00.000Z`. */
export type IsoTimestamp = string;

/**
 * Source of the current time.
 *
 * Components take a clock rather than calling `Date.now()` so that time is an
 * input a test can fix.
 */
export interface Clock {
  now(): IsoTimestamp;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

/** A clock that always reports `at`. */
export function fixedClock(at: IsoTimestamp): Clock {
  return { now: () => at };
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Minimal structured logging port.
 *
 * A single method keeps host adapters trivial: map `level` and `fields` onto
 * whatever logger the application already uses.
 */
export interface Logger {
  log(
    level: LogLevel,
    message: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void;
}

export const noopLogger: Logger = {
  log: () => {},
};

/**
 * Dotted, globally unique event name, e.g. `support-desk.ticket.created`.
 *
 * Names are namespaced by component so that a search for one name finds every
 * publisher and subscriber across a host application.
 */
export type EventName = string;

/**
 * A named event and the shape of its payload.
 *
 * Components declare these as exported constants. Publishers and subscribers
 * both reference the constant, so the payload is checked at compile time and
 * every subscription is findable with a single search.
 */
export interface EventDefinition<TPayload> {
  readonly name: EventName;
  /** Type-only carrier for `TPayload`. Never present at runtime. */
  readonly payloadType?: TPayload;
}

export function defineEvent<TPayload>(
  name: EventName,
): EventDefinition<TPayload> {
  return { name };
}

/** Payload type of an event definition. */
export type PayloadOf<TDefinition> =
  TDefinition extends EventDefinition<infer TPayload> ? TPayload : never;

/** A published event and the metadata the bus stamped onto it. */
export interface EventEnvelope<TPayload> {
  readonly id: string;
  readonly name: EventName;
  readonly occurredAt: IsoTimestamp;
  readonly payload: TPayload;
  readonly correlationId?: string;
}

export type EventHandler<TPayload> = (
  envelope: EventEnvelope<TPayload>,
) => void | Promise<void>;

/** Removes a subscription. Safe to call more than once. */
export type Unsubscribe = () => void;

export interface PublishOptions {
  readonly correlationId?: string;
}

/**
 * Best-effort, in-process notification bus.
 *
 * Events published here live only in memory. They are lost if the process
 * exits before handlers run, and a handler that throws is logged rather than
 * surfaced to the publisher. Use it for cache invalidation, metrics, and
 * coordination within a single request.
 *
 * Anything that must not be lost — outbound mail, entitlement changes,
 * webhook deliveries — belongs in a durable outbox written in the same
 * transaction as the state change, not here.
 */
export interface EventBus {
  publish<TPayload>(
    definition: EventDefinition<TPayload>,
    payload: TPayload,
    options?: PublishOptions,
  ): Promise<void>;

  subscribe<TPayload>(
    definition: EventDefinition<TPayload>,
    handler: EventHandler<TPayload>,
  ): Unsubscribe;
}

export interface EventBusOptions {
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly newId?: () => string;
}

type StoredHandler = (envelope: EventEnvelope<never>) => void | Promise<void>;

/**
 * Creates an in-process {@link EventBus}.
 *
 * Handlers run in subscription order, one at a time, and `publish` resolves
 * once they have all settled. A handler that throws is reported to the logger
 * and does not stop the handlers after it; `publish` never rejects.
 */
export function createEventBus(options: EventBusOptions = {}): EventBus {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? noopLogger;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const subscriptions = new Map<EventName, Set<StoredHandler>>();

  return {
    async publish(definition, payload, publishOptions) {
      const handlers = subscriptions.get(definition.name);
      if (handlers === undefined || handlers.size === 0) {
        return;
      }

      const correlationId = publishOptions?.correlationId;
      const envelope: EventEnvelope<typeof payload> = {
        id: newId(),
        name: definition.name,
        occurredAt: clock.now(),
        payload,
        ...(correlationId === undefined ? {} : { correlationId }),
      };

      // Snapshot so that subscribing or unsubscribing inside a handler does
      // not change who receives the event currently being dispatched.
      for (const handler of [...handlers]) {
        try {
          await handler(envelope as EventEnvelope<never>);
        } catch (error) {
          logger.log("error", "Event handler failed", {
            event: definition.name,
            eventId: envelope.id,
            error,
          });
        }
      }
    },

    subscribe(definition, handler) {
      const existing = subscriptions.get(definition.name);
      const handlers = existing ?? new Set<StoredHandler>();
      if (existing === undefined) {
        subscriptions.set(definition.name, handlers);
      }

      // Safe because handlers are keyed by event name, and only a publish for
      // that same definition can reach them.
      const stored = handler as StoredHandler;
      handlers.add(stored);

      return () => {
        handlers.delete(stored);
        if (
          handlers.size === 0 &&
          subscriptions.get(definition.name) === handlers
        ) {
          subscriptions.delete(definition.name);
        }
      };
    },
  };
}
