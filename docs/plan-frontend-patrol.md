# Plan: Frontend Skills + Profiles (implements `docs/spec-frontend-patrol.md` rev.2)

Wave proposal: one Wave, four shippable Works (A–D), in dependency order
A → B → C → D. Each Work is independently buildable, verifiable, and
shippable; later Works never rewrite earlier Works' artifacts, only add.

Agent for build: `agentpatrol/developer` (A–C touch `agentpatrol/` and
`contextpatrol/` repos) and `agentpatrol/frontend-engineer` once Slice A
ships (D touches `apps/web` + `packages/ui`). Build-review: `qa-engineer`.
No new runtime dependencies in any Work (spec §3).

## 0. Delta from current (what exists, what changes)

Exists and is reused, not rebuilt:

- Skill shape: `skills/<id>/SKILL.md` frontmatter (`name, description,
  license`) + `Purpose / When to use / Inputs / Output / Rules`
  (reference: `skills/name-interaction-evidence/SKILL.md`).
- Builder: `src/` dependency-free; `agents/<id>/agent.json` skill arrays in
  descriptor order; `plugins/` + `dist/` generated, never hand-edited
  (`agentpatrol/AGENTS.md`).
- Lean pattern: `developer-lean/agent.json` (4 skills) is the template for
  `frontend-engineer-lean`.
- ContextPatrol request fields: `facets`, `maxOutputBytes`, `sourceDepth`,
  `ranking`, `includePaths` (`schemas/query-request.schema.json:18-104`).
  Profiles in both `codepatrol.json` files carry only the first three.
- Lastro evidence runners already present: `bun test + jsdom + RTL`,
  Playwright Desktop-Chrome (`playwright.config.ts`), axe in `packages/ui`
  (contrast currently disabled).

Changes per Work are listed below. Nothing else moves.

## Work A — Mandatory disciplines + agent composition

Scope: `agentpatrol/` only.

1. Author `skills/frontend-a11y-check/SKILL.md` per spec §4.1 (lifecycle:
   `build`, `build-review`; output: per-element verdicts with reproduce
   command; rules: native control/role, label association,
   `aria-describedby`, focus enter/restore, `Escape`, `aria-modal`,
   `role=status/live` vs `role=alert`, table captions, chart text
   alternative, axe run via `name-interaction-evidence` with contrast on).
2. Author `skills/design-token-discipline/SKILL.md` per spec §4.2
   (single source `packages/ui/src/tokens.ts`; reuse from `@lastro/ui`;
   dark via `themeVariables(theme)`; color never sole signal;
   `tabular-nums`; `Mark known ceilings` escape format:
   `// Mark known ceilings: <reason> (<criterion-id>)` on the preceding
   line, matching spec criterion 5).
3. Apply the `architecture-vocabulary` amendment with the exact spec wording
   (Rules first bullet replacement; backend behavior unchanged).
4. Update `agents/frontend-engineer/agent.json` to the final array
   (new skills at positions 4–5 per spec criterion 1):
   `test-first, minimal-implementation, preserve-access-paths,
   frontend-a11y-check, design-token-discipline, name-interaction-evidence,
   root-cause-first, evidence-based-completion, answer-by-prototype,
   write-observable-interaction, detect-interaction-drift`.
   NOTE: the two review skills go last so the implement-first ordering in
   `agentcontext/instructions.md` stays causal (implement → evidence →
   specify/drift-check). Update `agents/frontend-engineer/agentcontext/
   instructions.md` ordered list to 11 items accordingly.
5. Add `agents/frontend-engineer-lean/` (`agent.json` with the 4 skills per
   spec §4.7 + `agentcontext/instructions.md` mirroring `developer-lean`
   brevity: test-first → minimal → access-paths → a11y-check).

Minimal-implementation (reuse ladder): no new modules — skill text only,
plus array edits. No `src/` builder change; no schema change.

Acceptance mapping: spec criteria 1, 2 (for the four skills named there),
3. Negative path: `agentpatrol/developer` resolution output is byte-identical
before/after (no descriptor touched).

Name-verification (exact commands, run in `agentpatrol/`):

- `npm run agents:build && npm run agents:check && npm run agents:validate`
  → exit 0.
- `ls plugins/frontend-engineer/skills` → contains the 11 expected dirs.
- `printf '%s'
  '{"schemaVersion":1,"reference":"agentpatrol/frontend-engineer","version":"1.0.0"}'
  | node bin/agentpatrol.js resolve --json` → skills[3,4] are the two new IDs.
