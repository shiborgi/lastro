# Spec: Frontend Skills (AgentPatrol) and Profiles (ContextPatrol) for Lastro

Status: revised after `spec-review` (revision 2). Source of truth for delivery
stays in `docs/architecture.md`. This spec adds no financial behavior.

## 1. Context

Lastro `apps/web` is Next.js 16 + React 19 (`apps/web/package.json:19-21`,
`next.config.ts:3-7`). Observed implementation:

- Styling is 100% inline `style={{...}}` + CSS vars `var(--lastro-*)`. Tokens
  live in `packages/ui/src/tokens.ts:1-66`, injected in
  `apps/web/src/app/layout.tsx:14`. No `globals.css`, no Tailwind/Radix in
  `apps/web`, no dark wiring, no systematic responsive (`maxWidth:72rem` only).
  Target architecture (`docs/architecture.md:86,119-137`) prescribes Tailwind,
  Radix/shadcn-compatible components copied into `packages/ui`, light/dark
  themes, keyboard operation, visible focus, reduced motion, 360px mobile,
  WCAG 2.2 AA.
- Data-fetching is manual `fetch` via `ApiClient` (`apps/web/src/lib/api.ts:48-157`)
  with `useMemo/useEffect/cancelled` in `components/dashboard.tsx:49-92` and
  `components/expense-workflow.tsx:55-80`. `bookId="1"` is hardcoded in
  `app/page.tsx:6-7`. No cache/dedupe, `nextCursor` ignored, no URL state.
- Forms are manual `useState` per field (`components/create-dialogs.tsx:27-44`),
  `Field` duplicated locally (`create-dialogs.tsx:215-225`) vs inline labels in
  `settle-dialogs.tsx:70-98`. No schema validation, no `aria-describedby`,
  no `disabled` during refresh.
- Tests: `bun test + jsdom + RTL` (`__tests__/setup.ts`), `dashboard.test.tsx:1-153`,
  `architecture.test.ts:1-43`, Playwright Desktop-Chrome only
  (`playwright.config.ts:1-19`, `e2e/expense-workflow.spec.ts:1-226`). Axe exists
  only in `packages/ui/src/__tests__/a11y.test.tsx:1-70` with
  `color-contrast: disabled`; no axe in `apps/web`, no visual regression,
  no Web Vitals.

AgentPatrol (`agentpatrol/README.md`, `agents/frontend-engineer/`,
`skills/` — 29 skills): `frontend-engineer` is
`test-first, minimal-implementation, preserve-access-paths,
name-interaction-evidence, root-cause-first, evidence-based-completion,
answer-by-prototype`. It implements but cannot author observable interaction
(`write-observable-interaction` only in `architect/*`) nor self-check drift
(`detect-interaction-drift` only in `qa-engineer`). Zero skill covers
a11y operation, tokens, responsive, visual regression, forms, i18n, perf.
`architecture-vocabulary` forbids the synonym `component`, unusable for React.
`test-first`/`minimal-implementation` are runner-agnostic.

ContextPatrol (`contextpatrol/codepatrol.json:55-154`,
`docs/contextpatrol-wave-5-1-experiment.md`, `schemas/`): 9 generic profiles
(`spec-survey/spec-deep/plan-impact/plan-deep/build-work/build-deep/
review-diff/review-grounded/readiness`). Facets are
`structure/symbols/relations/source/changes/tests`; `relations.kind=imports`
only; CSS is indexed but yields ~no symbols; `SOURCE_EXTENSIONS` lacks
`scss/less/vue/svelte/astro/html`; `tests.ts` regex misses
`*.stories/e2e/playwright/axe`; `ranking` has no UI recipe. Lastro consumes
ContextPatrol with its own profile names in `lastro/codepatrol.json:55-140`
(`requirements/requirements-review/impact/plan-review/implementation/
candidate-review/readiness`).

## 2. Goals

1. Give `frontend-engineer` enforceable, observable disciplines for the six
   gaps that block `docs/architecture.md:133-137`: a11y, tokens, responsive,
   visual evidence, forms, perf budget.
2. Close the specify/implement/review loop for interaction-heavy frontends
   without breaking the deterministic builder (`AGENTS.md`: no third-party
   deps, `skills/<id>/SKILL.md` self-contained English, generated `plugins/`
   untouched).
3. Give Lastro three caller-side frontend context recipes that reuse only
   existing facets/`sourceDepth`/`ranking`/`includePaths`, so no engine change
   is required in this cycle.
4. Keep every acceptance criterion observable per
   `write-testable-acceptance`: condition + action + verifier-visible result.

