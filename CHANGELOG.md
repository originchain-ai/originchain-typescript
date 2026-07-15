# Changelog

All notable changes to `@originchain/sdk`. See the repo-root `CHANGELOG.md`
for engine releases.

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
