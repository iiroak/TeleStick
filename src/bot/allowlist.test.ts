import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "grammy";
import { allowlist } from "./allowlist.js";

async function runMiddleware(userId: number | undefined, chatType: string) {
  let nextCalled = false;
  const ctx = {
    from: userId === undefined ? undefined : { id: userId },
    chat: { type: chatType },
  } as Context;
  await allowlist(new Set([42]))(ctx, async () => { nextCalled = true; });
  return nextCalled;
}

test("allows an allowlisted user in a private chat", async () => {
  assert.equal(await runMiddleware(42, "private"), true);
});

test("blocks unknown users and users in groups", async () => {
  assert.equal(await runMiddleware(99, "private"), false);
  assert.equal(await runMiddleware(42, "group"), false);
  assert.equal(await runMiddleware(undefined, "private"), false);
});