- `node bin/agentpatrol.js list --json` → one
  `agentpatrol/frontend-engineer-lean` entry with 4 skills.
- `npm run verify && npm run release-check` → exit 0.

Context for build: `ui-surface` hints are not yet available (Slice C);
use `build-work` equivalent (`symbols, source, tests`) over
`agents/frontend-engineer/` + `skills/preserve-access-paths/`.

## Work B — Opt-in disciplines

Scope: `agentpatrol/skills/` only. No `agent.json` changes.

1. Author `skills/responsive-interaction/SKILL.md` (spec §4.3): viewport
   matrix 360/768/1280 declared in plan, proven in build-review; NDJSON-style
   verdict table (viewport + command + pass/fail); reduced-motion rule.
2. Author `skills/visual-regression-evidence/SKILL.md` (spec §4.4): one claim
   = one screenshot artifact; Playwright `page.screenshot` path convention
   `e2e/__screenshots__/<route>-<viewport>.png`; wired through
   `name-interaction-evidence` / `evidence-based-completion`; never claim
   visual pass without artifact.
3. Author `skills/form-validation-observable/SKILL.md` (spec §4.5): per-field
   state table; `amountMinor` client parse before submit; free-typed IDs
   require autocomplete/validation or explicit non-goal; submit disabled
   during `refresh()`; errors via `aria-describedby` + `role=alert`.
4. Author `skills/web-vitals-budget/SKILL.md` (spec §4.6): budget declaration
   in plan (LCP/CLS/INP numbers + bundle delta limit); Lighthouse CI +
   bundle commands as named evidence in build-review/ship.
5. Extend `skills/test-first/SKILL.md` with a frontend evidence paragraph
   (RTL + jest-axe + Playwright examples, runner not mandated).
   Extend `skills/detect-interaction-drift/SKILL.md` with the visual-drift
   clause → `visual-regression-evidence`.

Reuse ladder: text-only additions; the only edits to existing files are the
two appended paragraphs (quoted verbatim in the build result).

Acceptance mapping: builder gates green (spec criterion 2 shape, applied to
all six new skills after A+B); `agents:check` proves generated plugins match.

Name-verification: the same builder commands as Work A (build/check/
validate, `ls plugins`, `resolve`, `list`, verify/release-check); plus
`ls skills | wc -l` → 35 (29 + 6). `agents:validate` covers unreferenced
skills, so the four opt-in skills are validated even though no agent
descriptor lists them yet.

## Work C — ContextPatrol frontend recipes

Scope: `contextpatrol/codepatrol.json` + `lastro/codepatrol.json` +
`contextpatrol/test/profiles.test.ts` + recipe docs. No `src/` change.

1. In `contextpatrol/codepatrol.json:contextPatrol.profiles`, add stored
   profiles (only allowed keys):
   - `ui-surface`: `facets[symbols, relations, source, tests]`,
     `maxOutputBytes 19200` (no `sourceDepth` key = `full` default).
   - `ui-tokens`: `facets[structure, symbols, source]`,
     `maxOutputBytes 12800`, `sourceDepth signatures`.
   - `ui-flow`: `facets[structure, relations, source, tests]`,
     `maxOutputBytes 19200`.
2. Mirror the same three objects in `lastro/codepatrol.json:
   contextPatrol.profiles`. No `defaults` change in either file.
3. Record query-time hints (b) in a new `contextpatrol/docs/frontend-recipes.md`
   (one short section per recipe, exact hint JSON from spec §5 table):
   `ui-surface` ranking hints; `ui-tokens` + `ui-flow` includePaths.
4. Extend `test/profiles.test.ts` mirroring existing assertions:
   stored-profile shape asserts + one round-trip query per recipe
   (profile + hints) asserting single canonical JSON, `outputBytes ≤
   maxOutputBytes`, and `requestDigest` stability on repeat; `ui-tokens`
   asserts `snippets[].path` includes `packages/ui/src/tokens.ts`.

Acceptance mapping: spec criteria 6, 7, 8.

Name-verification (in `contextpatrol/`):

- `npm run verify && npm run release-check` → exit 0.
- Three `query --input -` runs (request JSONs recorded in the build result)
  → one JSON report each on stdout, byte budgets respected, repeat digests
  equal.

## Work D — Pilot (proves the system on real Lastro debt)

