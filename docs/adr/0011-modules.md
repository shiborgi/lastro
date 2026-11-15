# ADR 11: Vertical Business Modules

**Status:** Accepted (0.1.0)

## Context

Features grew across horizontal layers until one change touched every package.

## Decision

- Code is organized by business module: `core`, `finance`, `sales`, the import modules `finance-imports` and `sales-imports`, and `close`. Each owns its rules, contracts, use cases, persistence port, tables, triggers, operations and screens.
- Dependencies point one way. `finance` and `sales` depend only on `core` and do not know each other; `finance-imports` depends on `finance`, `sales-imports` on `sales`. A view that needs both, such as the daily close, is a module of its own that depends on both (`close`). A module reaches another only through its package root or `/contracts`, after declaring the dependency; its tables reference only its own and its dependencies'. Fitness tests enforce imports and foreign keys.
- A module never knows the modules that depend on it. Adding a module edits no other module. Every module but `core` is optional: the host composes without it and whatever depends on it.
- A module extends one it depends on by contributing data in its manifest (`contributes: { "<module>": [...] }`), delivered at composition to that module's `create`, which checks each item. An import module's parsers arrive this way, so a new parser can be its own package.
- On the web, each module's screens declare the operations they call, and the proxy forwards only those of the registered modules. A module adds actions to another module's views (an import module's upload on the review screen it fills) instead of that module naming it.

## Consequences

- New capabilities arrive as new modules; `docs/extending/adding-a-module.md` is the procedure, and `docs/extending/adding-an-import-flow.md` for a parser.
