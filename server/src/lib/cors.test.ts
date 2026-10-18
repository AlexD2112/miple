import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { cors } from "./cors.js";

async function call(method: string, origin?: string) {
  const app = express();
  app.use(cors(["https://ripe.cooking"]));
  app.post("/recipes/chef", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = origin ? { Origin: origin } : {};
    if (method === "OPTIONS") headers["Access-Control-Request-Method"] = "POST";
    return await fetch(`http://127.0.0.1:${port}/recipes/chef`, { method, headers });
  } finally {
    server.close();
  }
}

test("answers the preflight from ripe.cooking", async () => {
  const res = await call("OPTIONS", "https://ripe.cooking");
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://ripe.cooking");
  assert.match(res.headers.get("access-control-allow-headers") ?? "", /Authorization/);
});

test("tags the real request for an allowed origin", async () => {
  const res = await call("POST", "https://ripe.cooking");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://ripe.cooking");
});

test("gives other sites no CORS headers", async () => {
  const res = await call("OPTIONS", "https://evil.example");
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  assert.notEqual(res.status, 204);
});

test("leaves the iOS app (no Origin) alone", async () => {
  const res = await call("POST");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});
