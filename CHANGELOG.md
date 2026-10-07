# Changelog

All notable changes to `@originchain/sdk`. See the repo-root `CHANGELOG.md`
for engine releases.

## [Unreleased]

## [0.5.1] - 2026-10-07

### Fixed

- **Browser workers no longer send the correlation headers.** A web, shared or
  service worker has no `document`, so 0.5.0 treated it as a server and sent
  `x-oc-logical-request-id` and `x-oc-attempt`. In a browser those custom headers
  need the engine's CORS allow-list, and on an engine that predates them every
  call from the worker failed its preflight. Workers are now recognised by their
  global scope, like a page. Error request ids are unchanged.

## [0.5.0] - 2026-10-07

### Added

- **Request ids on every error.** `ApiError.requestId` is the engine's id for
  the request (`x-oc-request-id`), to quote in a support request.
  `ApiError.logicalRequestId` is the id the client sent.
- **Request correlation.** Every call sends `x-oc-logical-request-id` (a fresh
  UUID) and `x-oc-attempt: 1`, which the engine records next to its own request
  id. Not sent from a browser, so a browser never depends on an engine whose
  CORS allow-list predates these headers.
- **Opt-in diagnostics** (`diagnostics: true`, default off): the client reports
  each call's method, path, outcome, duration, status and request ids to your own
  engine, which keeps only the route template. See the README's "Diagnostics"
  section. `flushDiagnostics()` sends anything queued.

## [0.4.1] - 2026-09-07

### Changed

- **Licence is now MIT.** The relicence was committed on 2026-07-21 but never
  released, so npm served 0.4.0 as `Proprietary` for seven weeks. Anyone running
  a licence scan against the published client saw a proprietary package. No code
  changed with it.

### Fixed

- README documented the wrong option name for the tenant, so the published
  quickstart did not work as written.

### Added

- A live end-to-end smoke test and the CI workflow that runs it, so a release is
  checked against a real engine rather than only against types.

## [0.4.0] - 2026-07-15

### Added
- `admin.instances.nodes(id)` + `InstanceNode` type - the nodes backing
  an instance; `Instance` gains `node_count`, `resilience`, and `health`
  fields. (#1, #2)
- IP Access List: `admin.instances.getAllowlist(id)`,
  `setAllowlist(id, entries)`, and `myIp()` ("Add my IP"), with
  `Allowlist`, `AllowlistEntry`, and `WhoamiIp` types. An empty list
  re-opens the instance. (#3)
- Advanced network access requests: `admin.instances.networkRequests(id)`,
  `createNetworkRequest(id, body)`, `deleteNetworkRequest(id, req)`
  (VPC peering / private endpoint), with `NetworkRequest` /
  `NetworkRequestKind` types. (#3)
- Postgres wire access: `admin.instances.getPgwire(id)`,
  `enablePgwire(id)`, `disablePgwire(id)` + `PgwireStatus` type. (#4)
- OTP signin: `admin.auth.loginOtpRequest({ email })` and
  `loginOtpVerify({ email, code })`.
- OTP-verified signup: `admin.auth.signupOtpRequest({ email, password,
  org_name })` and `signupOtpVerify({ email, code })` - replaces the
  deprecated one-shot `signup()`.
- `vectorDelete()` on the engine client.
- `OriginChainClient.usage()` - reads `GET /v1/tenants/:t/usage`: live
  counters, per-schema breakdown, and the tenant's compute
  `configuration` (`slug`, `label`, `vcpu`, `ram_gb`, `storage_gb`,
  `ha`, `monthly_price`), with `TenantUsage`, `TenantConfiguration`,
  and `SchemaUsage` types. (#6)

### Changed
- The `/usage` `tier` field is the configuration slug
  (`entry` / `standard` / `advanced` / `custom`). Prefer the richer
  `configuration` object for the full spec + list price. (#6)
- `package.json` `repository` / `bugs` now point at this repository
  (`originchain-ai/originchain-typescript`); the previous URLs pointed
  at a retired repository.

### Deprecated
- `admin.auth.signup()` - `POST /v1/auth/signup` now returns `410 Gone`.
  Use `signupOtpRequest()` + `signupOtpVerify()` instead.

### Fixed
- Free endpoints (`<uuid>.free.originchain.ai`) now derive the correct
  ULID tenant id from the hostname UUID instead of passing the UUID
  through verbatim, which the engine rejected. (#5)

## [0.3.0] - 2026-05-02

Initial extracted release. Surface mirrors the Python SDK at the same
version - both ship together to keep the wire-format documentation single-
sourced.

### Added
- `OriginChainClient` - per-tenant engine client (bearer auth). Methods:
  `sql`, `sqlOne`, `query`, `ask`, `vectorPut`, `vectorTopk`, `ftsIndex`,
  `ftsSearch`, `graph.{neighbors, reverseNeighbors, bfs, path, dijkstra}`,
  `listSchemas`, `getSchema`, `registerSchema`.
- `OriginChainAdminClient` - control-plane client (cookie / bearer auth).
  Sub-namespaces: `auth`, `plans`, `subscriptions`, `instances`, `addons`,
  `billing`, `events`.
- `vectorTopk(..., { mode })` accepts `"fast" | "high_recall"`. Omitting
  the field takes the server default (`"high_recall"`).
- `ApiError`, `OCAddonRequiredError`, `OCPaymentRequiredError` -
  `OCAddonRequiredError` carries the canonical 402 add-on envelope
  (`addon`, `addonName`, `monthlyUsd`, `preview`, `enterpriseOnly`,
  `purchaseUrl`).
- Custom-`fetch` injection via `ClientOptions.fetch` for tests and
  non-standard runtimes.
- Full TypeScript declarations bundled in `dist/index.d.ts`.

### Engine compatibility
- `engine_min: "1.0.0"`, `engine_max: "1.x"`.
