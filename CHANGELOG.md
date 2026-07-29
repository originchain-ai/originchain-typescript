# Changelog

All notable changes to `@originchain/sdk`. See the repo-root `CHANGELOG.md`
for engine releases.

## [Unreleased]

### Fixed - `/sql` response contract

- **`SqlResp` now models every variant the engine can return.** It previously
  covered 3 of the engine's 19 `SqlResp` variants (`select`, `insert`,
  `delete`), so `EXPLAIN`, `UPDATE`, transaction control, and every DDL
  statement decoded into a value the union said was impossible. Added
  `SqlExplain`, `SqlUpdate`, `SqlTx`, `SqlBuffered`, `SqlCreateTable`,
  `SqlDropTable`, `SqlAlterTable`, `SqlCreateIndex`, `SqlCreateView`,
  `SqlDropView`, `SqlCreateSequence`, `SqlDropSequence`,
  `SqlCreateProcedure`, `SqlDropProcedure`, `SqlCreateFunction`,
  `SqlDropFunction`, plus the `SqlRespKind` alias.
- **`SqlDelete.pk` is now optional.** The engine omits it on scan-predicate
  deletes (only the `WHERE <pk> = <literal>` fastpath carries one).
- **`SqlInsert` gained the always-present `inserted` count** plus `updated`,
  `skipped`, and `returning`; `rows` is now optional — it is present only for
  `INSERT … RETURNING`.
- **`SqlDelete` gained `returning`, `rows`, `rows_buffered`,
  `rows_affected`; `SqlSelect` gained `columns`** (projection order, omitted
  when the plan declares none).

### Fixed - other wire-contract drift

- **`graph.dijkstra` weights are per-EDGE**, keyed `` `${from}|${to}` `` — the
  docs and README example showed a relation/column-name map, which the engine
  matches against nothing, silently skipping every edge and reporting
  `cost: null` (unreachable). Added `edgeWeightKey(from, to)` and corrected
  the docs, README, and tests.
- `AskResponse` gained `explain` (the engine emits it alongside `plan` under
  the same `show_plan` flag) and narrowed `cache` to `"hit" | "miss"`.
- `VecMetric` gained `"manhattan"` and its `"l1"` alias, both accepted by the
  engine.
- `TenantUsage` gained `addon_calls`; documented that `limits` can carry the
  `u64::MAX` unlimited sentinel, which exceeds `Number.MAX_SAFE_INTEGER`.
- `registerSchema()` now returns `SchemaRegisterResponse`, which includes the
  `geo_fields` the engine adds for manifests declaring `[[geo]]`.
- Documented that `graph.bfs` / `graph.path` default to `max_depth: 3`
  server-side.

### Breaking

Adding union members is breaking for consumers with an exhaustive `switch`
over `SqlResp["kind"]`, and `SqlDelete.pk` / `SqlInsert.rows` becoming
optional is breaking for code that read them as `string` / `unknown[]`. Both
breaks surface real engine behaviour that was previously mistyped.

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
