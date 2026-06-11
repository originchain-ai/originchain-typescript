// OriginChain TypeScript client.
//
// Two classes:
//   * `OriginChainClient`     - talks to a per-tenant engine (bearer auth).
//   * `OriginChainAdminClient` - talks to the control plane (cookie auth, or
//                                bearer when used from Node).
//
// They are split because the auth model is fundamentally different: the
// engine takes an `Authorization: Bearer …` header, the control-plane takes
// a session cookie. Mixing them would force every method to learn about
// auth modes that don't apply to it.

import {
  ApiError,
  type ApiErrorBody,
  isAddonRequiredBody,
  OCAddonRequiredError,
  OCPaymentRequiredError,
} from "./errors.js";
import type {
  AddonEnableResponse,
  AddonRow,
  AdminClientOptions,
  AskResponse,
  AuthResponse,
  ClientOptions,
  ConfirmPaymentBody,
  ConfirmPaymentMethodBody,
  CurrentUsageResponse,
  DijkstraResult,
  Eligibility,
  EventView,
  FetchLike,
  FtsIndexDoc,
  FtsMode,
  GraphBfsHit,
  GraphPath,
  Instance,
  LogsResponse,
  MetricsResponse,
  MetricsSummaryResponse,
  PaymentMethodView,
  PendingPaymentResponse,
  PitrArchiveResponse,
  Plan,
  PlansResponse,
  ProvisionResponse,
  RankedHit,
  SetupIntent,
  SnapshotView,
  SqlResp,
  SqlSelect,
  Subscription,
  User,
  VecHit,
  VecMetric,
  VecPutReq,
  VecTopkReq,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Parse the tenant id from a hostname like
 * `tnt-01h….ap-south-1.db.originchain.ai` → `tnt-01h…`. Returns the empty
 * string when the URL is unparseable so callers get a clean error path. */
export function tenantIdFromEndpoint(endpoint: string): string {
  try {
    return new URL(endpoint).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

/** Resolve a fetch implementation lazily (at call time, not construct
 * time) so importing the SDK in an environment without `fetch` doesn't
 * crash at module load. */
function pickFetch(injected?: FetchLike): FetchLike {
  if (injected) return injected;
  return (input, init) => {
    const f = (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) {
      throw new Error(
        "OriginChainClient: no fetch implementation found. Pass `fetch` in " +
          "options, run on Node >= 18, or polyfill `globalThis.fetch`.",
      );
    }
    return f(input, init);
  };
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, "") + path;
}

/** Generate a fresh `Idempotency-Key` value (UUIDv4 in canonical hyphenated
 * form). Used for every write the SDK makes so a network retry is safe by
 * default - the engine's idempotency cache LRU-evicts at 10k entries with
 * a 24h TTL, so a fresh key per call is fine. Callers who need a stable key
 * across process restarts (e.g. distributed retries of the same logical
 * action) can pass `init.headers["idempotency-key"]` explicitly. */
function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for older runtimes that have getRandomValues but no randomUUID.
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6]! & 0x0f) | 0x40; // version 4
    b[8] = (b[8]! & 0x3f) | 0x80; // variant 1
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
  }
  // Last-resort: Math.random. Documented unsafe for cryptographic uniqueness
  // but the idempotency key only needs to be unique-enough within the
  // engine's 10k LRU cache, not unguessable.
  let out = "";
  for (let i = 0; i < 16; i++) {
    const r = (Math.random() * 256) | 0;
    out += r.toString(16).padStart(2, "0");
    if (i === 3 || i === 5 || i === 7 || i === 9) out += "-";
  }
  return out;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Map an HTTP response into an `ApiError` subclass. Always throws. */
function raiseFor(status: number, body: unknown): never {
  // 402 + canonical add-on body → typed error.
  if (status === 402 && isAddonRequiredBody(body)) {
    throw new OCAddonRequiredError(
      body.msg ?? `This endpoint requires the ${body.name} add-on.`,
      body.addon,
      body.name,
      body.monthly_usd,
      Boolean(body.preview),
      Boolean(body.enterprise_only),
      body.purchase_url,
    );
  }
  if (status === 402) {
    const msg =
      (body && typeof body === "object" && "msg" in body
        ? String((body as { msg?: unknown }).msg ?? "")
        : "") || "payment required";
    throw new OCPaymentRequiredError(msg, body);
  }
  let code = "http_error";
  let message = `HTTP ${status}`;
  if (body && typeof body === "object") {
    const e = body as ApiErrorBody;
    if (typeof e.error === "string") {
      // Some endpoints return `{ "error": "snake_case_code" }` flat - map
      // that into the `code` slot so callers can switch on it.
      code = e.error;
      message = e.error;
    } else if (e.error && typeof e.error === "object") {
      code = e.error.code ?? code;
      message = e.error.message ?? message;
    }
  } else if (typeof body === "string" && body) {
    message = body;
  }
  throw new ApiError(status, code, message);
}

