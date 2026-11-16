# Incord architecture

## Purpose and scale

An offline-first Scripture and catechism memory PWA for a family and a few users.
This documents the approved debt refactor, not a new product direction.

## Data and invariants

IndexedDB owns offline items and review events. Sync reconciles items by revision,
preferences by per-field clocks, and append-only review events by identity.
Canonical source keys determine ordering. Explicit ownership confirmation gates
sync of device-only items. ESV quotations stay device-only; server records contain
references, never quotation text. Persistent Worker names, Durable Object class
names/bindings, migration history and storage keys must not change.

## Components and boundaries

- `shared/domain/`: IO-free planning, ordering, catalog and settings definitions.
  Book loading is injected; neither transport owns duplicate domain algorithms.
- `src/engine/`: pure practice and scheduling. `src/config/`: product copy/rules.
- Frontend screens and typed controllers compose practice, account, navigation
  and sync without changing their existing lifecycle/state contracts.
- `src/store.ts`: IndexedDB and HTTP edges, with shared reconciliation.
- Worker routing/authentication, persistence objects and push/cron modules form
  one deploy. MCP is a transport adapter; Groups calls the catalog service directly.
- SQLite Durable Objects own account, registry, group, statistics and OAuth data.
  Static assets bypass application routing except documented dynamic paths.

## Configuration and adapters

One neutral Wrangler base can run with only SESSION_SECRET and code accounts.
Optional provider bindings, ESV, push and feedback mail are configuration.
Jesklabs-specific origins, legacy host migration and Accounts service wiring live
at the optional adapter/production-overlay edge. Production configuration is
composed from base plus overlay rather than copied. Tunables remain compile-time
unless already supplied through Worker configuration; runtime policy is parked debt.

## One app, one home

One repository, one application Worker and its built assets; reminders use its
cron. The separate stateless legacy-redirect Worker is necessary to retire the old
hostname while allowing the main application to enforce its canonical host and
asset-first routing. It stores no application data. Optional Accounts is a provider
edge, not required infrastructure for a fork. Agent-assisted operational reviews
are outside the app; no application workflow depends on them.

## Extension points and non-goals

Catalog entries extend registries, not parallel algorithms. Providers attach at
edges. This refactor preserves visual behavior, lifecycle contracts and identity;
it does not redesign the practice/account state machines, tab identifiers,
runtime policy, endpoint typing or coverage policy. Legacy Google removal awaits
separate approval and operational observation. No scaling framework or new service.
