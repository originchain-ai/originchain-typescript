// Live end-to-end smoke for @originchain/sdk against a real engine.
// Not a vitest spec (no .test/.spec suffix) — run explicitly: `node tests/e2e.mjs`
// after `npm run build`. Guarded: exits 0 without running when OC_BASE is unset
// (e.g. a fork PR without secrets) so it never fails a credential-less build.
//
//   OC_BASE=https://<tenant>.<region>.db.originchain.ai \
//   OC_BEARER=<bearer> OC_TENANT=<tenant-ulid> [OC_NS=tsdemo] node tests/e2e.mjs
//
// Graph uses a self-relation FK (the real engine model): the edge runs from a
// row's PK to the value in from_col.
import * as sdk from "@originchain/sdk";

if (!process.env.OC_BASE) {
  console.log("OC_BASE unset — skipping live E2E (set OC_BASE/OC_BEARER/OC_TENANT to run).");
  process.exit(0);
}

const C = sdk.OriginChainClient || sdk.default;
const oc = new C({ baseUrl: process.env.OC_BASE, bearer: process.env.OC_BEARER, tenantId: process.env.OC_TENANT });

const NS = process.env.OC_NS || "tsdemo";
const TOML = `version = 1
namespace = "${NS}"
table = "products"
primary_key = ["id"]
extractions = []
foreign_keys = []
check_constraints = []
triggers = []

[[columns]]
name = "id"
ty = "str"
required = true

[[columns]]
name = "name"
ty = "str"

[[columns]]
name = "price"
ty = "f64"

[[columns]]
name = "description"
ty = "str"

[[columns]]
name = "related_to"
ty = "str"

[[relations]]
name = "related"
from_col = "related_to"
bidirectional = true

[relations.target]
namespace = "${NS}"
table = "products"
pk = "id"
`;
const VEC = [0.1, 0.2, 0.1, 0.0, 0.3, 0.1, 0.2, 0.0];
const results = [];
async function step(name, fn, expectFail = false) {
  try {
    const v = await fn();
    results.push([name, !expectFail, JSON.stringify(v)?.slice(0, 90)]);
  } catch (e) {
    results.push([name, expectFail, `${e.name || "Error"}: ${e.message}`.slice(0, 130)]);
  }
}

await step("registerSchema", () => oc.registerSchema(TOML));
await step("listSchemas", () => oc.listSchemas());
await step("sql INSERT", () => oc.sql(`INSERT INTO ${NS}.products (id,name,price,description,related_to) VALUES ('p1','Widget',9.99,'a small blue widget for testing','p2')`));
await step("sql INSERT p2", () => oc.sql(`INSERT INTO ${NS}.products (id,name,price,description) VALUES ('p2','Gadget',2.5,'a tiny red gadget gizmo')`));
await step("sql SELECT", () => oc.sql(`SELECT id,name,price FROM ${NS}.products WHERE price > 5`));
await step("sqlOne COUNT", () => oc.sqlOne(`SELECT COUNT(*) FROM ${NS}.products`));
await step("vectorPut", () => oc.vectorPut(`${NS}.products`, { id: "p1", embedding: VEC, dim: VEC.length }));
await step("vectorTopk", () => oc.vectorTopk(`${NS}.products`, { query: VEC, k: 5, dim: VEC.length, metric: "cosine" }));
await step("ftsIndex", () => oc.ftsIndex(`${NS}.products`, "description", { doc_id: "p1", text: "a small blue widget for testing" }));
await step("ftsSearch", () => oc.ftsSearch(`${NS}.products`, "description", { q: "widget", mode: "bm25", k: 5 }));
await step("graph.neighbors ->[p2]", async () => {
  const n = await oc.graph.neighbors(`${NS}.products`, { rel: "related", pk: "p1" });
  if (JSON.stringify(n) !== JSON.stringify(["p2"])) throw new Error(`expected ["p2"], got ${JSON.stringify(n)}`);
  return n;
});
await step("ask", () => oc.ask("how many products cost more than 5", { schemas: [`${NS}.products`] }));
await step("usage", () => oc.usage());
await step("sql SELECT 1 (want-fail)", () => oc.sql("SELECT 1"), true);

console.log(`\n=== TYPESCRIPT SDK ${sdk.VERSION || "@originchain/sdk"} E2E (ns=${NS}) ===`);
let np = 0;
for (const [n, ok, d] of results) { console.log(`${ok ? "PASS" : "FAIL"}  ${n.padEnd(26)} ${d}`); np += ok; }
console.log(`=== ${np}/${results.length} passed ===`);
process.exit(np === results.length ? 0 : 1);
