// Wire-format types for the OriginChain HTTP API.
//
// Names and casing mirror the engine's JSON exactly (snake_case for fields
// that come back from the engine; camelCase only for SDK-local extensions).
// Keep these in sync with `backend/crates/oc-http` types - when the engine
// adds a field, mirror it here in the same PR.

// ── Auth / org / billing (control-plane) ──────────────────────────────────

export type User = {
  id: string;
  email: string;
  created_at: string;
};

export type AuthResponse = {
  user: User;
  org_id: string;
};

export type Plan = {
  id: string;
  kind: "compute" | "storage";
  display_name: string;
  monthly_cents: number;
  specs: Record<string, unknown>;
};

export type PlansResponse = {
  compute: Plan[];
  storage: Plan[];
};

export type Subscription = {
  id: string;
  org_id: string;
  compute_plan_id: string;
  storage_plan_id: string;
  status: "trialing" | "active" | "past_due" | "canceled";
  trial_ends_at: string | null;
  current_period_end: string | null;
};

export type Instance = {
  id: string;
  org_id: string;
  name: string;
  region: string;
  compute_plan_id: string;
  storage_plan_id: string;
  status:
    | "pending_payment"
    | "provisioning"
    | "running"
    | "suspending"
    | "suspended"
    | "deleting"
    | "deleted"
    | "failed";
  endpoint: string | null;
  created_at: string;
  /** Observed engine health for a running instance: "ok" | "unreachable".
   * Absent on non-running rows / older control planes. */
  health?: string;
  /** Number of nodes (shards) backing the instance; >1 = a sharded multi-node
   * cluster. Absent on control planes that predate node_count exposure. */
  node_count?: number;
  /** Resilience / HA mode. "ha" gives each shard a cross-AZ standby replica. */
  resilience?: "single" | "ha" | "multi" | string;
};

/** One EC2 node (shard writer or standby) backing an instance.
 * From GET /v1/instances/:id/nodes. */
export type InstanceNode = {
  instance_id: string;
  /** Shard index this node serves (0-based). */
  shard: number;
  /** "writer" (owns the shard) or "standby" (its cross-AZ HA replica). */
  role: "writer" | "standby" | string;
  private_ip: string | null;
  public_ip: string | null;
  az: string | null;
  /** EC2 lifecycle state ("running", "stopped", …). */
  state: string;
  name: string;
};

/** One IP Access List entry: a CIDR (or bare IP, normalised to /32 or /128 on
 * write) plus an optional label. From GET /v1/instances/:id/allowlist. */
export type AllowlistEntry = {
  cidr: string;
  description: string;
};

/** An instance's IP Access List. Empty `entries` = open to the internet
 * (0.0.0.0/0). Gates the engine endpoint (443) and pgwire (5432); cross-shard
 * node-to-node traffic is unaffected. */
export type Allowlist = {
  entries: AllowlistEntry[];
};

/** The caller's public source IP as seen by the control plane. From
 * GET /v1/whoami/ip — powers the console's "Add my current IP" button. */
export type WhoamiIp = { ip: string };

/** Postgres wire-protocol (pgwire) access for an instance. When `enabled`,
 * `host`/`port`/`user`/`database`/`password` form a working `postgresql://`
 * connection string usable by any Postgres driver. From
 * GET/POST/DELETE /v1/instances/:id/pgwire. */
export type PgwireStatus = {
  enabled: boolean;
  host: string | null;
  port: number;
  user: string;
  database: string;
  /** Present only when enabled. */
  password?: string;
};

export type NetworkRequestKind = "peering" | "private_endpoint";

/** A VPC-peering or private-endpoint (PrivateLink) connectivity request.
 * From GET/POST /v1/instances/:id/network-requests. `details` is the per-kind
 * payload (peering: aws_account_id/vpc_id/vpc_cidr/region; private_endpoint:
 * aws_account_id/region). */
export type NetworkRequest = {
  id: string;
  kind: NetworkRequestKind | string;
  details: Record<string, unknown>;
  status: "requested" | "in_progress" | "active" | "rejected" | "deleted" | string;
  created_at: string;
};