// ── Engine client ────────────────────────────────────────────────────────

/** Per-tenant engine client. One instance per (endpoint, bearer) pair. */
export class OriginChainClient {
  readonly baseUrl: string;
  readonly bearer: string;
  readonly tenantId: string;
  readonly graph: GraphMethods;

  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    if (!opts.baseUrl) throw new Error("OriginChainClient: baseUrl required");
    if (!opts.bearer) throw new Error("OriginChainClient: bearer required");
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.bearer = opts.bearer;
    this.tenantId = opts.tenantId ?? tenantIdFromEndpoint(this.baseUrl);
    this.fetch = pickFetch(opts.fetch);
    // Default 60 s. The dashboard's snapshot listing endpoint can take
    // 20-40 s on its first (uncached) call against the managed snapshot
    // service; later calls hit a 5-min response cache on the backend.
    this.timeoutMs = opts.timeoutMs ?? 60000;
    this.graph = new GraphMethods(this);
  }

  // ── Internal request plumbing ──────────────────────────────────────────

  /** @internal */
  async _request<T>(
    path: string,
    init: RequestInit & { rawBody?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.bearer}`,
      accept: "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (!init.rawBody && init.body !== undefined) {
      headers["content-type"] ??= "application/json";
    }
    // Mutating requests get an Idempotency-Key by default. Server-side cache
    // is bounded (LRU 10k + 24h TTL) so fresh-per-call is safe. Callers that
    // need a stable key (e.g. distributed retry of the same logical action)
    // override by passing `init.headers["idempotency-key"]` themselves.
    const method = (init.method ?? "GET").toUpperCase();
    if (MUTATING_METHODS.has(method) && !headers["idempotency-key"]) {
      headers["idempotency-key"] = newIdempotencyKey();
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const { rawBody: _rawBody, ...fetchInit } = init;
      const res = await this.fetch(joinUrl(this.baseUrl, path), {
        ...fetchInit,
        headers,
        signal: ctrl.signal,
      });
      const body = await readBody(res);
      if (!res.ok) raiseFor(res.status, body);
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Schemas ────────────────────────────────────────────────────────────

  listSchemas(): Promise<string[]> {
    return this._request<string[]>(`/v1/tenants/${this.tenantId}/schemas`);
  }

  getSchema(schema: string): Promise<string> {
    return this._request<string>(
      `/v1/tenants/${this.tenantId}/schemas/${schema}`,
    );
  }

  registerSchema(toml: string): Promise<{ id: string; tenant: string }> {
    return this._request<{ id: string; tenant: string }>(
      `/v1/tenants/${this.tenantId}/schemas`,
      {
        method: "POST",
        body: toml,
        headers: { "content-type": "text/plain" },
        rawBody: true,
      },
    );
  }

  // ── SQL ────────────────────────────────────────────────────────────────

  /** Execute a SQL statement. Returns a discriminated union on `kind`:
   * `"select"` (rows), `"insert"` (server-translated typed row payload),
   * or `"delete"` (server-translated typed PK). */
  sql(query: string, params?: unknown[]): Promise<SqlResp> {
    const body: { sql: string; params?: unknown[] } = { sql: query };
    if (params !== undefined) body.params = params;
    return this._request<SqlResp>(`/v1/tenants/${this.tenantId}/sql`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** Convenience: run a SELECT and return the first row, or `null`. Raises
   * `ApiError` if the statement isn't a SELECT - there's no "first" of an
   * INSERT or DELETE translation. */
  async sqlOne(
    query: string,
    params?: unknown[],
  ): Promise<Record<string, unknown> | null> {
    const resp = await this.sql(query, params);
    if (resp.kind !== "select") {
      throw new ApiError(
        400,
        "validation_failed",
        `sqlOne expected SELECT, got ${resp.kind}`,
      );
    }
    const sel = resp as SqlSelect;
    if (!sel.rows.length) return null;
    const first = sel.rows[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return first as Record<string, unknown>;
    }
    return { value: first };
  }

  // ── Vector ─────────────────────────────────────────────────────────────

  vectorPut(
    table: string,
    opts: {
      id: string;
      embedding: number[];
      dim: number;
      metric?: VecMetric;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const body: VecPutReq = {
      id: opts.id,
      embedding: opts.embedding,
      dim: opts.dim,
    };
    if (opts.metric !== undefined) body.metric = opts.metric;
    if (opts.metadata !== undefined) body.metadata = opts.metadata;
    return this._request<void>(
      `/v1/tenants/${this.tenantId}/vector/${table}/put`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  vectorTopk(
    table: string,
    opts: {
      query: number[];
      k: number;
      dim: number;
      metric?: VecMetric;
      filter?: Record<string, unknown>;
      mode?: "fast" | "high_recall";
    },
  ): Promise<VecHit[]> {
    const body: VecTopkReq = {
      query: opts.query,
      k: opts.k,
      dim: opts.dim,
    };
    if (opts.metric !== undefined) body.metric = opts.metric;
    if (opts.filter !== undefined) body.filter = opts.filter;
    if (opts.mode !== undefined) body.mode = opts.mode;
    return this._request<VecHit[]>(
      `/v1/tenants/${this.tenantId}/vector/${table}/topk`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  // ── Full-text ──────────────────────────────────────────────────────────

  ftsIndex(
    table: string,
    field: string,
    opts: { doc_id: string; text: string },
  ): Promise<void> {
    const doc: FtsIndexDoc = { doc_id: opts.doc_id, text: opts.text };
    return this._request<void>(
      `/v1/tenants/${this.tenantId}/fts/${table}/${field}`,
      { method: "POST", body: JSON.stringify(doc) },
    );
  }

  /** Full-text search.
   *
   * `mode="boolean"` (default) AND-matches all tokens and returns unranked
   * `doc_id` strings. `mode="bm25"` returns the top-`k` hits ranked by BM25.
   * `mode="phrase"` requires the tokens in order. The response shape varies
   * by mode - boolean/phrase return `string[]`, bm25 returns
   * `{ doc_id, score }[]`. */
  ftsSearch(
    table: string,
    field: string,
    opts: { q: string; mode?: FtsMode; k?: number },
  ): Promise<string[] | RankedHit[]> {
    const qs = new URLSearchParams({ q: opts.q });
    if (opts.mode) qs.set("mode", opts.mode);
    if (typeof opts.k === "number") qs.set("k", String(opts.k));
    return this._request<string[] | RankedHit[]>(
      `/v1/tenants/${this.tenantId}/fts/${table}/${field}?${qs.toString()}`,
    );
  }

  // ── Ask (NL → query) ──────────────────────────────────────────────────

  ask(
    question: string,
    opts: { schemas?: string[]; show_plan?: boolean } = {},
  ): Promise<AskResponse> {
    const body: { nl: string; schemas?: string[]; show_plan?: boolean } = {
      nl: question,
    };
    if (opts.schemas !== undefined) body.schemas = opts.schemas;
    if (opts.show_plan !== undefined) body.show_plan = opts.show_plan;
    return this._request<AskResponse>(`/v1/tenants/${this.tenantId}/ask`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // ── Structured query ──────────────────────────────────────────────────

  query(plan: unknown): Promise<unknown[]> {
    return this._request<unknown[]>(`/v1/tenants/${this.tenantId}/query`, {
      method: "POST",
      body: JSON.stringify(plan),
    });
  }
}

// ── Graph methods (sub-namespace) ────────────────────────────────────────

export class GraphMethods {
  private readonly p: OriginChainClient;
  constructor(parent: OriginChainClient) {
    this.p = parent;
  }

  neighbors(
    schema: string,
    opts: { rel: string; pk: string },
  ): Promise<string[]> {
    const qs = new URLSearchParams({ rel: opts.rel, pk: opts.pk });
    return this.p._request<string[]>(
      `/v1/tenants/${this.p.tenantId}/graph/${schema}/neighbors?${qs.toString()}`,
    );
  }

  reverseNeighbors(
    schema: string,
    opts: { rel: string; pk: string },
  ): Promise<string[]> {
    const qs = new URLSearchParams({ rel: opts.rel, pk: opts.pk });
    return this.p._request<string[]>(
      `/v1/tenants/${this.p.tenantId}/graph/${schema}/reverse?${qs.toString()}`,
    );
  }

  bfs(
    schema: string,
    opts: { rel: string; pk: string; max_depth?: number },
  ): Promise<GraphBfsHit[]> {
    const qs = new URLSearchParams({ rel: opts.rel, pk: opts.pk });
    if (typeof opts.max_depth === "number") {
      qs.set("max_depth", String(opts.max_depth));
    }
    return this.p._request<GraphBfsHit[]>(
      `/v1/tenants/${this.p.tenantId}/graph/${schema}/bfs?${qs.toString()}`,
    );
  }

  path(
    schema: string,
    opts: { rel: string; src: string; dst: string; max_depth?: number },
  ): Promise<GraphPath> {
    const qs = new URLSearchParams({
      rel: opts.rel,
      src: opts.src,
      dst: opts.dst,
    });
    if (typeof opts.max_depth === "number") {
      qs.set("max_depth", String(opts.max_depth));
    }
    return this.p._request<GraphPath>(
      `/v1/tenants/${this.p.tenantId}/graph/${schema}/path?${qs.toString()}`,
    );
  }

  /** Dijkstra over a typed relation. The `weights` map is JSON-stringified
   * into the `weights_json` query parameter (NOT a request body) - backend
   * reads `q.weights_json`. */
  dijkstra(
    schema: string,
    opts: {
      rel: string;
      src: string;
      dst: string;
      weights: Record<string, number>;
    },
  ): Promise<DijkstraResult> {
    const qs = new URLSearchParams({
      rel: opts.rel,
      src: opts.src,
      dst: opts.dst,
      weights_json: JSON.stringify(opts.weights),
    });
    return this.p._request<DijkstraResult>(
      `/v1/tenants/${this.p.tenantId}/graph/${schema}/dijkstra?${qs.toString()}`,
    );
  }
}

// ── Admin (control-plane) client ─────────────────────────────────────────

/** Control-plane client. Cookie-auth in the browser; pass `bearer` to use
 * from Node. */
export class OriginChainAdminClient {
  readonly baseUrl: string;
  readonly auth: AuthMethods;
  readonly plans: PlansMethods;
  readonly subscriptions: SubscriptionsMethods;
  readonly instances: InstancesMethods;
  readonly addons: AddonsMethods;
  readonly billing: BillingMethods;
  readonly events: EventsMethods;

  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly credentials: RequestCredentials;
  private readonly bearer: string | undefined;

  constructor(opts: AdminClientOptions) {
    if (!opts.baseUrl)
      throw new Error("OriginChainAdminClient: baseUrl required");
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetch = pickFetch(opts.fetch);
    // Default 60 s. The dashboard's snapshot listing endpoint can take
    // 20-40 s on its first (uncached) call against the managed snapshot
    // service; later calls hit a 5-min response cache on the backend.
    this.timeoutMs = opts.timeoutMs ?? 60000;
    this.credentials = opts.credentials ?? "include";
    this.bearer = opts.bearer;
    this.auth = new AuthMethods(this);
    this.plans = new PlansMethods(this);
    this.subscriptions = new SubscriptionsMethods(this);
    this.instances = new InstancesMethods(this);
    this.addons = new AddonsMethods(this);
    this.billing = new BillingMethods(this);
    this.events = new EventsMethods(this);
  }

  /** @internal */
  async _request<T>(
    path: string,
    init: RequestInit & { rawBody?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (!init.rawBody && init.body !== undefined) {
      headers["content-type"] ??= "application/json";
    }
    if (this.bearer) headers["authorization"] = `Bearer ${this.bearer}`;
    // Auto-Idempotency-Key on mutating control-plane calls. Operation-backend
    // doesn't enforce idempotency today (the body is harmless and ignored),
    // but stamping the header keeps the wire shape consistent with the engine
    // client and lets us light it up on the control plane without a SDK
    // version bump later.
    const method = (init.method ?? "GET").toUpperCase();
    if (MUTATING_METHODS.has(method) && !headers["idempotency-key"]) {
      headers["idempotency-key"] = newIdempotencyKey();
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const { rawBody: _rawBody, ...fetchInit } = init;
      const res = await this.fetch(joinUrl(this.baseUrl, path), {
        credentials: this.credentials,
        ...fetchInit,
        headers,
        signal: ctrl.signal,
      });
      const body = await readBody(res);
      if (!res.ok) raiseFor(res.status, body);
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<string> {
    return this._request<string>("/health");
  }
}

// Sub-namespaces: each takes a private parent reference. They exist for
// caller ergonomics (`admin.instances.list()` reads better than
// `admin.listInstances()`) but stay thin - no state, no mutation.

class AuthMethods {
  constructor(private readonly p: OriginChainAdminClient) {}
  signup(body: { email: string; password: string; org_name: string }) {
    return this.p._request<AuthResponse>("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  signin(body: { email: string; password: string }) {
    return this.p._request<AuthResponse>("/v1/auth/signin", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  /** Request a 6-digit OTP for OTP-based signin. Always returns sent=true
   *  regardless of whether the email matches a registered account
   *  (account-enumeration posture). The OTP is emailed via SES; the
   *  customer pastes it back to /v1/auth/login/otp/verify. */
  loginOtpRequest(body: { email: string }) {
    return this.p._request<{ sent: boolean; expires_at: string }>(
      "/v1/auth/login/otp/request",
      { method: "POST", body: JSON.stringify(body) },
    );
  }
  /** Verify a login OTP. On success returns AuthResponse + sets the
   *  session cookie. Failure shape is always 401 regardless of which
   *  check failed (wrong code / expired / no row). */
  loginOtpVerify(body: { email: string; code: string }) {
    return this.p._request<AuthResponse>("/v1/auth/login/otp/verify", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  signout() {
    return this.p._request<void>("/v1/auth/signout", { method: "POST" });
  }
  me() {
    return this.p._request<User>("/v1/auth/me");
  }
  changePassword(body: { current_password: string; new_password: string }) {
    return this.p._request<void>("/v1/auth/password", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  revokeAllOtherSessions() {
    return this.p._request<{ revoked: number }>(
      "/v1/auth/sessions/revoke-all",
      { method: "POST" },
    );
  }
  /** Request a password-reset email. The backend always returns
   *  `{ sent: true }` regardless of whether the email is registered -
   *  do not surface "no such user" hints in the UI. */
  forgotPassword(body: { email: string }) {
    return this.p._request<{ sent: boolean }>(
      "/v1/auth/forgot-password",
      { method: "POST", body: JSON.stringify(body) },
    );
  }
  /** Redeem a reset token + set a new password. The backend revokes
   *  every active session for the user as a side effect. */
  resetPassword(body: { token: string; new_password: string }) {
    return this.p._request<void>(
      "/v1/auth/reset-password",
      { method: "POST", body: JSON.stringify(body) },
    );
  }
}

class PlansMethods {
  constructor(private readonly p: OriginChainAdminClient) {}
  list() {
    return this.p._request<PlansResponse>("/v1/plans");
  }
}

class SubscriptionsMethods {
  constructor(private readonly p: OriginChainAdminClient) {}
  list() {
    return this.p._request<Subscription[]>("/v1/subscriptions");
  }
  create(body: { compute_plan_id: string; storage_plan_id: string }) {
    return this.p._request<Subscription>("/v1/subscriptions", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

class InstancesMethods {
  constructor(private readonly p: OriginChainAdminClient) {}
  list(opts: { include_deleted?: boolean } = {}) {
    const path = opts.include_deleted
      ? "/v1/instances?include_deleted=true"
      : "/v1/instances";
    return this.p._request<Instance[]>(path);
  }
  get(id: string) {
    return this.p._request<Instance>(`/v1/instances/${id}`);
  }
  snapshots(id: string) {
    return this.p._request<SnapshotView[]>(`/v1/instances/${id}/snapshots`);
  }
  metrics(id: string, minutes = 60, period = 60) {
    return this.p._request<MetricsResponse>(
      `/v1/instances/${id}/metrics?minutes=${minutes}&period=${period}`,
    );
  }
  /// Per-shape latency tiles + storage panel rollup. Sibling of
  /// `metrics()`; the time-series endpoint stays unchanged. The
  /// backend may return `null` for `p99_ms`, `qps`, or any storage
  /// component when the engine doesn't yet emit the underlying
  /// counter - callers should render "-" rather than fabricate.
  metricsSummary(id: string) {
    return this.p._request<MetricsSummaryResponse>(
      `/v1/instances/${id}/metrics-summary`,
    );
  }
  /// Sealed-segment archive listing. Read-only - pause/resume of the
  /// tail-shipper is operator-only and intentionally absent.
  pitrArchive(id: string) {
    return this.p._request<PitrArchiveResponse>(
      `/v1/instances/${id}/pitr/archive`,
    );
  }
  logs(id: string, tail = 200) {
    return this.p._request<LogsResponse>(`/v1/instances/${id}/logs?tail=${tail}`);
  }
  listSchemas(id: string) {
    return this.p._request<string[]>(`/v1/instances/${id}/schemas`);
  }
  getSchema(id: string, schema: string) {
    return this.p._request<string>(`/v1/instances/${id}/schemas/${schema}`);
  }
  registerSchema(id: string, toml: string) {
    return this.p._request<{ id: string; tenant: string }>(
      `/v1/instances/${id}/schemas`,
      {
        method: "POST",
        body: toml,
        headers: { "content-type": "text/plain" },
        rawBody: true,
      },
    );
  }
  runQuery(id: string, plan: unknown) {
    return this.p._request<unknown[]>(`/v1/instances/${id}/query`, {
      method: "POST",
      body: JSON.stringify(plan),
    });
  }
  runAsk(
    id: string,
    body: { nl: string; schemas?: string[]; show_plan?: boolean },
  ) {
    return this.p._request<AskResponse>(`/v1/instances/${id}/ask`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  create(body: {
    name: string;
    region: string;
    compute_plan_id: string;
    storage_plan_id: string;
  }) {
    return this.p._request<ProvisionResponse | PendingPaymentResponse>(
      "/v1/instances",
      { method: "POST", body: JSON.stringify(body) },
    );
  }
  confirmPayment(id: string, body: ConfirmPaymentBody) {
    return this.p._request<ProvisionResponse>(
      `/v1/instances/${id}/confirm-payment`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }
  delete(id: string) {
    return this.p._request<void>(`/v1/instances/${id}`, { method: "DELETE" });
  }
  rotateBearer(id: string) {
    return this.p._request<ProvisionResponse>(
      `/v1/instances/${id}/rotate-bearer`,
      { method: "POST" },
    );
  }
}

class AddonsMethods {
  constructor(private readonly p: OriginChainAdminClient) {}
  async list(instanceId: string): Promise<AddonRow[]> {
    const r = await this.p._request<{ addons: AddonRow[] }>(
      `/v1/instances/${instanceId}/addons`,
    );
    return r.addons;
  }
  enable(instanceId: string, addonId: string, previewConsent: boolean) {
    return this.p._request<AddonEnableResponse>(
      `/v1/instances/${instanceId}/addons`,
      {
        method: "POST",
        body: JSON.stringify({
          addon_id: addonId,
          preview_consent: previewConsent,
        }),
      },
    );
  }
  disable(instanceId: string, addonId: string) {
    return this.p._request<void>(
      `/v1/instances/${instanceId}/addons/${addonId}`,
      { method: "DELETE" },
    );
  }
}

class BillingMethods {
  constructor(private readonly p: OriginChainAdminClient) {}
  eligibility() {
    return this.p._request<Eligibility>("/v1/billing/eligibility");
  }
  setupIntent() {
    return this.p._request<SetupIntent>("/v1/billing/setup-intent", {
      method: "POST",
    });
  }
  confirmPaymentMethod(body: ConfirmPaymentMethodBody) {
    return this.p._request<PaymentMethodView>("/v1/billing/payment-method", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  getPaymentMethod() {
    return this.p._request<PaymentMethodView>("/v1/billing/payment-method");
  }
  removePaymentMethod() {
    return this.p._request<void>("/v1/billing/payment-method", {
      method: "DELETE",
    });
  }
  /// Current-period billing rollup, per-org. Compute + addon line
  /// items from the DB, plus a placeholder overage line at $0 until
  /// usage metering is wired. The frontend's `/app/billing/usage`
  /// page renders this directly.
  currentUsage() {
    return this.p._request<CurrentUsageResponse>("/v1/usage/current");
  }
}

class EventsMethods {
  constructor(private readonly p: OriginChainAdminClient) {}
  list(limit = 20) {
    return this.p._request<EventView[]>(`/v1/events?limit=${limit}`);
  }
}

// Re-export for callers that want to construct typed Plan etc. directly.
export type {
  AddonEnableResponse,
  AddonRow,
  AskResponse,
  AuthResponse,
  ClientOptions,
  ConfirmPaymentBody,
  CurrentUsageResponse,
  Eligibility,
  EventView,
  Instance,
  LogsResponse,
  MetricsResponse,
  MetricsSummaryResponse,
  PaymentMethodView,
  PitrArchiveResponse,
  Plan,
  PlansResponse,
  ProvisionResponse,
  SetupIntent,
  SnapshotView,
  Subscription,
  User,
};
