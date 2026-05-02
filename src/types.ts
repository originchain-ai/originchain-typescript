// Wire-format types for the OriginChain HTTP API.
//
// Names and casing mirror the engine's JSON exactly (snake_case for fields
// that come back from the engine; camelCase only for SDK-local extensions).
// Keep these in sync with `backend/crates/oc-http` types — when the engine
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
    | "provisioning"
    | "running"
    | "suspended"
    | "deleting"
    | "deleted"
    | "failed";
  endpoint: string | null;
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
  /** Shown once, never re-derivable — the store only keeps an argon2 hash. */
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

// ── Engine: SQL ──────────────────────────────────────────────────────────

export type SqlReq = { sql: string; params?: unknown[] };
export type SqlSelect = { kind: "select"; rows: unknown[] };
export type SqlInsert = { kind: "insert"; schema: string; rows: unknown[] };
export type SqlDelete = { kind: "delete"; schema: string; pk: string };
export type SqlResp = SqlSelect | SqlInsert | SqlDelete;

// ── Engine: Vector ───────────────────────────────────────────────────────

export type VecMetric = "cosine" | "dot" | "l2";

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
export type AskResponse = { rows: unknown[]; cache: string; plan?: unknown };

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
   * derives `tenant_id` from the first DNS label of `baseUrl` by default —
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
