import assert from "node:assert/strict";
import { test } from "node:test";
import type { Destination } from "../db/store.js";
import {
  buildStickerIdempotencyKey,
  formatHubApiError,
  formatHubResponseSummary,
  formatRelayResult,
  restoreBatchStickerRef,
  type StickerRef,
} from "./relay.js";
import { HubApiError } from "../hub/client.js";

const sticker: StickerRef = {
  fileId: "telegram-file-id",
  fileUniqueId: "sticker-unique-id",
  isAnimated: false,
  isVideo: false,
  sourceChatId: -100123,
  sourceMessageId: "456",
};

const destination: Destination = {
  id: 1,
  label: "Home",
  chatId: "12025550123@c.us",
  enabled: true,
  createdAt: "2026-09-28T00:00:00.000Z",
};

test("keeps an idempotency key on retry and separates Telegram source messages", () => {
  const firstAttempt = buildStickerIdempotencyKey(sticker, destination);
  const retry = buildStickerIdempotencyKey({ ...sticker }, destination);
  const nextMessage = buildStickerIdempotencyKey(
    { ...sticker, sourceMessageId: "457" },
    destination,
  );
  const otherChat = buildStickerIdempotencyKey(
    { ...sticker, sourceChatId: sticker.sourceChatId + 1 },
    destination,
  );

  assert.equal(firstAttempt, retry);
  assert.notEqual(firstAttempt, nextMessage);
  assert.notEqual(firstAttempt, otherChat);
  assert.match(firstAttempt, /^tg-[a-f0-9]{32}$/);
});

test("restores source identities for stickers saved by an older batch", () => {
  const legacy = {
    fileId: "telegram-file-id",
    fileUniqueId: "sticker-unique-id",
    isAnimated: false,
    isVideo: false,
  };
  const first = restoreBatchStickerRef(legacy, -100123, 800, 0);
  const second = restoreBatchStickerRef(legacy, -100123, 800, 1);

  assert.equal(first.sourceChatId, -100123);
  assert.equal(first.sourceMessageId, "legacy:800:0");
  assert.notEqual(
    buildStickerIdempotencyKey(first, destination),
    buildStickerIdempotencyKey(second, destination),
  );
});

test("reports Hub acceptance and returned status without claiming delivery", () => {
  const text = formatRelayResult({
    destination,
    ok: true,
    status: "queued",
    idempotentReplay: false,
  });

  assert.equal(
    text,
    "📨 Home: request accepted by the gateway; status: queued. Delivery not confirmed.",
  );
  assert.match(text, /delivery not confirmed/i);
});

test("reports an idempotent replay without claiming a new send", () => {
  const text = formatRelayResult({
    destination,
    ok: true,
    status: "accepted",
    idempotentReplay: true,
  });

  assert.match(text, /the gateway returned a replay/);
  assert.match(text, /no new send was confirmed/);
  assert.doesNotMatch(text, /delivered|resent|✅/i);
});

test("summarizes returned Hub states and replay responses for batch sends", () => {
  const text = formatHubResponseSummary([
    { destination, ok: true, status: "queued", idempotentReplay: false },
    { destination, ok: true, status: "queued", idempotentReplay: true },
    { destination, ok: false, error: "HTTP 500" },
  ]);

  assert.equal(
    text,
    "Statuses returned by the gateway: Home: queued (2). The gateway returned a replay in 1 response(s); no new send was confirmed.",
  );
});

test("summarizes HTML gateway errors without forwarding markup to Telegram", () => {
  const html = `<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1>${"x".repeat(300)}</body></html>`;
  const message = formatHubApiError(new HubApiError("gateway error", 502, html));

  assert.equal(
    message,
    "HTTP 502: the messaging gateway returned an HTML error page instead of its API response.",
  );
  assert.doesNotMatch(message, /<!DOCTYPE|<html|<body|502 Bad Gateway/);
});

test("keeps a short plain-text gateway error detail", () => {
  const message = formatHubApiError(new HubApiError("gateway error", 502, "upstream unavailable"));
  assert.equal(message, "HTTP 502: upstream unavailable");
});