## 3. Non-goals

- No change to financial domain, API, MCP, worker, persistence, or settlement
  invariants.
- No new runtime dependency in `apps/web`, `packages/ui`, `agentpatrol/src`,
  or `contextpatrol/src` in this spec cycle.
- No new ContextPatrol facet (`styles/assets/a11y`), no `relations.kind`
  extension, no `SOURCE_EXTENSIONS` change — recorded as follow-ups only.
- No Tailwind/Radix migration itself, no i18n framework adoption, no store
  adoption — those are future Works enabled by this spec.
- No edits to generated `agentpatrol/plugins/*` or `contextpatrol/dist/*`.
- No i18n framework adoption in this cycle (strings stay hardcoded English;
  `html lang="en"` unchanged). i18n keys, locale fallback, and `Intl`
  formatting are an explicit follow-up.
- No state/data-fetching library adoption (no SWR/cache/dedupe, `nextCursor`
  pagination, or URL state). Manual `ApiClient` + `useEffect` stays; only the
  `submit-disabled-during-refresh` rule in §4.5 touches fetching behavior.
- "No new dependency" means no new **runtime** dependency in `apps/web`,
  `packages/ui`, `agentpatrol/src`, or `contextpatrol/src`. Dev-only evidence
  tooling (axe runner, Lighthouse CI, Playwright screenshots — all already
  present except Lighthouse) is allowed and is the expected evidence
  mechanism for §4.1/§4.4/§4.6.

## 4. Requirements — AgentPatrol skills (6 new)

All new skills follow the canonical shape
(`SKILL.md`: Purpose / When to use / Inputs / Output / Rules, English,
self-contained, lifecycle-scoped). Paths: `agentpatrol/skills/<id>/SKILL.md`.

### 4.1 `frontend-a11y-check`

- Purpose: make every interaction keyboard-operable, focus-managed, named,
  and contrast-safe.
- When: `build` (before done), `build-review` (as checklist).
- Inputs: changed interactive elements; host acceptance + result contract.
- Output: per-element verdicts (pass/fail + reproduction command).
- Rules (minimum): native control or correct `role`; `aria-label`/`label`
  association; `aria-describedby` for errors; focus enters on open, restores
  on close, `Escape` closes, `aria-modal` semantics; success uses
  `role=status/live`, errors use `role=alert`; tables have `caption`/headers;
  `BarChart`-type visuals get a textual alternative; axe run recorded via
  `name-interaction-evidence` (contrast stays enabled in `apps/web`).

### 4.2 `design-token-discipline`

- Purpose: `packages/ui/src/tokens.ts` is the single source of visual truth.
- When: `build`, `build-review`.
- Inputs: changed styles; token file.
- Output: token-violation list or explicit `Mark known ceilings` comment.
- Rules: no hardcoded hex/spacing/shadow/radius outside `tokens.ts`; no
  duplicated `Field`/label styles (reuse from `@lastro/ui`); dark theme via
  `themeVariables(theme)`; color never the only status signal;
  `tabular-nums` for monetary values.

### 4.3 `responsive-interaction`

- Purpose: every changed surface works at 360/768/1280 without horizontal
  overflow.
- When: `plan` (declare viewport matrix), `build` + `build-review` (prove it).
- Inputs: changed routes/components.
- Output: viewport matrix verdicts + Playwright viewport commands.
- Rules: mobile-first; `flexWrap`/stacking declared; tables/charts degrade
  (scroll region with accessible name or stacked cards); reduced-motion
  respected.

### 4.4 `visual-regression-evidence`

- Purpose: CSS refactors cannot pass on unit tests alone.
- When: `build` (capture), `build-review`/`ship` (compare).
- Inputs: interaction claim + baseline reference.
- Output: named screenshot evidence (route + viewport + command), wired
  through `name-interaction-evidence` / `evidence-based-completion`.
- Rules: one claim = one reproducible screenshot check; Playwright screenshot
  or approved snapshot service; never claim visual pass without artifact.

### 4.5 `form-validation-observable`

- Purpose: form errors are schema-driven and externally observable.
- When: `plan` (declare states), `build` (implement), `build-review` (judge).
- Inputs: form fields + Zod schema in `packages/contracts` or colocated schema.
- Output: per-field state table (`pristine/touched/submitting/disabled` +
  message + `aria` wiring).
- Rules: client parse of `amountMinor` before submit; free-typed IDs get
  autocomplete/validation or explicit non-goal entry; submit disabled during
  `refresh()`; error text linked via `aria-describedby`.

### 4.6 `web-vitals-budget`

