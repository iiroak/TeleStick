import type { Api } from "grammy";

export type TelegramStickerKind = "static" | "video" | "animated";

export interface DownloadedSticker {
  buffer: Buffer;
  kind: TelegramStickerKind;
}

/**
 * Telegram exposes three sticker shapes on the `sticker` object of a
 * message (see grammY/Bot API `Sticker` type):
 * - `is_animated: true` -> the file is TGS (gzipped Lottie JSON), despite
 *   the API reporting mime type as an empty string / not set.
 * - `is_video: true` -> the file is WebM (VP9 with alpha).
 * - neither -> the file is a plain static WebP.
 */
export async function downloadTelegramSticker(
  api: Api,
  botToken: string,
  fileId: string,
  isAnimated: boolean,
  isVideo: boolean,
  timeoutMs = 30_000,
  maxBytes = 5_000_000,
): Promise<DownloadedSticker> {
  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return a file_path for this sticker");
  }
  const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`failed to download sticker from Telegram: HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`sticker download exceeds the ${maxBytes}-byte limit`);
  }
  if (!response.body) throw new Error("Telegram returned an empty sticker response");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`sticker download exceeds the ${maxBytes}-byte limit`);
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);

  const kind: TelegramStickerKind = isAnimated ? "animated" : isVideo ? "video" : "static";
  return { buffer, kind };
}
