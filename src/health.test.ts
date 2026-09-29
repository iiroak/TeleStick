import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { startHealthServer } from "./health.js";

test("separates liveness from readiness and returns 404 for unknown paths", async () => {
  let ready = false;
  const server = startHealthServer(0, "127.0.0.1", () => ready);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/readyz`)).status, 503);
    ready = true;
    assert.equal((await fetch(`${baseUrl}/readyz`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/unknown`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
