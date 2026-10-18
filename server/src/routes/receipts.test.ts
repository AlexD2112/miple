import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
process.env.GOOGLE_CLOUD_PROJECT ??= "test-project";
delete process.env.PERCEPTRON_API_KEY; // no OCR: Gemini reads the image directly
// supabase-js wants a global WebSocket at import time (native from Node 22); realtime is unused here.
(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};

const express = (await import("express")).default;
const { gemini } = await import("../lib/gemini.js");
const { receipts, withNutrition } = await import("./receipts.js");

const MODEL_OUTPUT = {
  store: "QFC",
  purchased_at: "2026-10-17",
  total: 14.6,
  items: [
    { raw_name: "BNLS CHKN BRST 1.52LB", name: "boneless chicken breast", category: "raw_poultry", quantity: 1.52, unit: "lb", price: 7.58, is_food: true },
    { raw_name: "ORG SPNCH 5OZ", name: "organic spinach", category: "leafy_greens", quantity: 5, unit: "oz", price: 3.99, is_food: true },
    { raw_name: "ZQX GADGET 1", name: "zqx gadget", category: "other", quantity: 1, unit: null, price: 2.93, is_food: true },
    { raw_name: "BAG FEE", name: "bag fee", category: "other", quantity: 1, unit: null, price: 0.1, is_food: false },
  ],
};

const realFetch = globalThis.fetch;

/** Runs the real router behind express; Supabase (auth + shelf_life) and Gemini are mocked. */
async function postReceipt(): Promise<{ status: number; body: any }> {
  const fetchMock = mock.method(globalThis, "fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    if (url.includes("/auth/v1/user")) return Response.json({ id: "user-1", aud: "authenticated", role: "authenticated" });
    if (url.includes("/rest/v1/shelf_life"))
      return Response.json([{ category: "raw_poultry", days: 2 }, { category: "leafy_greens", days: 5 }, { category: "other", days: 7 }]);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch);
  const genMock = mock.method(gemini.models, "generateContent", (async () => ({ text: JSON.stringify(MODEL_OUTPUT) })) as any);

  const app = express();
  app.use("/receipts", receipts);
  const server = app.listen(0);
  try {
    const form = new FormData();
    form.append("image", new Blob([Buffer.from("fake-jpeg")], { type: "image/jpeg" }), "receipt.jpg");
    const { port } = server.address() as AddressInfo;
    const res = await realFetch(`http://127.0.0.1:${port}/receipts/parse`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: form,
    });
    assert.equal(genMock.mock.calls.length, 1);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
    fetchMock.mock.restore();
    genMock.mock.restore();
  }
}

test("POST /receipts/parse adds optional USDA nutrition to matched items", async () => {
  const { status, body } = await postReceipt();
  assert.equal(status, 200);
  assert.equal(body.ocr, "gemini_vision");
  assert.equal(body.items.length, 3); // bag fee filtered as before

  const [chicken, spinach] = body.items;
  assert.equal(chicken.estimated_expiry, "2026-10-19");
  assert.equal(chicken.nutrition.item_name, "chicken breast");
  assert.equal(chicken.nutrition.fdc_id, 2646170);
  assert.equal(chicken.nutrition.category, "raw_poultry");
  assert.ok(chicken.nutrition.protein_g_100g > 20);
  assert.ok(chicken.nutrition.confidence > 0.7);
  assert.equal(chicken.nutrition.needs_review, false);
  assert.equal(chicken.nutrition.typical_package_size_g, 680);

  assert.equal(spinach.nutrition.item_name, "spinach");
  assert.equal(spinach.nutrition.confidence, 1);
  assert.equal(spinach.nutrition.needs_review, false);
  assert.equal(spinach.estimated_expiry, "2026-10-22");
});

test("unmatched items are returned exactly as before (no nutrition key)", async () => {
  const { body } = await postReceipt();
  const gadget = body.items[2];
  assert.equal("nutrition" in gadget, false);
  assert.deepEqual(gadget, {
    raw_name: "ZQX GADGET 1", name: "zqx gadget", category: "other", quantity: 1, unit: null, price: 2.93,
    is_food: true, purchase_date: "2026-10-17", estimated_expiry: "2026-10-24",
  });
});

test("withNutrition prefers the more confident of raw line vs LLM name and never mutates", () => {
  const item = { raw_name: "XQ 12345 7.99", name: "baby spinach", category: "leafy_greens" };
  const out = withNutrition(item) as typeof item & { nutrition?: { item_name: string; confidence: number } };
  assert.equal(out.nutrition?.item_name, "baby spinach");
  assert.equal(out.nutrition?.confidence, 1);
  assert.equal("nutrition" in item, false);
  const none = { raw_name: "", name: "" };
  assert.equal(withNutrition(none), none);
});
