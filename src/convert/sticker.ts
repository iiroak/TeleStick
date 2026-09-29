import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

export async function assertConversionToolsAvailable(): Promise<void> {
  const checks: Array<[string, string[]]> = [
    ["ffmpeg", ["-version"]],
    ["cwebp", ["-version"]],
    ["img2webp", ["-version"]],
    ["python3", ["-c", "import rlottie_python, PIL"]],
  ];
  for (const [command, args] of checks) {
    try {
      await execFileAsync(command, args, { timeout: 5_000, maxBuffer: 1024 * 1024 });
    } catch (error) {
      throw new Error(`Required conversion dependency is unavailable: ${command}`, { cause: error });
    }
  }
}

/**
 * WhatsApp animated sticker limits (github.com/WhatsApp/stickers README):
 * exactly 512x512, <=10s total duration. The documented 500KB size limit is
 * not exact in practice (WhatsApp/stickers#742 rejected a 506190-byte file
 * and accepted 486386 bytes), so we target a safety margin below it.
 */
export const STICKER_SIZE_PX = 512;
export const STICKER_MAX_BYTES = 480_000;
export const STICKER_STATIC_MAX_BYTES = 95_000;
export const STICKER_MAX_DURATION_MS = 10_000;

export interface ConvertedSticker {
  webp: Buffer;
  animated: boolean;
}

export class ConversionError extends Error {}

/**
 * Renders a Telegram .tgs (gzipped Lottie) animation to a sequence of RGBA
 * PNG frames via a Python subprocess using rlottie (the same renderer
 * Telegram itself uses), then assembles them into an animated WebP with
 * img2webp.
 *
 * Two things verified during development that are NOT optional:
 * - `kmin=1 kmax=1` (keyframe every frame) avoids a black-line artifact
 *   documented by sticker-convert (laggykiller/sticker-convert).
 * - rlottie_python has no `.destroy()`; the render script calls
 *   `lottie_animation_destroy()` explicitly, matching its actual API.
 */
export async function convertTgsToWebp(
  tgsBuffer: Buffer,
  maxFrames = 300,
  renderTimeoutMs = 30_000,
  assembleTimeoutMs = 30_000,
): Promise<ConvertedSticker> {
  const workDir = await mkdtemp(join(tmpdir(), "telestick-tgs-"));
  try {
    const inputPath = join(workDir, "input.tgs");
    await writeFile(inputPath, tgsBuffer);

    const scriptPath = fileURLToPath(new URL("./tgs_render.py", import.meta.url));
    let renderInfo: { frame_count: number; fps: number; duration_ms: number };
    try {
      const { stdout } = await execFileAsync(
        "python3",
        [scriptPath, inputPath, workDir, String(STICKER_SIZE_PX), String(maxFrames)],
        { timeout: renderTimeoutMs, maxBuffer: 1024 * 1024 },
      );
      renderInfo = JSON.parse(stdout.trim());
    } catch (error) {
      throw new ConversionError(`tgs render failed: ${(error as Error).message}`);
    }

    if (renderInfo.frame_count <= 0) {
      throw new ConversionError("tgs render produced zero frames");
    }

    const frameFiles = (await readdir(workDir))
      .filter((name) => name.startsWith("frame_") && name.endsWith(".png"))
      .sort();
    if (frameFiles.length === 0) {
      throw new ConversionError("no rendered frames found");
    }

    const delayMs = renderInfo.frame_count > 0
      ? Math.max(1, Math.round(renderInfo.duration_ms / renderInfo.frame_count))
      : 50;
    const outputPath = join(workDir, "output.webp");

    const webpBuffer = await assembleAnimatedWebp(
      frameFiles.map((name) => join(workDir, name)),
      delayMs,
      outputPath,
      assembleTimeoutMs,
    );

    return { webp: webpBuffer, animated: true };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Converts a Telegram video sticker (.webm, VP9 with alpha) to an animated
 * WebP.
 *
 * The `-c:v libvpx-vp9` flag placed BEFORE `-i` selects ffmpeg's decoder,
 * not the encoder. This is not a typo: VP9 alpha is carried as Matroska
 * side data that ffmpeg's native VP9 decoder ignores; only `libvpx-vp9`
 * reads it. Without this flag the sticker comes out fully opaque with no
 * error or warning (verified: corner pixel goes from (0,0,0,0) to
 * (1,1,1,255)).
 */
export async function convertWebmToWebp(
  webmBuffer: Buffer,
  timeoutMs = 30_000,
): Promise<ConvertedSticker> {
  const workDir = await mkdtemp(join(tmpdir(), "telestick-webm-"));
  try {
    const inputPath = join(workDir, "input.webm");
    await writeFile(inputPath, webmBuffer);
    const outputPath = join(workDir, "output.webp");

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-c:v", "libvpx-vp9",
        "-i", inputPath,
        "-vf", `scale=${STICKER_SIZE_PX}:${STICKER_SIZE_PX}`,
        "-c:v", "libwebp_anim",
        "-loop", "0",
        "-pix_fmt", "yuva420p",
        "-q:v", "75",
        "-t", String(STICKER_MAX_DURATION_MS / 1000),
        outputPath,
      ],
      { timeout: timeoutMs },
    );

    let webpBuffer: Buffer = await readFile(outputPath);

    if (webpBuffer.byteLength > STICKER_MAX_BYTES) {
      webpBuffer = await reencodeWebmWithLowerQuality(inputPath, workDir, timeoutMs);
    }

    return { webp: webpBuffer, animated: true };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function reencodeWebmWithLowerQuality(
  inputPath: string,
  workDir: string,
  timeoutMs: number,
): Promise<Buffer> {
  for (const quality of [50, 30, 15]) {
    const outputPath = join(workDir, `retry-${quality}.webp`);
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-c:v", "libvpx-vp9",
        "-i", inputPath,
        "-vf", `scale=${STICKER_SIZE_PX}:${STICKER_SIZE_PX}`,
        "-c:v", "libwebp_anim",
        "-loop", "0",
        "-pix_fmt", "yuva420p",
        "-q:v", String(quality),
        "-t", String(STICKER_MAX_DURATION_MS / 1000),
        outputPath,
      ],
      { timeout: timeoutMs },
    );
    const buffer = await readFile(outputPath);
    if (buffer.byteLength <= STICKER_MAX_BYTES) {
      return buffer;
    }
  }
  throw new ConversionError(
    "could not compress video sticker under the WhatsApp size limit",
  );
}

