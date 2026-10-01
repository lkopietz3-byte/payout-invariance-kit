# Review and consumer integration readiness

Updated September 30, 2026 against main `a3b8a256c75ce11e70de99c55ff7485b5b9e9ce3`. The npm registry reported `payout-invariance-kit@0.2.0` on that date. This is review guidance for future changes and a consumer integration task; it is not a product audit, registry integrity check or marketing certification.

## Review cadence

Request one focused review on a meaningful candidate PR after relevant checks; repeat when material changes invalidate that review. Review cadence and automation settings should reflect the current development stage and available review capacity.

When this repo enters sustained launch or customer-facing development, enable its repository setting individually with **All PRs / On PR open / Exhaustive Off**. Keep the personal automatic default and credit-funded reviews off. Inspect the first result before expanding cadence. Review guidance lives in the root [AGENTS.md](../AGENTS.md); it supplements existing tests and release requirements.

Check current repository and personal review settings before changing review automation. This document does not activate a setting.

## Next consumer integration task

For the next consumer integration, prepare a scoped receipt for the runnable ranking example: name the mutations, comparator policy and static file/identifier scope; include a meaningful failing mutation and the scanner's blind spots.

Finish condition: The receipt comes from the real packed API on the selected candidate, includes actual passing/failing examples and does not imply proof beyond the tested scope.

## Declared verification commands

Read from the current `package.json`. These are declared gates, not execution receipts. Use focused checks during implementation and the existing release gates on the frozen candidate; report unavailable checks explicitly.

- `npm run verify`: `npm run lint && npm run typecheck && npm test && npm run build && npm run verify:package`
- `npm run lint`: `eslint . --max-warnings=0`
- `npm run typecheck`: `tsc --noEmit`
- `npm run test`: `vitest run`
- `npm run build`: `node -e "require('fs').rmSync('dist',{recursive:true,force:true})" && tsc -p tsconfig.build.json`
- `npm run verify:package`: `node scripts/verify-package.mjs`
- `npm run attw`: `attw --pack . --ignore-rules cjs-resolves-to-esm`

Local tests, hosted authorization, installed package behavior, deployment and buyer evidence are separate outcomes. A dated receipt applies to its recorded revision.

## Source basis

- [ENGINEERING.md](../ENGINEERING.md)
- [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md)

Public claims require current candidate evidence. Private-data transfers, commercial commitments, package publication, database promotion and deployment retain their existing authorization boundaries.
