# Changelog

All notable changes to `@originchain/sdk`. See the repo-root `CHANGELOG.md`
for engine releases.

## [0.3.0] - 2026-05-02

Initial extracted release. Surface mirrors the Python SDK at the same
version — both ship together to keep the wire-format documentation single-
sourced.

### Added
- `OriginChainClient` — per-tenant engine client (bearer auth). Methods:
  `sql`, `sqlOne`, `query`, `ask`, `vectorPut`, `vectorTopk`, `ftsIndex`,
  `ftsSearch`, `graph.{neighbors, reverseNeighbors, bfs, path, dijkstra}`,
  `listSchemas`, `getSchema`, `registerSchema`.
- `OriginChainAdminClient` — control-plane client (cookie / bearer auth).
  Sub-namespaces: `auth`, `plans`, `subscriptions`, `instances`, `addons`,
  `billing`, `events`.
- `vectorTopk(..., { mode })` accepts `"fast" | "high_recall"`. Omitting
  the field takes the server default (`"high_recall"`).
- `ApiError`, `OCAddonRequiredError`, `OCPaymentRequiredError` —
  `OCAddonRequiredError` carries the canonical 402 add-on envelope
  (`addon`, `addonName`, `monthlyUsd`, `preview`, `enterpriseOnly`,
  `purchaseUrl`).
- Custom-`fetch` injection via `ClientOptions.fetch` for tests and
  non-standard runtimes.
- Full TypeScript declarations bundled in `dist/index.d.ts`.

### Engine compatibility
- `engine_min: "1.0.0"`, `engine_max: "1.x"`.