- Purpose: prevent LCP/CLS/INP and bundle regressions.
- When: `plan` (declare budget), `build-review`/`ship` (measure).
- Inputs: changed route + budget numbers.
- Output: budget verdicts with Lighthouse/bundle commands as named evidence.
- Rules: images/fonts lazy + sized; no layout-shift contributors without
  reservation; `Suspense/streaming` for slow sections; bundle delta recorded.

### 4.7 Composition changes (no new engine code)

- `frontend-engineer` v2 adds: `write-observable-interaction`,
  `detect-interaction-drift`, `frontend-a11y-check`, `design-token-discipline`.
  Full set (11): existing 7 + those 4. `form-validation-observable`,
  `responsive-interaction`, `visual-regression-evidence`, `web-vitals-budget`
  are invoked via `pack-context`/plan when the Work touches forms, layout,
  visuals, or perf-critical routes (keeps the default agent lean).
- New `frontend-engineer-lean` (4): `test-first, minimal-implementation,
  preserve-access-paths, frontend-a11y-check` — mirrors `developer-lean`
  pattern.
- `architecture-vocabulary`: scoped amendment proposal (exact wording below),
  validated by `agents:build/check/validate`. It narrows — not removes — the
  existing prohibition, so backend agents keep the current rule verbatim.
  Proposed replacement for the Rules first bullet:
  > Use these terms exactly; do not drift into synonyms such as "service",
  > "API", or "boundary". The synonym "component" is likewise forbidden,
  > except when the resolving agent is `frontend-engineer` or
  > `frontend-engineer-lean` describing a React surface, where "component"
  > means a UI module with props as its interface.
- `test-first`: add frontend evidence examples (RTL + jest-axe + Playwright)
  without mandating a runner; `detect-interaction-drift`: add visual-drift
  clause pointing at `visual-regression-evidence`.

## 5. Requirements — ContextPatrol frontend recipes (3 new, engine-unchanged)

Additive only. Each recipe has two parts, kept distinct because the contracts
are distinct:

- (a) **Stored profile** in `codepatrol.json:contextPatrol.profiles`
  (canonical catalog in `contextpatrol/codepatrol.json`, adoption mirror in
  `lastro/codepatrol.json`): only `facets`, `maxOutputBytes`, `sourceDepth` —
  the only keys profiles support. No schema change.
- (b) **Documented query-time hints** (`ranking`, `includePaths` per
  `contextpatrol/schemas/query-request.schema.json:67-104`): passed on each
  `query --input -` request by the caller, never stored in the profile.
  The recipe docs record the recommended hints verbatim so callers
  reproduce the same `requestDigest`.

| Recipe | Stored profile (a) | Query-time hints (b) |
|---|---|---|
| `ui-surface` | `facets[symbols, relations, source, tests]`, `sourceDepth: full`, `19200` | `ranking{boostPaths:[src/components, app/, packages/ui/src], dampenPaths:[dist, .next, storybook-static], boostIdents:[props, variant]}`; surfaces `dashboard.tsx`, `expense-workflow.tsx`, `packages/ui/src/*.tsx` |
| `ui-tokens` | `facets[structure, symbols, source]`, `sourceDepth: signatures`, `12800` | `includePaths:[packages/ui/src/tokens.ts, packages/ui/src/*.tsx, apps/web/src/app/layout.tsx]`; proves token-only styling |
| `ui-flow` | `facets[structure, relations, source, tests]`, `sourceDepth: full`, `19200` | `includePaths:[apps/web/src/app/page.tsx, apps/web/src/lib/api.ts, apps/web/e2e/expense-workflow.spec.ts]`; covers route → client → e2e |

- `defaults` mapping is unchanged in this cycle (Lastro keeps
  `spec→requirements`, `build→implementation`, etc.). Callers opt into
  `ui-*` per-query for frontend Works by selecting the profile and passing
  hints (b); a defaults flip is an explicit follow-up after WAVE-style
  measurement.
- Each recipe must round-trip: `query --input -` with profile (a) + hints (b)
  emits one canonical JSON report on stdout with `outputBytes ≤
  maxOutputBytes`; identical requests yield identical `requestDigest`
  byte-for-byte.

## 6. Acceptance criteria (observable triplets)

1. Given a frontend Work touching `apps/web/src/components/*`, when
   `agentpatrol resolve` returns `frontend-engineer`, then instructions list
   `frontend-a11y-check` and `design-token-discipline` immediately after
   `preserve-access-paths` in descriptor order — verified by `printf
   '{"schemaVersion":1,"reference":"agentpatrol/frontend-engineer","version":"1.0.0"}'
   | node agentpatrol/bin/agentpatrol.js resolve --json` showing both skill
   IDs at positions 4-5 of the skills array.
