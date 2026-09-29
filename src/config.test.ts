import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const required = {
  TELEGRAM_BOT_TOKEN: "fake-test-token",
  ALLOWED_TELEGRAM_USER_IDS: "42, 84",
  HUB_BASE_URL: "https://gateway.example",
  HUB_API_KEY: "test-key",
};

test("loads safe defaults and validates the required allowlist", () => {
  const config = loadConfig(required);
  assert.deepEqual([...config.allowedTelegramUserIds], [42, 84]);
  assert.equal(config.defaultCountryCode, "");
  assert.equal(config.healthBindAddr, "127.0.0.1");
  assert.equal(config.hubTimeoutMs, 15_000);
  assert.equal(config.hubMaxRetries, 2);
  assert.equal(config.ffmpegTimeoutMs, 30_000);
  assert.equal(config.maxStickerDownloadBytes, 5_000_000);
  assert.throws(() => loadConfig({ ...required, ALLOWED_TELEGRAM_USER_IDS: "" }));
});

test("rejects invalid country codes and user IDs", () => {
  assert.throws(() => loadConfig({ ...required, DEFAULT_COUNTRY_CODE: "+1234" }));
  assert.throws(() => loadConfig({ ...required, ALLOWED_TELEGRAM_USER_IDS: "not-an-id" }));
});