/**
 * Passes a static image through to a WhatsApp-compliant static sticker.
 * WAHA requires WebP already encoded (PNG/JPEG are rejected, not
 * converted), so anything not already WebP goes through cwebp first.
 */
export async function convertStaticImageToWebp(
  imageBuffer: Buffer,
  sourceExt: "webp" | "png" | "jpg",
  timeoutMs = 15_000,
): Promise<ConvertedSticker> {
  if (sourceExt === "webp" && imageBuffer.byteLength <= STICKER_STATIC_MAX_BYTES) {
    return { webp: imageBuffer, animated: false };
  }
  const workDir = await mkdtemp(join(tmpdir(), "telestick-static-"));
  try {
    const inputPath = join(workDir, `input.${sourceExt}`);
    await writeFile(inputPath, imageBuffer);
    const outputPath = join(workDir, "output.webp");

    for (const quality of [90, 75, 50, 30]) {
      await execFileAsync(
        "cwebp",
        [
          "-q", String(quality),
          "-resize", String(STICKER_SIZE_PX), String(STICKER_SIZE_PX),
          inputPath,
          "-o", outputPath,
        ],
        { timeout: timeoutMs },
      );
      const buffer = await readFile(outputPath);
      if (buffer.byteLength <= STICKER_STATIC_MAX_BYTES) {
        return { webp: buffer, animated: false };
      }
    }
    throw new ConversionError(
      "could not compress static sticker under the WhatsApp size limit",
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function assembleAnimatedWebp(
  framePaths: string[],
  delayMs: number,
  outputPath: string,
  timeoutMs: number,
): Promise<Buffer> {
  for (const quality of [75, 50, 30, 15]) {
    const args: string[] = [
      "-loop", "0", "-mixed", "-kmin", "1", "-kmax", "1", "-q", String(quality),
    ];
    for (const framePath of framePaths) {
      args.push("-d", String(delayMs), framePath);
    }
    args.push("-o", outputPath);
    await execFileAsync("img2webp", args, { timeout: timeoutMs });
    const buffer = await readFile(outputPath);
    if (buffer.byteLength <= STICKER_MAX_BYTES) {
      return buffer;
    }
  }
  throw new ConversionError(
    "could not compress animated sticker under the WhatsApp size limit",
  );
}
