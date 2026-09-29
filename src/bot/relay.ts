import { createHash } from "node:crypto";
import { downloadTelegramSticker } from "./download.js";
import type { Api } from "grammy";
import {
  convertStaticImageToWebp,
  convertTgsToWebp,
  convertWebmToWebp,
  ConversionError,
  type ConvertedSticker,
} from "../convert/sticker.js";
import { validateWebpSticker } from "../convert/validate.js";
import { HubApiError, HubClient } from "../hub/client.js";
import type { Destination } from "../db/store.js";
import type { Logger } from "../logger.js";

export interface StickerRef {
  fileId: string;
  fileUniqueId: string;
  isAnimated: boolean;
  isVideo: boolean;
  sourceChatId: number;
  sourceMessageId: string;
}

export type StoredStickerRef = Pick<
  StickerRef,
  "fileId" | "fileUniqueId" | "isAnimated" | "isVideo"
> &
  Partial<Pick<StickerRef, "sourceChatId" | "sourceMessageId">>;

export interface RelayResult {
  destination: Destination;
  ok: boolean;
  status?: string;
  idempotentReplay?: boolean;
  error?: string;
}

export function restoreBatchStickerRef(
  sticker: StoredStickerRef,
  fallbackChatId: number,
  batchMessageId: number,
  index: number,
): StickerRef {
  return {
    ...sticker,
    sourceChatId: sticker.sourceChatId ?? fallbackChatId,
    sourceMessageId: String(sticker.sourceMessageId ?? `legacy:${batchMessageId}:${index}`),
  };
}

export function buildStickerIdempotencyKey(
  sticker: StickerRef,
  destination: Pick<Destination, "chatId">,
): string {
  const source = JSON.stringify([
    sticker.sourceChatId,
    sticker.sourceMessageId,
    sticker.fileUniqueId,
    destination.chatId,
  ]);
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 32);
  return `tg-${digest}`;
}

export function formatRelayResult(result: RelayResult): string {
  if (!result.ok) {
    return `\u274c ${result.destination.label}: ${result.error}`;
  }

  const status = result.status || "not provided";
  if (result.idempotentReplay) {
    return `\u21a9\ufe0f ${result.destination.label}: the gateway returned a replay (previous status: ${status}); no new send was confirmed.`;
  }
  return `\ud83d\udce8 ${result.destination.label}: request accepted by the gateway; status: ${status}. Delivery not confirmed.`;
}

export function formatHubResponseSummary(results: RelayResult[]): string {
  const accepted = results.filter((result) => result.ok);
  if (accepted.length === 0) return "No successful responses from the messaging gateway.";

  const statuses = new Map<string, { label: string; status: string; count: number }>();
  for (const result of accepted) {
    const status = result.status || "not provided";
    const key = JSON.stringify([result.destination.label, status]);
    const current = statuses.get(key);
    if (current) current.count++;
    else statuses.set(key, { label: result.destination.label, status, count: 1 });
  }

  const statusSummary = [...statuses.values()]
    .map(({ label, status, count }) => `${label}: ${status} (${count})`)
    .join("; ");
  const replayCount = accepted.filter((result) => result.idempotentReplay).length;
  const replaySummary = replayCount > 0
    ? ` The gateway returned a replay in ${replayCount} response(s); no new send was confirmed.`
    : "";
  return `Statuses returned by the gateway: ${statusSummary}.${replaySummary}`;
}

/**
 * Downloads a Telegram sticker, converts it to a WhatsApp-compliant WebP,
 * validates the result, and sends it to every given destination via the
 * messaging gateway. Conversion happens once per sticker; the resulting WebP is
 * reused (as base64) across all destinations to avoid re-downloading or
 * re-rendering per recipient.
 */
export async function relayStickerToDestinations(
  api: Api,
  botToken: string,
  hub: HubClient,
  sticker: StickerRef,
  destinations: Destination[],
  options: {
    downloadTimeoutMs?: number;
    maxDownloadBytes?: number;
    tgsMaxFrames?: number;
    tgsRenderTimeoutMs?: number;
    ffmpegTimeoutMs?: number;
    cwebpTimeoutMs?: number;
    img2webpTimeoutMs?: number;
    logger?: Logger;
  } = {},
): Promise<RelayResult[]> {
  const downloaded = await downloadTelegramSticker(
    api,
    botToken,
    sticker.fileId,
    sticker.isAnimated,
    sticker.isVideo,
    options.downloadTimeoutMs,
    options.maxDownloadBytes,
  );

  let converted: ConvertedSticker;
  try {
    if (downloaded.kind === "animated") {
      converted = await convertTgsToWebp(
        downloaded.buffer,
        options.tgsMaxFrames,
        options.tgsRenderTimeoutMs,
        options.img2webpTimeoutMs,
      );
    } else if (downloaded.kind === "video") {
      converted = await convertWebmToWebp(downloaded.buffer, options.ffmpegTimeoutMs);
    } else {
      converted = await convertStaticImageToWebp(
        downloaded.buffer,
        "webp",
        options.cwebpTimeoutMs,
      );
    }
  } catch (error) {
    options.logger?.error({ err: error }, "sticker conversion failed");
    return destinations.map((destination) => ({
      destination,
      ok: false,
      error: error instanceof ConversionError
        ? "Conversion failed. Check the service logs for details."
        : "Sticker download or conversion failed. Check the service logs for details.",
    }));
  }

  const validation = validateWebpSticker(converted.webp, converted.animated);
  if (!validation.valid) {
    return destinations.map((destination) => ({
      destination,
      ok: false,
      error: "Converted sticker failed validation.",
    }));
  }

  const base64 = converted.webp.toString("base64");
  const results: RelayResult[] = [];

  for (const destination of destinations) {
    try {
      const response = await hub.sendSticker({
        chatId: destination.chatId,
        mimetype: "image/webp",
        data: base64,
        idempotencyKey: buildStickerIdempotencyKey(sticker, destination),
      });
      results.push({
        destination,
        ok: true,
        status: response.status,
        idempotentReplay: response.idempotentReplay,
      });
    } catch (error) {
      const detail =
        error instanceof HubApiError
          ? `HTTP ${error.status}: ${error.body.slice(0, 200)}`
          : (error as Error).message;
      results.push({ destination, ok: false, error: detail });
    }
  }

  return results;
}