export type EventView = {
  id: string;
  // Stable kind enum from operation-backend (`events::Kind::as_str`).
  kind:
    | "INSTANCE_CREATED"
    | "INSTANCE_DELETED"
    | "INSTANCE_BEARER_ROTATED"
    | "SUBSCRIPTION_STARTED"
    | "SUBSCRIPTION_CANCELLED"
    | string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ProvisionResponse = {
  instance: Instance;
  /** Shown once, never re-derivable - the store only keeps an argon2 hash. */
  bearer_token: string;
};

/** Returned by POST /v1/instances when the new pending_payment flow kicks in.
 * Frontend must open Razorpay Checkout with `razorpay_subscription_id`, then
 * POST /v1/instances/:id/confirm-payment with the signature to complete. */
export type PendingPaymentResponse = {
  instance: Instance;
  razorpay_subscription_id: string;
  razorpay_key_id: string;
  razorpay_customer_id: string;
};

export type ConfirmPaymentBody = {
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export type CardSummary = {
  last4: string;
  brand: string;
};

export type Eligibility = {
  has_used_trial: boolean;
  pm_status: "none" | "pm_pending" | "pm_active";
  card: CardSummary | null;
  active_subscriptions: number;
  trial_available: boolean;
};

export type SetupIntent = {
  razorpay_order_id: string;
  razorpay_key_id: string;
  amount_cents: number;
  currency: string;
};

export type PaymentMethodView = {
  id: string;
  last4: string;
  brand: string;
  status: "active" | "expired" | "removed";
};

export type ConfirmPaymentMethodBody = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
  razorpay_token_id?: string;
  last4?: string;
  brand?: string;
};

export type RemoveBlockedBody = {
  error: "active_instances";
  active_count: number;
  instance_ids: string[];
};

// ── Add-ons ──────────────────────────────────────────────────────────────

/** Mirrors `operation-backend/src/addons/model.rs::AddonView`. */
export type AddonRow = {
  addon_id: string;
  preview: boolean;
  enabled_at: string;
  monthly_usd: number;
};

/** Mirrors `addons::routes::EnableResponse`. */
export type AddonEnableResponse = {
  addon_id: string;
  enabled_at: string;
};

// ── Per-instance observability ────────────────────────────────────────────

export type SnapshotView = {
  recovery_point_arn: string;
  created_at: string;
  size_bytes: number;
  status: string;
  resource_type: string;
};

export type MetricPoint = { t: string; v: number };
export type MetricSeries = {
  metric: string;
  label: string;
  points: MetricPoint[];
};
export type MetricsResponse = {
  series: MetricSeries[];
  from: string;
  to: string;
};

export type LogLine = {
  timestamp: number;
  level: string;
  message: string;
};
export type LogsResponse = {
  lines: LogLine[];
  instance_id: string;
  fetched_at: string;
};

/** One per-shape tile on `/app/metrics`. The backend may return `null`
 * for `p99_ms` / `qps` when the engine doesn't yet emit the underlying
 * counter - render "-" rather than fabricating a number. `enabled` is
 * sourced from the real `tenant_addons` row. */
export type ShapeStat = {
  p99_ms: number | null;
  qps: number | null;
  enabled: boolean;
};

/** Storage panel on `/app/metrics`. v0 returns nulls for every field
 * because the engine doesn't expose a per-shape size diagnostic yet;
 * the frontend renders dashes. */
export type StorageBreakdown = {
  rows_gb: number | null;
  indexes_gb: number | null;
  vectors_gb: number | null;
  fts_gb: number | null;
};

/** Mirrors `observe::handlers::MetricsSummaryResponse`. */
export type MetricsSummaryResponse = {
  shapes: Record<string, ShapeStat>;
  storage: StorageBreakdown;
};

/** One sealed segment / checkpoint shipped to S3 by `oc-pitr`. Mirrors
 * `observe::handlers::ArchiveSegment`. */
export type ArchiveSegment = {
  lsn_start: number;
  lsn_end: number;
  sealed_at: string | null;
  sha256: string | null;
  size_bytes: number;
  compressed: boolean;
  kind: "segment" | "checkpoint";
  s3_key: string;
};

/** Mirrors `observe::handlers::PitrArchiveResponse`. */
export type PitrArchiveResponse = {
  segments: ArchiveSegment[];
  tail_status: "active" | "paused" | "unknown";
  rpo_seconds: number | null;
};

/** One line on the usage breakdown. `kind` is the canonical group
 * compute / addon / overage. */
export type UsageLine = {
  kind: "compute" | "addon" | "overage";
  name: string;
  amount_usd: number;
};

/** Mirrors `usage::handlers::CurrentUsageResponse`. */
export type CurrentUsageResponse = {
  period_start: string;
  period_end: string;
  lines: UsageLine[];
  total_usd: number;
};

/** Neutral, spec-based compute configuration returned by the engine's
 * `GET /v1/tenants/:t/usage`.
 *
 * `slug` is the stable machine id (`entry`/`standard`/`advanced`/
 * `custom`); `label` is display text such as "4 vCPU / 16 GB, HA".
 * Quantitative fields and `monthly_price` are omitted for the
 * sales-sized `custom` configuration. */
export type TenantConfiguration = {
  slug: string;
  label: string;
  vcpu?: number;
  ram_gb?: number;
  storage_gb?: number;
  ha: boolean;
  monthly_price?: number;
};

/** Per-schema row / byte / segment breakdown from `/usage`. */
export type SchemaUsage = {
  schema: string;
  rows: number;
  bytes: number;
  segments: number;
};

/** Per-add-on entitlement-gate counters from `/usage`: how many calls the
 * gate `allowed` versus `rejected` (402'd) for that add-on. */
export type AddonCallUsage = {
  addon: string;
  allowed: number;
  rejected: number;
};

/** Response of the engine's `GET /v1/tenants/:t/usage`.
 *
 * `tier` is the configuration slug
 * (`entry`/`standard`/`advanced`/`custom`). Prefer the richer
 * `configuration` object. `tier`, `configuration`, and `limits` are all
 * absent in legacy per-addon mode. */
export type TenantUsage = {
  tenant: string;
  /** Configuration slug — same value as `configuration.slug`. */
  tier?: string;
  configuration?: TenantConfiguration;
  /** Entitlement envelope for the configuration. The Enterprise "unlimited"
   * sentinel is `u64::MAX` (18446744073709551615), which exceeds
   * `Number.MAX_SAFE_INTEGER` — compare against a threshold rather than for
   * equality, and never round-trip these through arithmetic. */
  limits?: Record<string, number>;
  used: {
    store_keys: number;
    ask_in_flight?: number;
    vector_embeddings?: number;
    reactive_subscriptions?: number;
  };
  schemas: SchemaUsage[];
  /** Per-add-on gate counters. Always present, possibly empty. */
  addon_calls?: AddonCallUsage[];
};

// ── Engine: schemas ──────────────────────────────────────────────────────

/** Result of registering a manifest with `POST /v1/tenants/:t/schemas`.
 * `geo_fields` is present only when the manifest declared `[[geo]]` blocks
 * and lists the columns that got a geo index. */
export type SchemaRegisterResponse = {
  id: string;
  tenant: string;
  geo_fields?: string[];
};

// ── Engine: SQL ──────────────────────────────────────────────────────────

export type SqlReq = { sql: string; params?: unknown[] };

// `POST /v1/tenants/:t/sql` answers with an INTERNALLY-TAGGED union: the
// engine's `SqlResp` is `#[serde(tag = "kind", rename_all = "lowercase")]`,
// so the discriminant lives in a `kind` field alongside the variant's own
// fields, and multi-word variants lowercase WITHOUT a separator
// (`CreateTable` → `"createtable"`, not `"create_table"`).
//
// Every field the engine marks `skip_serializing_if = "Option::is_none"` /
// `"Vec::is_empty"` is OMITTED from the wire, so it is optional here. Fields
// without that attribute are always present. Keep this in lockstep with
// `backend/crates/oc-http/src/preview_endpoints.rs::SqlResp`.

/** `EXPLAIN` / `DESCRIBE` / `DESC`. `plan` is the pretty-printed plan tree;
 * `stats` carries per-operator runtime stats and is present only for
 * `EXPLAIN ANALYZE`. */
export type SqlExplain = {
  kind: "explain";
  plan: string;
  stats?: Record<string, unknown>;
};

/** `SELECT`. `columns` lists the output columns in projection (SELECT-list)
 * order and is omitted when the plan declares no static order — a `SELECT *`,
 * a join-`*`, or a set-op. Decode rows positionally off `columns` when it is
 * present; JSON object key order is not the projection order. */
export type SqlSelect = {
  kind: "select";
  rows: unknown[];
  columns?: string[];
};

/** `INSERT`. `inserted` is always present and counts NEWLY-inserted rows only.
 * `updated` / `skipped` appear only on `ON CONFLICT DO UPDATE` / `DO NOTHING`.
 * `returning` + `rows` appear exactly together, only for `INSERT … RETURNING`. */
export type SqlInsert = {
  kind: "insert";
  schema: string;
  inserted: number;
  updated?: number;
  skipped?: number;
  returning?: string[];
  rows?: unknown[];
};

/** `DELETE`. `pk` is present ONLY on the `WHERE <pk> = <literal>` fastpath —
 * a scan-predicate delete has no single row key and the engine omits the
 * field. `rows_affected` is set outside a transaction, `rows_buffered` inside
 * one; they are mutually exclusive. `returning` + `rows` appear exactly
 * together, only for `DELETE … RETURNING`. */
export type SqlDelete = {
  kind: "delete";
  schema: string;
  pk?: string;
  returning?: string[];
  rows?: unknown[];
  rows_buffered?: number;
  rows_affected?: number;
};

/** `UPDATE`. `returning` is reserved — the translator refuses
 * `UPDATE … RETURNING` today, so it is always absent. */
export type SqlUpdate = {
  kind: "update";
  schema: string;
  rows_affected: number;
  returning?: string[];
};

/** A write inside a transaction whose table is owned by a peer node. The
 * statement was buffered verbatim; the owning node validates it at COMMIT,
 * so constraint errors surface as a 409 on COMMIT, not here. */
export type SqlBuffered = { kind: "buffered"; schema: string; shard: number };

/** `BEGIN` / `COMMIT` / `ROLLBACK`. `ops_committed` is populated on commit so
 * the caller can confirm the buffer wasn't empty. */
export type SqlTx = {
  kind: "tx";
  op: "begin" | "commit" | "rollback" | "noop";
  ops_committed: number;
  session_id: string;
};

/** `CREATE TABLE`. `schema` is the registered `<namespace>.<table>` id. */
export type SqlCreateTable = { kind: "createtable"; schema: string };

/** `DROP TABLE`. `dropped` is `false` only for `IF EXISTS` on a table that
 * wasn't registered. */
export type SqlDropTable = {
  kind: "droptable";
  schema: string;
  dropped: boolean;
};

/** `ALTER TABLE`. Driven to completion synchronously: when this returns the
 * schema change is live. `state` is `"Completed"`, or `"noop"` (with an empty
 * `migration`) when every op was already satisfied. */
export type SqlAlterTable = {
  kind: "altertable";
  schema: string;
  migration: string;
  state: string;
  ops: number;
};

/** `CREATE INDEX`. `rows_indexed` counts the existing rows backfilled;
 * `created` is `false` only for `IF NOT EXISTS` on an existing index. */
export type SqlCreateIndex = {
  kind: "createindex";
  schema: string;
  index: string;
  rows_indexed: number;
  created: boolean;
};

/** `CREATE VIEW`. `replaced` is `true` when `CREATE OR REPLACE VIEW`
 * overwrote an existing definition. */
export type SqlCreateView = { kind: "createview"; view: string; replaced: boolean };

/** `DROP VIEW`. */
export type SqlDropView = { kind: "dropview"; view: string; dropped: boolean };

/** `CREATE SEQUENCE`. */
export type SqlCreateSequence = {
  kind: "createsequence";
  sequence: string;
  created: boolean;
};

/** `DROP SEQUENCE`. */
export type SqlDropSequence = {
  kind: "dropsequence";
  sequence: string;
  dropped: boolean;
};

/** `CREATE PROCEDURE`. */
export type SqlCreateProcedure = { kind: "createprocedure"; name: string };

/** `DROP PROCEDURE`. */
export type SqlDropProcedure = {
  kind: "dropprocedure";
  name: string;
  dropped: boolean;
};

/** `CREATE FUNCTION` (scalar SQL UDF). */
export type SqlCreateFunction = { kind: "createfunction"; name: string };

/** `DROP FUNCTION`. */
export type SqlDropFunction = {
  kind: "dropfunction";
  name: string;
  dropped: boolean;
};

/** Every shape `POST /v1/tenants/:t/sql` can answer with, discriminated on
 * `kind`. Narrow with `switch (resp.kind)` / `if (resp.kind === …)`. */
export type SqlResp =
  | SqlExplain
  | SqlSelect
  | SqlInsert
  | SqlDelete
  | SqlUpdate
  | SqlBuffered
  | SqlTx
  | SqlCreateTable
  | SqlDropTable
  | SqlAlterTable
  | SqlCreateIndex
  | SqlCreateView
  | SqlDropView
  | SqlCreateSequence
  | SqlDropSequence
  | SqlCreateProcedure
  | SqlDropProcedure
  | SqlCreateFunction
  | SqlDropFunction;

/** The `kind` discriminant of {@link SqlResp}. */
export type SqlRespKind = SqlResp["kind"];

// ── Engine: Vector ───────────────────────────────────────────────────────

/** Distance metric for a vector table. `"l1"` is an accepted alias of
 * `"manhattan"`. The engine lowercases the value before matching, and
 * REJECTS anything outside this set with a 400 — notably `"euclidean"`,
 * `"inner_product"`, and `"ip"` are NOT accepted. Defaults to `"cosine"`. */
export type VecMetric = "cosine" | "dot" | "l2" | "manhattan" | "l1";

export type VecPutReq = {
  id: string;
  embedding: number[];
  dim: number;
  metric?: VecMetric;
  metadata?: Record<string, unknown>;
};

export type VecTopkReq = {
  query: number[];
  k: number;
  dim: number;
  metric?: VecMetric;
  filter?: Record<string, unknown>;
  /** `"fast"` favours latency, `"high_recall"` favours recall. Server defaults
   * to `"high_recall"` when the field is absent. */
  mode?: "fast" | "high_recall";
};

export type VecHit = { id: string; score: number };

/** Which engine index family dispatches a vector delete. Mirrors the Rust
 * `oc_vector::IndexKind` snake_case serde representation. */
export type VecIndexKind = "hnsw" | "ivf" | "ivf_pq";

/** Response body for a vector delete. `deleted` is `false` on an idempotent
 * no-op (the id wasn't resident under `(tenant, table, id)`). */
export type VecDeleteResp = { deleted: boolean };

// ── Engine: Full-text ────────────────────────────────────────────────────

export type FtsMode = "boolean" | "bm25" | "phrase";
export type FtsIndexDoc = { doc_id: string; text: string };
export type RankedHit = { doc_id: string; score: number };

// ── Engine: Graph ────────────────────────────────────────────────────────

export type GraphBfsHit = { pk: string; depth: number };
export type GraphPath = { reachable: boolean };
export type DijkstraResult = { cost: number | null };

// ── Engine: Ask ──────────────────────────────────────────────────────────

export type AskRequest = { nl: string; schemas?: string[]; show_plan?: boolean };

/** Response of `POST /v1/tenants/:t/ask`.
 *
 * `cache` is the planner-cache disposition and is one of exactly two values.
 * `plan` and `explain` are gated on the SAME `show_plan` flag — both are
 * omitted from the wire when it is false, so they appear and disappear
 * together. */
export type AskResponse = {
  rows: unknown[];
  cache: "hit" | "miss";
  plan?: unknown;
  explain?: unknown;
};

// ── SDK config ───────────────────────────────────────────────────────────

/** Minimal subset of the global `fetch` signature the SDK actually uses.
 * Lets callers inject mocks (e.g. msw, nock-fetch, vitest's `vi.fn`) without
 * pulling in `lib.dom.d.ts`. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ClientOptions = {
  /** Engine endpoint, e.g. `https://t-abc.ap-south-1.db.originchain.ai`. */
  baseUrl: string;
  /** Bearer token issued at instance create / rotate-bearer. */
  bearer: string;
  /** Override the global `fetch` (testing, instrumentation). Defaults to
   * `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Override the tenant id parsed from `baseUrl`'s hostname. The SDK
   * derives `tenant_id` from the first DNS label of `baseUrl` by default -
   * pass this explicitly for non-standard hostnames or local dev. */
  tenantId?: string;
};

export type AdminClientOptions = {
  /** Control-plane base URL, e.g. `https://api.originchain.ai`. */
  baseUrl: string;
  /** Override the global `fetch`. */
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Send cookies with every request. Defaults to `"include"` for the
   * browser (matches the previous frontend behaviour). Set to `"omit"` for
   * Node-side use with explicit auth headers. */
  credentials?: RequestCredentials;
  /** Optional bearer to add to control-plane calls (e.g. when running from
   * Node where cookies aren't available). */
  bearer?: string;
};
