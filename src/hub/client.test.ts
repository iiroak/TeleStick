import assert from "node:assert/strict";
import { test } from "node:test";
import { HubApiError, HubClient } from "./client.js";

const validResponse = {
  message: {
    id: "message-id",
    chat_id: "12025550123@c.us",
    provider_message_key: "provider-key",
    message_type: "sticker",
    text: null,
    status: "queued",
    created_at: "2026-01-01T00:00:00Z",
  },
  provider: "waha",
  provider_message_id: "provider-message-id",
  status: "queued",
  idempotent_replay: false,
};

async function withFetch(response: Response, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("validates and maps a successful sticker response", async () => {
  await withFetch(new Response(JSON.stringify(validResponse), { status: 200 }), async () => {
    const result = await new HubClient("https://gateway.example", "test-key", "main")
      .sendSticker({ chatId: "12025550123@c.us", mimetype: "image/webp" });
    assert.equal(result.status, "queued");
    assert.equal(result.idempotentReplay, false);
    assert.equal(result.message.id, "message-id");
  });
});

test("rejects malformed JSON and invalid response shapes without crashing", async () => {
  await withFetch(new Response("<html>bad gateway</html>", { status: 200 }), async () => {
    await assert.rejects(
      new HubClient("https://gateway.example", "test-key", "main").getSessionStatus(),
      /invalid JSON/,
    );
  });
  await withFetch(new Response("{}", { status: 200 }), async () => {
    await assert.rejects(
      new HubClient("https://gateway.example", "test-key", "main")
        .sendSticker({ chatId: "12025550123@c.us", mimetype: "image/webp" }),
      /unexpected response/,
    );
  });
});

test("maps non-success status codes to HubApiError", async () => {
  await withFetch(new Response("unavailable", { status: 503 }), async () => {
    await assert.rejects(
      new HubClient("https://gateway.example", "test-key", "main", 100, 0)
        .sendSticker({ chatId: "12025550123@c.us", mimetype: "image/webp" }),
      (error: unknown) => error instanceof HubApiError && error.status === 503,
    );
  });
});

test("retries transient errors only when an idempotency key is present", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const seenKeys: string[] = [];
  globalThis.fetch = async (_input, init) => {
    calls++;
    seenKeys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
    return calls === 1
      ? new Response("temporary failure", { status: 503 })
      : new Response(JSON.stringify(validResponse), { status: 200 });
  };
  try {
    const client = new HubClient("https://gateway.example", "test-key", "main", 100, 2, 0);
    await client.sendSticker({
      chatId: "12025550123@c.us",
      mimetype: "image/webp",
      idempotencyKey: "tg-test-key",
    });
    assert.equal(calls, 2);
    assert.deepEqual(seenKeys, ["tg-test-key", "tg-test-key"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
