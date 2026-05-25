# @originchain/sdk

Official TypeScript / JavaScript client for [OriginChain](https://originchain.ai).

> Other languages: Python → [`originchain`](https://pypi.org/project/originchain/) · Go → [`github.com/originchain-ai/originchain-go`](https://github.com/originchain-ai/originchain-go) · raw HTTP → [originchain.ai/docs](https://originchain.ai/docs).

- **Runtime:** Node ≥ 18, modern browsers (ESM + CJS bundles shipped)
- **Type-safe:** declarations bundled (`dist/index.d.ts`)
- **Tree-shakable:** `"sideEffects": false`
- **Engine compatibility:** `engine_min: "1.0.0"`, `engine_max: "1.x"`

## Install

```bash
npm install @originchain/sdk
# or
pnpm add @originchain/sdk
# or
yarn add @originchain/sdk
```

## Quick start

```ts
import { OriginChainClient } from "@originchain/sdk";

const oc = new OriginChainClient({
  baseUrl: "https://your-tenant.ap-south-1.db.originchain.ai",
  bearer: process.env.OC_BEARER!,
});

const resp = await oc.sql("SELECT id, email FROM shop.customers LIMIT 10");
if (resp.kind === "select") {
  for (const row of resp.rows) console.log(row);
}
```

## Two clients

The package exposes two classes because the engine and the control plane
have different auth models:

| Class                     | Talks to        | Auth                                  |
| ------------------------- | --------------- | ------------------------------------- |
| `OriginChainClient`       | Per-tenant engine | `Authorization: Bearer …` header     |
| `OriginChainAdminClient`  | Control plane     | Session cookie (browser) or bearer    |

Customer code almost always wants `OriginChainClient`. The admin client is
used by the OriginChain web console (and by ops tooling) to manage
instances, plans, billing, and add-ons.

## Vector search

```ts
await oc.vectorPut("embeddings", {
  id: "doc-1",
  embedding: [0.1, 0.2, 0.3],
  dim: 3,
  metric: "cosine",
});

const hits = await oc.vectorTopk("embeddings", {
  query: [0.1, 0.2, 0.3],
  k: 5,
  dim: 3,
  metric: "cosine",
  mode: "high_recall", // or "fast" — defaults to high_recall server-side
});

for (const h of hits) console.log(h.id, h.score);
```

`mode: "fast"` favours latency, `"high_recall"` favours recall. Omit the
field to take the server default.

## Full-text search

```ts
await oc.ftsIndex("articles", "body", {
  doc_id: "d1",
  text: "the quick brown fox",
});

const ranked = await oc.ftsSearch("articles", "body", {
  q: "quick fox",
  mode: "bm25",
  k: 5,
});
// ranked: [{ doc_id: "d1", score: 1.42 }, …]
```

`mode="boolean"` (default) and `"phrase"` return `string[]` of doc ids.
`"bm25"` returns `{ doc_id, score }[]` ranked top-`k`.

## Graph

```ts
const path = await oc.graph.dijkstra("network", {
  rel: "edge",
  src: "n1",
  dst: "n5",
  weights: { cost: 1, latency: 0.5 },
});
console.log(path.cost); // number | null
```

Other graph methods: `neighbors`, `reverseNeighbors`, `bfs`, `path`.

## Natural-language ask

```ts
const r = await oc.ask("orders for AAPL above 50 shares last week");
for (const row of r.rows) console.log(row);
```

## Error handling

```ts
import { ApiError, OCAddonRequiredError } from "@originchain/sdk";

try {
  await oc.vectorTopk("embeddings", { query: [0.1], k: 1, dim: 1 });
} catch (e) {
  if (e instanceof OCAddonRequiredError) {
    console.log(`Enable ${e.addonName} ($${e.monthlyUsd}/mo): ${e.purchaseUrl}`);
  } else if (e instanceof ApiError) {
    console.error(`HTTP ${e.status} ${e.code}: ${e.message}`);
  } else {
    throw e;
  }
}
```

`OCAddonRequiredError` is a subclass of `ApiError`, so an unconditional
`instanceof ApiError` catch still matches.

## Custom fetch (testing)

Inject your own `fetch` for mocking, instrumentation, or non-browser/Node
runtimes:

```ts
const oc = new OriginChainClient({
  baseUrl: "https://t.example.com",
  bearer: "test",
  fetch: vi.fn(async () => new Response("[]")),
});
```

## Performance: HTTP/2 in Node

The engine speaks HTTP/2; browsers auto-negotiate it over ALPN. Node's
built-in `fetch` (undici) defaults to HTTP/1.1 — bare SDK use works fine
on h1, but for a multiplexed connection inject an undici dispatcher with
`allowH2: true` (this is **optional**):

```ts
import { Agent, fetch as undiciFetch } from "undici";

const dispatcher = new Agent({ allowH2: true });
const client = new OriginChainClient({
  bearer, tenant, baseUrl,
  fetch: (url, init) => undiciFetch(url, { ...init, dispatcher }),
});
```

`undici` ships with Node ≥ 18 but isn't a runtime dep of this SDK; install
it explicitly (`npm i undici`) if you want this code path.

## Development

```bash
npm install
npm test          # vitest
npm run lint      # tsc --noEmit
npm run build     # tsup → dist/
```

## License

Proprietary — © Silicoyn Technologies Pvt Ltd. See `LICENSE`.
