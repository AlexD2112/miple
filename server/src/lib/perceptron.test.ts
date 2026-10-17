import assert from "node:assert/strict";
import { mock, test } from "node:test";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
process.env.GEMINI_API_KEY ??= "test-gemini";
process.env.PERCEPTRON_API_KEY = "test-perceptron-key";
process.env.PERCEPTRON_OCR_URL = "https://perceptron.test/v1/chat/completions";

const { extractText, perceptronOcr } = await import("./perceptron.js");

test("posts a Mk1.5 chat completion and reads the transcription", async () => {
  const fetchMock = mock.method(globalThis, "fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://perceptron.test/v1/chat/completions");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-perceptron-key");

    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "perceptron-mk1.5");
    assert.equal(body.messages[1].content[0].image_url.url, "data:image/jpeg;base64,cmVjZWlwdA==");
    assert.equal(body.messages[1].content[1].type, "text");

    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: "ORG SPNCH 5OZ  3.49" } }],
    });
  }) as typeof fetch);

  try {
    assert.equal(await perceptronOcr(Buffer.from("receipt"), "image/jpeg"), "ORG SPNCH 5OZ  3.49");
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    fetchMock.mock.restore();
  }
});

test("joins text parts and ignores an unfinished choice", () => {
  assert.equal(
    extractText({
      choices: [{ finish_reason: "stop", message: { content: [{ type: "text", text: "Milk 4.29" }] } }],
    }),
    "Milk 4.29",
  );
  assert.equal(
    extractText({
      choices: [{ finish_reason: "length", message: { content: "partial" } }],
    }),
    null,
  );
});

test("falls back when Perceptron rejects the request", async () => {
  const fetchMock = mock.method(globalThis, "fetch", (async () => new Response("bad image", { status: 400 })) as typeof fetch);
  try {
    assert.equal(await perceptronOcr(Buffer.from("receipt"), "image/jpeg"), null);
  } finally {
    fetchMock.mock.restore();
  }
});
