import test from "node:test";
import assert from "node:assert/strict";
import { clientHubLanguages, clientHubLanguage, translationBatches } from "../client-hub-languages.mjs";
import { createClientTranslationHandler } from "../netlify/functions/hmp-client-translation.mts";

globalThis.Netlify = { env: { get: (name) => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  GROQ_API_KEY: "test-provider-key",
})[name] } };

test("the hub and form selectors offer all fourteen language codes", () => {
  assert.equal(clientHubLanguages.length, 14);
  assert.equal(new Set(clientHubLanguages.map(([code]) => code)).size, 14);
  assert.equal(clientHubLanguage("ar-EG")[2], "العربية المصرية");
  assert.equal(clientHubLanguage("unsupported")[0], "en");
});

test("long documents split into bounded translation requests", () => {
  const batches = translationBatches(Array.from({ length: 100 }, () => ({ textContent: "x".repeat(200) })));
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => batch.length <= 70 && batch.reduce((n, node) => n + node.textContent.length, 0) <= 14000));
});

test("agreement translation requires a current private link before sending any content to the provider", async () => {
  let providerCalls = 0;
  const databaseFactory = () => ({ rpc: async () => ({ data: { status: "Sent", expires_at: "2000-01-01T00:00:00Z" }, error: null }) });
  const handler = createClientTranslationHandler({ databaseFactory, fetchFn: async () => { providerCalls++; return Response.json({}); } });
  const response = await handler(new Request("https://hmpeds.com/api/hmp-client-translation", {
    method: "POST", headers: { origin: "https://hmpeds.com", authorization: `Bearer ${"a".repeat(43)}`, "content-type": "application/json" },
    body: JSON.stringify({ documentType: "agreement", language: "fr", texts: ["Payment terms"] }),
  }));
  assert.equal(response.status, 401);
  assert.equal(providerCalls, 0);
});

test("a valid private form can receive a reference translation without changing its source", async () => {
  let submitted;
  const databaseFactory = () => ({ rpc: async () => ({ data: { status: "Sent", expires_at: "2099-01-01T00:00:00Z" }, error: null }) });
  const handler = createClientTranslationHandler({ databaseFactory, fetchFn: async (_url, options) => {
    submitted = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ translations: ["Condiciones de pago"] }) } }] });
  } });
  const response = await handler(new Request("https://hmpeds.com/api/hmp-client-translation", {
    method: "POST", headers: { origin: "https://hmpeds.com", authorization: `Bearer ${"b".repeat(43)}`, "content-type": "application/json" },
    body: JSON.stringify({ documentType: "agreement", language: "es", texts: ["Payment terms"] }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { translations: ["Condiciones de pago"] });
  assert.equal(submitted.messages[1].content, '{"texts":["Payment terms"]}');
});

test("translation rejects a changed payment amount", async () => {
  const handler = createClientTranslationHandler({
    databaseFactory: () => ({ rpc: async () => ({ data: { status: "Sent", expires_at: "2099-01-01T00:00:00Z" }, error: null }) }),
    fetchFn: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ translations: ["Total: $900.00"] }) } }] }),
  });
  const response = await handler(new Request("https://hmpeds.com/api/hmp-client-translation", {
    method: "POST", headers: { origin: "https://hmpeds.com", authorization: `Bearer ${"c".repeat(43)}`, "content-type": "application/json" },
    body: JSON.stringify({ documentType: "agreement", language: "fr", texts: ["Total: $500.00"] }),
  }));
  assert.equal(response.status, 502);
});

test("website relays translations to seating with a signed server request when its own provider key is absent", async () => {
  const previous = globalThis.Netlify;
  globalThis.Netlify = { env: { get: (name) => ({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  })[name] } };
  try {
    let relay;
    const handler = createClientTranslationHandler({
      databaseFactory: () => ({ rpc: async () => ({ data: { status: "Sent", expires_at: "2099-01-01T00:00:00Z" }, error: null }) }),
      fetchFn: async (url, options) => {
        relay = { url, options };
        return Response.json({ translations: ["Condiciones de pago"] });
      },
    });
    const response = await handler(new Request("https://hmpeds.com/api/hmp-client-translation", {
      method: "POST", headers: { origin: "https://hmpeds.com", authorization: `Bearer ${"d".repeat(43)}`, "content-type": "application/json" },
      body: JSON.stringify({ documentType: "agreement", language: "es", texts: ["Payment terms"] }),
    }));
    assert.equal(response.status, 200);
    assert.equal(relay.url, "https://seating.hmpeds.com/api/hmp-internal-translate");
    assert.deepEqual(JSON.parse(relay.options.body), { language: "es", texts: ["Payment terms"] });
    assert.match(relay.options.headers["X-HMP-Signature"], /^[0-9a-f]{64}$/);
  } finally {
    globalThis.Netlify = previous;
  }
});
