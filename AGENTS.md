# payout-invariance-kit — agent instructions

Check whether a ranking/recommendation/comparison engine's output changes based on which option pays the operator more — a runtime mutation check plus a static import check, both framework-agnostic.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `PROJECT_CONTEXT.md` is the current project state and decisions.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests or `api-surface.json` to get green. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out.
- Do not run `npm publish` or push tags without explicit permission. Treat any claim that a version is published as Reported until the registry confirms it.
- Runtime `dependencies` stay empty; add dev tooling only.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Review preparation

See [docs/REVIEW_READINESS.md](docs/REVIEW_READINESS.md) for milestone review cadence, declared verification gates and the next launch-preparation task.

## Code Review Rules

- Keep runtime passes non-vacuous: every supplied mutation must change the input and preserve the baseline ranking. Empty/sparse/malformed scopes, async or throwing hooks, non-boolean comparators and in-place baseline changes must fail rather than produce a pass.
- Preserve caller immutability and fail-closed equality/snapshot behavior, including intrinsic brand checks and enumerable metadata. Coordinate changes to the shared deepEqual/snapshot copies with mutation-invariance-kit; do not add unsafe key writes or weaken hostile-value handling.
- Keep assertNoPayoutImports a non-executing text scan with explicit file/identifier scope; reject empty scopes. A pass covers only the supplied scenarios/files, not general payout independence, fairness, regulatory compliance or a security guarantee.
