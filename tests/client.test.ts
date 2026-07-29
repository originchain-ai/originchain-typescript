// Happy-path coverage for OriginChainClient. Every test injects a mock
// `fetch` so we never touch the network - the SDK's plumbing (URL, headers,
// body, response decode) is what we're verifying, not the engine itself.

import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  edgeWeightKey,
  OCAddonRequiredError,
  OriginChainAdminClient,
  OriginChainClient,
  type FetchLike,
} from "../src/index.js";

const BASE = "https://tnt-test.ap-south-1.db.originchain.ai";
const BEARER = "test-bearer-token";

/** Build a fetch mock that returns a single canned response. The mock
 * records every call so assertions can inspect URL/init. */
function mockFetch(
  status: number,
  body: unknown,
  contentType = "application/json",
): { fetch: FetchLike; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = vi.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init: init ?? {} });
      const text =
        typeof body === "string" ? body : body === undefined ? "" : JSON.stringify(body);
      return Promise.resolve(
        new Response(text, {
          status,
          headers: { "content-type": contentType },
        }),
      );
    },
  );
  return { fetch, calls };
}

describe("OriginChainClient", () => {
  it("sends sql() with bearer auth and returns the typed select response", async () => {
    const { fetch, calls } = mockFetch(200, {
      kind: "select",
      rows: [{ id: 1, email: "a@b.c" }],
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("SELECT id, email FROM shop.customers LIMIT 1");

    expect(resp.kind).toBe("select");
    if (resp.kind === "select") {
      expect(resp.rows).toEqual([{ id: 1, email: "a@b.c" }]);
    }

    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c!.url).toBe(`${BASE}/v1/tenants/tnt-test/sql`);
    expect(c!.init.method).toBe("POST");
    const headers = c!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${BEARER}`);
    expect(headers["content-type"]).toBe("application/json");
    // Mutating call must auto-attach Idempotency-Key in canonical UUIDv4
    // shape so a network retry deduplicates against the engine's idem
    // cache. A regression that stops sending the header would turn every
    // flaky network into a duplicate write.
    expect(headers["idempotency-key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(JSON.parse(c!.init.body as string)).toEqual({
      sql: "SELECT id, email FROM shop.customers LIMIT 1",
    });
  });

  // ── /sql wire contract ────────────────────────────────────────────────
  //
  // The engine's `SqlResp` is `#[serde(tag = "kind", rename_all =
  // "lowercase")]`, so these bodies are byte-for-byte what the engine emits.
  // They pin the shapes the union used to get wrong.

  it("decodes an EXPLAIN response (kind=explain) without losing the plan", async () => {
    const { fetch } = mockFetch(200, {
      kind: "explain",
      plan: "Limit(10)\n  Filter(id = 1)\n    Scan(shop.customers)",
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("EXPLAIN SELECT * FROM shop.customers");

    expect(resp.kind).toBe("explain");
    if (resp.kind !== "explain") throw new Error("expected explain");
    expect(resp.plan).toContain("Scan(shop.customers)");
    // Plain EXPLAIN omits `stats` entirely; only EXPLAIN ANALYZE sets it.
    expect(resp.stats).toBeUndefined();
  });

  it("decodes an EXPLAIN ANALYZE response with per-operator stats", async () => {
    const { fetch } = mockFetch(200, {
      kind: "explain",
      plan: "Scan(shop.customers) (actual rows=3)",
      stats: { rows: 3, ms: 1.2 },
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("EXPLAIN ANALYZE SELECT * FROM shop.customers");

    if (resp.kind !== "explain") throw new Error("expected explain");
    expect(resp.stats).toEqual({ rows: 3, ms: 1.2 });
  });

  it("decodes a scan-predicate DELETE, where the engine omits `pk`", async () => {
    // A `DELETE … WHERE <non-pk predicate>` has no single row key, so the
    // engine omits `pk` (skip_serializing_if). Modelling it as required made
    // callers read `undefined` through a `string`-typed field.
    const { fetch } = mockFetch(200, {
      kind: "delete",
      schema: "shop.customers",
      rows_affected: 7,
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("DELETE FROM shop.customers WHERE active = false");

    if (resp.kind !== "delete") throw new Error("expected delete");
    expect(resp.pk).toBeUndefined();
    expect(resp.rows_affected).toBe(7);
    expect(resp.rows_buffered).toBeUndefined();
  });

  it("decodes a pk-fastpath DELETE, where the engine sets `pk`", async () => {
    const { fetch } = mockFetch(200, {
      kind: "delete",
      schema: "shop.customers",
      pk: "c-1",
      rows_affected: 1,
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("DELETE FROM shop.customers WHERE id = 'c-1'");

    if (resp.kind !== "delete") throw new Error("expected delete");
    expect(resp.pk).toBe("c-1");
  });

  it("decodes INSERT … RETURNING with the always-present `inserted` count", async () => {
    const { fetch } = mockFetch(200, {
      kind: "insert",
      schema: "shop.customers",
      inserted: 2,
      returning: ["id", "email"],
      rows: [
        { id: "c-1", email: "a@b.c" },
        { id: "c-2", email: "d@e.f" },
      ],
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql(
      "INSERT INTO shop.customers (email) VALUES ('a@b.c'), ('d@e.f') RETURNING id, email",
    );

    if (resp.kind !== "insert") throw new Error("expected insert");
    expect(resp.inserted).toBe(2);
    expect(resp.returning).toEqual(["id", "email"]);
    expect(resp.rows).toHaveLength(2);
  });

  it("decodes a plain INSERT, where the engine omits `returning` and `rows`", async () => {
    const { fetch } = mockFetch(200, {
      kind: "insert",
      schema: "shop.customers",
      inserted: 1,
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("INSERT INTO shop.customers (email) VALUES ('a@b.c')");

    if (resp.kind !== "insert") throw new Error("expected insert");
    expect(resp.inserted).toBe(1);
    expect(resp.rows).toBeUndefined();
    expect(resp.returning).toBeUndefined();
  });

  it("decodes an UPDATE result", async () => {
    const { fetch } = mockFetch(200, {
      kind: "update",
      schema: "shop.customers",
      rows_affected: 3,
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("UPDATE shop.customers SET active = true");

    if (resp.kind !== "update") throw new Error("expected update");
    expect(resp.rows_affected).toBe(3);
  });

  it("decodes a transaction-control result", async () => {
    const { fetch } = mockFetch(200, {
      kind: "tx",
      op: "commit",
      ops_committed: 4,
      session_id: "sess-1",
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("COMMIT");

    if (resp.kind !== "tx") throw new Error("expected tx");
    expect(resp.op).toBe("commit");
    expect(resp.ops_committed).toBe(4);
    expect(resp.session_id).toBe("sess-1");
  });

  it("decodes DDL results, whose `kind` tags are lowercased with no separator", async () => {
    // serde's `rename_all = "lowercase"` does NOT insert an underscore:
    // `CreateTable` serialises as "createtable", not "create_table".
    const { fetch } = mockFetch(200, {
      kind: "createindex",
      schema: "shop.customers",
      index: "idx_email",
      rows_indexed: 120,
      created: true,
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("CREATE INDEX idx_email ON shop.customers (email)");

    if (resp.kind !== "createindex") throw new Error("expected createindex");
    expect(resp.index).toBe("idx_email");
    expect(resp.rows_indexed).toBe(120);
    expect(resp.created).toBe(true);
  });

  it("exposes SELECT projection order via `columns` when the plan declares one", async () => {
    const { fetch } = mockFetch(200, {
      kind: "select",
      rows: [{ email: "a@b.c", id: 1 }],
      columns: ["id", "email"],
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.sql("SELECT id, email FROM shop.customers");

    if (resp.kind !== "select") throw new Error("expected select");
    // JSON object key order is NOT projection order - `columns` is.
    expect(resp.columns).toEqual(["id", "email"]);
  });

  it("sql() threads positional bind params into the request body", async () => {
    const { fetch, calls } = mockFetch(200, { kind: "select", rows: [] });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    await oc.sql("SELECT * FROM shop.customers WHERE id = $1", ["c-1"]);

    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      sql: "SELECT * FROM shop.customers WHERE id = $1",
      params: ["c-1"],
    });
  });

  it("sqlOne() rejects a non-SELECT kind", async () => {
    const { fetch } = mockFetch(200, {
      kind: "insert",
      schema: "shop.customers",
      inserted: 1,
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    await expect(
      oc.sqlOne("INSERT INTO shop.customers (email) VALUES ('a@b.c')"),
    ).rejects.toMatchObject({ status: 400, code: "validation_failed" });
  });

  it("usage() GETs /usage and exposes the neutral configuration (no weather codename)", async () => {
    const { fetch, calls } = mockFetch(200, {
      tenant: "tnt-test",
      tier: "standard",
      configuration: {
        slug: "standard",
        label: "4 vCPU / 16 GB, HA",
        vcpu: 4,
        ram_gb: 16,
        storage_gb: 100,
        ha: true,
        monthly_price: 699,
      },
      used: { store_keys: 42 },
      schemas: [],
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const u = await oc.usage();

    // Neutral slug, never the weather codename.
    expect(u.tier).toBe("standard");
    expect(u.configuration?.slug).toBe("standard");
    expect(u.configuration?.vcpu).toBe(4);
    expect(u.configuration?.monthly_price).toBe(699);
    expect(JSON.stringify(u).toLowerCase()).not.toContain("storm");

    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c!.url).toBe(`${BASE}/v1/tenants/tnt-test/usage`);
    // Read-only: a plain GET, no Idempotency-Key.
    const headers = c!.init.headers as Record<string, string>;
    expect(c!.init.method ?? "GET").toBe("GET");
    expect(headers["idempotency-key"]).toBeUndefined();
  });

  it("auto-generates Idempotency-Key on every mutating call", async () => {
    const { fetch, calls } = mockFetch(200, { kind: "select", rows: [] });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    await oc.sql("SELECT 1");
    await oc.sql("SELECT 2");
    const k1 = (calls[0]!.init.headers as Record<string, string>)[
      "idempotency-key"
    ];
    const k2 = (calls[1]!.init.headers as Record<string, string>)[
      "idempotency-key"
    ];
    expect(k1).toBeTruthy();
    expect(k2).toBeTruthy();
    expect(k1).not.toBe(k2); // fresh per call
  });

  it("caller-supplied Idempotency-Key wins over the auto-generated one", async () => {
    const { fetch, calls } = mockFetch(200, { id: "demo.x", tenant: "t" });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    // registerSchema doesn't expose a key parameter, so we exercise the
    // override path through the underlying _request. Mirrors the wire
    // contract any future per-method override would use.
    await oc._request("/v1/tenants/tnt-test/sql", {
      method: "POST",
      body: JSON.stringify({ sql: "SELECT 1" }),
      headers: { "idempotency-key": "caller-stable-key" },
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("caller-stable-key");
  });

  it("does NOT attach Idempotency-Key to GET reads", async () => {
    const { fetch, calls } = mockFetch(200, ["demo.users"]);
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    await oc.listSchemas();
    const headers = calls[0]!.init.headers as Record<string, string>;
    // GETs must not consume an idempotency cache slot.
    expect(headers["idempotency-key"]).toBeUndefined();
  });

  it("vectorTopk threads `mode: 'high_recall'` into the request body", async () => {
    const { fetch, calls } = mockFetch(200, [
      { id: "doc-1", score: 0.9 },
      { id: "doc-2", score: 0.7 },
    ]);
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const hits = await oc.vectorTopk("embeddings", {
      query: [0.1, 0.2, 0.3],
      k: 5,
      dim: 3,
      metric: "cosine",
      mode: "high_recall",
    });

    expect(hits).toHaveLength(2);
    expect(hits[0]?.id).toBe("doc-1");

    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.mode).toBe("high_recall");
    expect(body.dim).toBe(3);
    expect(body.k).toBe(5);
    expect(calls[0]!.url).toBe(
      `${BASE}/v1/tenants/tnt-test/vector/embeddings/topk`,
    );
  });

  it("vectorDelete issues a DELETE with index + repair query params", async () => {
    const { fetch, calls } = mockFetch(200, { deleted: true });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.vectorDelete("embeddings", "doc-1", {
      index: "ivf",
      repair: false,
    });

    expect(resp.deleted).toBe(true);
    expect(calls[0]!.init.method).toBe("DELETE");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/tenants/tnt-test/vector/embeddings/doc-1");
    expect(url.searchParams.get("index")).toBe("ivf");
    expect(url.searchParams.get("repair")).toBe("false");
  });

  it("vectorDelete omits the query string when no opts are given", async () => {
    const { fetch, calls } = mockFetch(200, { deleted: false });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const resp = await oc.vectorDelete("embeddings", "missing-id");

    expect(resp.deleted).toBe(false);
    expect(calls[0]!.url).toBe(
      `${BASE}/v1/tenants/tnt-test/vector/embeddings/missing-id`,
    );
  });

  it("ftsSearch builds a query string with mode + k", async () => {
    const { fetch, calls } = mockFetch(200, [
      { doc_id: "d1", score: 1.4 },
      { doc_id: "d2", score: 0.9 },
    ]);
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const hits = await oc.ftsSearch("articles", "body", {
      q: "quick fox",
      mode: "bm25",
      k: 5,
    });

    expect(Array.isArray(hits)).toBe(true);
    expect(hits).toHaveLength(2);

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/tenants/tnt-test/fts/articles/body");
    expect(url.searchParams.get("q")).toBe("quick fox");
    expect(url.searchParams.get("mode")).toBe("bm25");
    expect(url.searchParams.get("k")).toBe("5");
  });

  it("graph.dijkstra serialises PER-EDGE weights into weights_json (NOT a body)", async () => {
    // The engine looks each traversed edge up by the literal key
    // `${from_pk}|${to_pk}` and SKIPS any edge the map doesn't cover, so a
    // map keyed by relation/column names silently reports every destination
    // as unreachable. Keep this test keyed by edge - it is the contract.
    const { fetch, calls } = mockFetch(200, { cost: 4.25 });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const r = await oc.graph.dijkstra("network", {
      rel: "edge",
      src: "n1",
      dst: "n5",
      weights: {
        [edgeWeightKey("n1", "n3")]: 1,
        [edgeWeightKey("n3", "n5")]: 3.25,
      },
    });

    expect(r.cost).toBe(4.25);

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/tenants/tnt-test/graph/network/dijkstra");
    expect(JSON.parse(url.searchParams.get("weights_json")!)).toEqual({
      "n1|n3": 1,
      "n3|n5": 3.25,
    });
    // Dijkstra is GET - no body should be sent.
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it("edgeWeightKey builds the `from|to` key the engine looks weights up by", () => {
    expect(edgeWeightKey("n1", "n5")).toBe("n1|n5");
  });

  it("graph.dijkstra surfaces cost: null for an unreachable destination", async () => {
    // `cost` is `Option<f64>` WITHOUT skip_serializing_if, so the key is
    // always present and explicitly null - not omitted.
    const { fetch } = mockFetch(200, { cost: null });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const r = await oc.graph.dijkstra("network", {
      rel: "edge",
      src: "n1",
      dst: "n9",
      weights: {},
    });
    expect(r.cost).toBeNull();
  });

  it("ask() POSTs to /ask with the natural-language body", async () => {
    const { fetch, calls } = mockFetch(200, {
      rows: [{ symbol: "AAPL", qty: 100 }],
      cache: "miss",
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const r = await oc.ask("orders for AAPL above 50 shares last week");

    expect(r.rows).toHaveLength(1);
    expect(r.cache).toBe("miss");

    expect(calls[0]!.url).toBe(`${BASE}/v1/tenants/tnt-test/ask`);
    const body = JSON.parse(calls[0]!.init.body as string);
    // The engine's field is `nl`; `question`/`prompt` are silently dropped
    // and the request then 400s on the missing required field.
    expect(body.nl).toBe("orders for AAPL above 50 shares last week");
  });

  it("ask() exposes `explain` alongside `plan` when show_plan is set", async () => {
    // `plan` and `explain` are gated on the SAME flag server-side - they
    // appear and disappear together. `explain` used to be dropped on the
    // floor because the type didn't model it.
    const { fetch, calls } = mockFetch(200, {
      rows: [],
      cache: "hit",
      plan: { op: "Scan" },
      explain: { op: "Scan", rows: 0 },
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const r = await oc.ask("anything", { show_plan: true });

    expect(r.cache).toBe("hit");
    expect(r.plan).toEqual({ op: "Scan" });
    expect(r.explain).toEqual({ op: "Scan", rows: 0 });
    expect(JSON.parse(calls[0]!.init.body as string).show_plan).toBe(true);
  });

  it("usage() surfaces the addon_calls gate counters", async () => {
    const { fetch } = mockFetch(200, {
      tenant: "tnt-test",
      used: { store_keys: 1 },
      schemas: [],
      addon_calls: [{ addon: "vector-search", allowed: 12, rejected: 3 }],
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const u = await oc.usage();
    expect(u.addon_calls).toEqual([
      { addon: "vector-search", allowed: 12, rejected: 3 },
    ]);
  });

  it("registerSchema surfaces geo_fields when the manifest declared [[geo]]", async () => {
    const { fetch, calls } = mockFetch(200, {
      id: "demo.places",
      tenant: "tnt-test",
      geo_fields: ["location"],
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    const r = await oc.registerSchema('namespace = "demo"');

    expect(r.id).toBe("demo.places");
    expect(r.geo_fields).toEqual(["location"]);
    // The manifest goes up as raw TOML, not JSON.
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("text/plain");
    expect(calls[0]!.init.body).toBe('namespace = "demo"');
  });

  it("maps a 402 add-on body into OCAddonRequiredError", async () => {
    const { fetch } = mockFetch(402, {
      error: "addon_required",
      addon: "vector",
      name: "Vector Search",
      monthly_usd: 49,
      preview: false,
      enterprise_only: false,
      purchase_url: "https://originchain.ai/billing/addons/vector",
      msg: "Enable Vector Search to use this endpoint.",
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    await expect(
      oc.vectorTopk("embeddings", {
        query: [0.1],
        k: 1,
        dim: 1,
      }),
    ).rejects.toMatchObject({
      name: "OCAddonRequiredError",
      addon: "vector",
      monthlyUsd: 49,
    });
  });

  it("maps a generic non-2xx into ApiError with a useful message", async () => {
    const { fetch } = mockFetch(500, {
      error: { code: "internal", message: "boom" },
    });
    const oc = new OriginChainClient({ baseUrl: BASE, bearer: BEARER, fetch });
    try {
      await oc.sql("SELECT 1");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).code).toBe("internal");
      expect((e as ApiError).message).toBe("boom");
      // Add-on error must be a strict subset of ApiError.
      expect(e instanceof OCAddonRequiredError).toBe(false);
    }
  });
});

describe("OriginChainAdminClient auth", () => {
  const ADMIN = "https://api.originchain.ai";

  it("signupOtpRequest POSTs email/password/org_name to /signup/request", async () => {
    const { fetch, calls } = mockFetch(200, {
      sent: true,
      expires_at: "2026-07-15T00:10:00Z",
    });
    const admin = new OriginChainAdminClient({ baseUrl: ADMIN, fetch });
    const r = await admin.auth.signupOtpRequest({
      email: "a@b.c",
      password: "pw",
      org_name: "Acme",
    });

    expect(r.sent).toBe(true);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c!.url).toBe(`${ADMIN}/v1/auth/signup/request`);
    expect(c!.init.method).toBe("POST");
    expect(JSON.parse(c!.init.body as string)).toEqual({
      email: "a@b.c",
      password: "pw",
      org_name: "Acme",
    });
  });

  it("signupOtpVerify POSTs email/code to /signup/verify", async () => {
    const { fetch, calls } = mockFetch(200, {
      user: { id: "u1", email: "a@b.c" },
    });
    const admin = new OriginChainAdminClient({ baseUrl: ADMIN, fetch });
    await admin.auth.signupOtpVerify({ email: "a@b.c", code: "123456" });

    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c!.url).toBe(`${ADMIN}/v1/auth/signup/verify`);
    expect(c!.init.method).toBe("POST");
    expect(JSON.parse(c!.init.body as string)).toEqual({
      email: "a@b.c",
      code: "123456",
    });
  });
});
