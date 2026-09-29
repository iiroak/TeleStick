import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validateWebpSticker } from "./validate.js";

const execFileAsync = promisify(execFile);

async function makeSolidWebp(
  workDir: string,
  size: number,
  rgb: [number, number, number],
): Promise<Buffer> {
  const ppmPath = join(workDir, "solid.ppm");
  const header = `P6\n${size} ${size}\n255\n`;
  const pixel = Buffer.from(rgb);
  const body = Buffer.concat(Array(size * size).fill(pixel));
  await writeFile(ppmPath, Buffer.concat([Buffer.from(header), body]));
  const webpPath = join(workDir, "solid.webp");
  await execFileAsync("cwebp", ["-q", "90", ppmPath, "-o", webpPath]);
  return readFile(webpPath);
}

test("accepts a 512x512 static WebP under the size limit", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "validate-test-"));
  try {
    const webp = await makeSolidWebp(workDir, 512, [255, 0, 0]);
    const result = validateWebpSticker(webp, false);
    assert.equal(result.valid, true, result.reason);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("rejects a static WebP with the wrong dimensions", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "validate-test-"));
  try {
    const webp = await makeSolidWebp(workDir, 256, [0, 255, 0]);
    const result = validateWebpSticker(webp, false);
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /256x256/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("rejects a buffer that is not a WebP container", () => {
  const result = validateWebpSticker(Buffer.from("not a webp file at all"), false);
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /RIFF/);
});

test("rejects an animated claim when there is no ANIM chunk", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "validate-test-"));
  try {
    const webp = await makeSolidWebp(workDir, 512, [0, 0, 255]);
    const result = validateWebpSticker(webp, true);
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /ANIM/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("rejects a static sticker over the size limit", () => {
  const header = Buffer.alloc(20);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(200_000, 4);
  header.write("WEBP", 8, "ascii");
  header.write("VP8L", 12, "ascii");
  header.writeUInt32LE(190_000, 16);
  const payload = Buffer.alloc(190_000, 0xff);
  const result = validateWebpSticker(Buffer.concat([header, payload]), false);
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /byte limit/);
});