2. Given the new skills directories, when `npm run agents:build &&
   npm run agents:check && npm run agents:validate` runs in `agentpatrol`,
   then exit code is 0 and `plugins/frontend-engineer/skills/` contains
   exactly the four directories `write-observable-interaction`,
   `detect-interaction-drift`, `frontend-a11y-check`,
   `design-token-discipline` in addition to the prior seven — verified by
   build log + `ls plugins/frontend-engineer/skills`.
3. Given `frontend-engineer-lean`, when `agentpatrol list --json` runs, then
   exactly one entry `agentpatrol/frontend-engineer-lean` with the 4 skills
   `test-first, minimal-implementation, preserve-access-paths,
   frontend-a11y-check` exists — verified by JSON output.
4. Given a Lastro dialog change touching `apps/web/src/components/*` or
   `packages/ui/src/dialog.tsx`, when the candidate is reviewed, then every
   changed interactive element has one axe verdict recorded as a
   `name-interaction-evidence` entry with the reproduce command
   (`bunx jest-axe` spec path or `npx playwright test --project` spec path)
   — verified by evidence entries; unchanged elements are out of scope.
5. Given a style change, when `bun run check` runs in `lastro`, then
   `rg -n '#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|box-shadow:|border-radius:'
   --glob '!packages/ui/src/tokens.ts' apps/web/src packages/ui/src`
   returns no matches unless each match has a sibling `Mark known ceilings:`
   comment on the preceding line citing the exception — verified by reviewer
   running the command + Biome log exit 0.
6. Given `ui-surface/ui-tokens/ui-flow` stored profiles (a) plus hints (b)
   in `codepatrol.json`, when `contextpatrol query --input -` runs once per
   recipe with profile (a) + hints (b), then exactly one canonical JSON
   report is emitted on stdout with `outputBytes ≤ maxOutputBytes` —
   verified by three query runs + `requestDigest` equality on repeat.
7. Given `ui-tokens` profile (a) + hints (b) on Lastro, when queried, then
   `snippets[].path` includes `packages/ui/src/tokens.ts` — verified by
   report JSON containing that path.
8. Given no engine change, when `npm run verify && npm run release-check`
   runs in `contextpatrol`, then both exit 0 — verified by logs.

Negative paths: a pure API Work with no `apps/web` change must not require
`ui-*` recipes or frontend skills; a visual-only refactor with no screenshots
must fail `build-review` per §4.4.

## 7. Test / rollout plan (executable slices)

- Slice A (mandatory disciplines + agents): author `frontend-a11y-check` +
  `design-token-discipline` `SKILL.md`, apply `architecture-vocabulary`
  amendment wording, update `frontend-engineer/agent.json` (11 skills) and
  add `frontend-engineer-lean/` descriptor + `agentcontext/instructions.md`.
  Gate: spec criteria 1-3 + `agents:build/check/validate`, `verify`,
  `release-check` in `agentpatrol`.
- Slice B (opt-in disciplines): author `responsive-interaction`,
  `visual-regression-evidence`, `form-validation-observable`,
  `web-vitals-budget` `SKILL.md`; extend `test-first` examples and
  `detect-interaction-drift` visual clause. Gate: builder gates green; no
  agent descriptor changes.
- Slice C (recipes): add 3 stored profiles (a) to
  `contextpatrol/codepatrol.json` + mirror in `lastro/codepatrol.json`
  (additive, no defaults flip); record hints (b) in recipe docs; extend
  `test/profiles.test.ts`. Gate: spec criteria 6-8 + `verify` /
  `release-check` in `contextpatrol`.
- Slice D (pilot): one Lastro frontend Work (extract shared `Field` into
  `@lastro/ui` + enable axe with contrast on in `apps/web`). Measure paired
  `build-work vs ui-surface` evidence quality per
  `docs/contextpatrol-wave-5-1-experiment.md` protocol.
- Follow-ups (out of scope here): Tailwind/Radix migration, i18n adoption,
  store/cache adoption, new facets (`styles/assets/a11y`),
  `SOURCE_EXTENSIONS` expansion.

## 8. Risks

- Skill bloat dilutes `minimal-implementation` — mitigated by keeping 4 of 6
  new skills opt-in per Work type and adding a `-lean` variant.
- Screenshot flakiness — mitigated by Desktop-Chrome-first matrix, existing
  `page.route` mock pattern, and named baselines.
- Token centralization slows iteration — mitigated by `Mark known ceilings`
  escape hatch with call-site comment.
