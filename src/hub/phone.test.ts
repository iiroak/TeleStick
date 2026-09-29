import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidChatId, normalizeChatId } from "./phone.js";

test("normalizes international numbers with formatting", () => {
  assert.equal(normalizeChatId("+1 202 555 0123"), "12025550123@c.us");
});

test("uses a configured default calling code for national numbers", () => {
  assert.equal(normalizeChatId("2025550123", "1"), "12025550123@c.us");
  assert.equal(normalizeChatId("12025550123", "1"), "12025550123@c.us");
});

test("rejects ambiguous national numbers without a configured calling code", () => {
  assert.throws(() => normalizeChatId("2025550123"), /DEFAULT_COUNTRY_CODE/);
});

test("passes through a WhatsApp JID unchanged", () => {
  assert.equal(normalizeChatId("12025550123@c.us"), "12025550123@c.us");
  assert.equal(normalizeChatId("12345@g.us"), "12345@g.us");
});

test("throws on empty or non-numeric input", () => {
  assert.throws(() => normalizeChatId(""));
  assert.throws(() => normalizeChatId("abc"));
});

test("validates individual and group chat IDs", () => {
  assert.equal(isValidChatId("12025550123@c.us"), true);
  assert.equal(isValidChatId("12345@g.us"), true);
  assert.equal(isValidChatId("12025550123"), false);
  assert.equal(isValidChatId("abc@c.us"), false);
});