Scope: `lastro` only (`apps/web`, `packages/ui`). Requires A+B shipped
(skills resolvable) and C shipped (recipes queryable). Opened explicitly
with `build open --agents agentpatrol/frontend-engineer@1.0.0` (Lastro
`defaults.build` is `developer`, so the override is required).

1. Extract shared `Field` (currently duplicated in
   `apps/web/src/components/create-dialogs.tsx:215-225` vs inline labels in
   `settle-dialogs.tsx:70-98`) into `packages/ui` (new `field.tsx`, export
   from `index.ts`), replace both call sites. Token-discipline: no new hex
   values; reuse `tokens.ts`; `tabular-nums` preserved.
2. Enable axe in `apps/web` (dev): add jest-axe coverage for dialog open /
   close / error paths with contrast **enabled** (contrast stays on per
   spec §4.1 — the `packages/ui` `disabled` exception is not copied).
3. Record evidence per new skills: a11y verdicts per changed element
   (`frontend-a11y-check`), viewport matrix 360/768/1280
   (`responsive-interaction`), screenshots for dialog states
   (`visual-regression-evidence`), form state table
   (`form-validation-observable`).
4. Paired measurement: run the same change description through `build-work`
   vs `ui-surface` (+hints) snapshots and report which surfaced
   `field.tsx` duplication + token paths first (WAVE-5.1 protocol), as an
   advisory note in the build result — not a gate.

Acceptance mapping: spec criteria 4, 5 (via the exact `rg` command),
plus regression: `bun run check`, `turbo run test
--filter=@lastro/ui,@lastro/web`, existing Playwright spec green.

Name-verification (in `lastro/`):

- `bun install --frozen-lockfile && bun run check` → exit 0.
- `rg -n '#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|box-shadow:|border-radius:'
  --glob '!packages/ui/src/tokens.ts' apps/web/src packages/ui/src`
  → no matches except lines with preceding `Mark known ceilings:` comment.
- RTL + axe suite via `bun test src/__tests__` in `apps/web`
  (criterion-4 evidence = RTL axe assertions per changed element)
  + `npx playwright test` → green.

## Non-goals (restated, binding on all Works)

No financial/API/MCP/persistence change; no runtime deps; no engine/facet/
`SOURCE_EXTENSIONS` change; no Tailwind/Radix migration; no i18n; no store/
cache/pagination/URL-state; no hand edits to `plugins/` or `dist/`;
no `defaults` flips.

## Build result notes (Work D pilot, advisory — not a gate)

Measured 2026-09-04 on the Lastro working tree, same query
("shared Field component dialog form labels"):

- `build-work` (19200B, no hints): `limited=true`, 19170B, `snippets=[]` —
  repo-wide symbols crowd out excerpts.
- `ui-surface` (19200B + ranking hints): `limited=true`, 19198B,
  86 symbols of which 45 are `apps/web`, `tests.files` ranks
  `apps/web/e2e/dialogs-viewports.spec.ts` and `expense-workflow.spec.ts`
  up — ranking works, but relations/snippets still truncate at repo scale.
- `ui-tokens` (12800B + `includePaths`): `limited=false`, 3000B,
  `snippets=[layout.tsx, button.tsx, tokens.ts]` — scoped `includePaths`
  is what makes a recipe decisive at repo scale.

Follow-up signal for a later cycle: `ui-surface` wants either scoped
`includePaths` (e.g. per-Work component paths) or a larger byte budget;
ranking alone does not survive truncation. `defaults` flip stays deferred.

Evidence recorded: `bun run check` green in `apps/web` (incl. `next
build`) and `packages/ui`; RTL axe suite with contrast enabled
(`src/__tests__/dialogs-a11y.test.tsx`, 3 tests); Playwright viewport
matrix 360/768/1280 green with screenshots at
`apps/web/e2e/__screenshots__/dialog-{360,768,1280}.png`; full e2e
(6 tests) green — no regression in the refactored dialogs.

## Residual ambiguities for build (not blocking, recorded pre-build)

- Screenshot storage: Playwright `e2e/__screenshots__/` is the default;
  if the harness provides a snapshot service, record its URI instead —
  either satisfies §4.4.
- Lighthouse CI is not installed; Work B/D may vendor the command as
  `npx lighthouse` (dev-only, allowed) without adding a dependency; if
  unavailable offline, record budget verdicts via bundle-size + manual
  reservation rationale and mark the Lighthouse leg pending.
- `Field` API shape (props, error slot) is a build decision within
  token/a11y constraints; any shape satisfying criteria 4–5 passes.
