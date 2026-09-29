import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { gzipSync } from "node:zlib";
import { promisify } from "node:util";
import { convertTgsToWebp } from "./sticker.js";
import { validateWebpSticker } from "./validate.js";

const execFileAsync = promisify(execFile);

const fixture = gzipSync(Buffer.from(JSON.stringify({
  v: "5.7.4",
  fr: 30,
  ip: 0,
  op: 30,
  w: 64,
  h: 64,
  nm: "TeleStick test animation",
  ddd: 0,
  assets: [],
  layers: [{
    ddd: 0,
    ind: 1,
    ty: 1,
    nm: "Solid test layer",
    sr: 1,
    ks: {
      o: {
        a: 1,
        k: [
          { t: 0, s: [0], e: [100], o: { x: 0.333, y: 0 }, i: { x: 0.667, y: 1 } },
          { t: 29, s: [100] },
        ],
      },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [32, 32, 0] },
      a: { a: 0, k: [32, 32, 0] },
      s: { a: 0, k: [100, 100, 100] },
    },
    ao: 0,
    sw: 64,
    sh: 64,
    sc: "#ff0000",
    ip: 0,
    op: 30,
    st: 0,
    bm: 0,
  }],
})));

test("converts a self-authored TGS animation to a valid animated WebP", async (t) => {
  try {
    await execFileAsync("python3", ["-c", "import rlottie_python"]);
  } catch {
    t.skip("python3 with rlottie-python is required for this integration test");
    return;
  }

  const result = await convertTgsToWebp(fixture);

  assert.equal(result.animated, true);
  assert.ok(result.webp.byteLength > 0);
  const validation = validateWebpSticker(result.webp, true);
  assert.equal(validation.valid, true, validation.reason);
});
