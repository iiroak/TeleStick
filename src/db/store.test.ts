import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "./store.js";

test("persists state and destinations and rejects duplicate destinations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telestick-store-test-"));
  const dataDirectory = join(directory, "data");
  const dbPath = join(dataDirectory, "bot.sqlite3");
  try {
    const store = new Store(dbPath);
    assert.equal(statSync(dbPath).mode & 0o777, 0o600);
    assert.equal(statSync(dataDirectory).mode & 0o777, 0o700);
    store.seedDefaultsIfEmpty([{ label: "Home", chatId: "12025550123@c.us" }]);
    assert.equal(store.listEnabledDestinations().length, 1);
    const added = store.addDestination("Office", "12025550124@c.us");
    assert.equal(added.label, "Office");
    assert.throws(() => store.addDestination("Duplicate", "12025550124@c.us"));
    store.setState(42, { mode: "batch", batchItems: "[]" });
    store.close();

    const reopened = new Store(dbPath);
    assert.equal(reopened.listDestinations().length, 2);
    assert.deepEqual(reopened.getState(42), { mode: "batch", batchItems: "[]" });
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
