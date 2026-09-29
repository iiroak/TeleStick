import type { Bot } from "grammy";
import type { Logger } from "../../logger.js";
import type { Store } from "../../db/store.js";
import type { HubClient } from "../../hub/client.js";
import {
  formatHubResponseSummary,
  relayStickerToDestinations,
  type RelayResult,
  type StickerRef,
} from "../relay.js";

/**
 * Telegram sticker-pack share links look like `t.me/addstickers/<name>` or
 * just the bare `<name>`. `getStickerSet` accepts the bare name.
 */
function extractPackName(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/^(?:https?:\/\/)?(?:t\.me\/addstickers\/|addstickers\/)?([A-Za-z0-9_]+)\/?$/);
  if (!match?.[1]) {
    throw new Error("Could not parse the sticker pack name. Use /pack <name or t.me/addstickers/name>.");
  }
  return match[1];
}

export function registerPackCommand(
  bot: Bot,
  store: Store,
  hub: HubClient,
  botToken: string,
  logger: Logger,
  downloadTimeoutMs: number,
  maxDownloadBytes: number,
  tgsMaxFrames: number,
  converterTimeouts: {
    tgsRenderTimeoutMs: number;
    ffmpegTimeoutMs: number;
    cwebpTimeoutMs: number;
    img2webpTimeoutMs: number;
  },
): void {
  bot.command("pack", async (ctx) => {
    const arg = ctx.match?.trim();
    if (!arg) {
      await ctx.reply(
        "Usage: /pack <link or sticker pack name>\nExample: /pack https://t.me/addstickers/ExamplePack",
      );
      return;
    }

    const destinations = store.listEnabledDestinations();
    if (destinations.length === 0) {
      await ctx.reply("There are no active destinations. Configure one with /destinations first.");
      return;
    }

    let packName: string;
    try {
      packName = extractPackName(arg);
    } catch (error) {
      await ctx.reply((error as Error).message);
      return;
    }

    let stickerSet;
    try {
      stickerSet = await ctx.api.getStickerSet(packName);
    } catch (error) {
      logger.warn({ err: error, packName }, "failed to retrieve sticker pack");
      await ctx.reply(`Could not retrieve sticker pack "${packName}". Check that the name is correct and try again.`);
      return;
    }

    await ctx.reply(
      `Pack "${stickerSet.title.slice(0, 200)}" contains ${stickerSet.stickers.length} sticker(s). ` +
        `Submitting to ${destinations.length} destination(s)...`,
    );

    let okCount = 0;
    let failCount = 0;
    const relayResults: RelayResult[] = [];
    for (const sticker of stickerSet.stickers) {
      const stickerRef: StickerRef = {
        fileId: sticker.file_id,
        fileUniqueId: sticker.file_unique_id,
        isAnimated: sticker.is_animated ?? false,
        isVideo: sticker.is_video ?? false,
        sourceChatId: ctx.chat.id,
          sourceMessageId: String(ctx.message!.message_id),
      };
      try {
        const results = await relayStickerToDestinations(
          ctx.api,
          botToken,
          hub,
          stickerRef,
          destinations,
          {
            downloadTimeoutMs,
            maxDownloadBytes,
            tgsMaxFrames,
            ...converterTimeouts,
            logger,
          },
        );
        relayResults.push(...results);
        if (results.every((r) => r.ok)) okCount++;
        else failCount++;
      } catch (error) {
        logger.error({ err: error, packName, fileId: sticker.file_id }, "failed to relay pack sticker");
        failCount++;
      }
    }

    await ctx.reply(
      `Pack complete: ${okCount} sticker(s) accepted by the gateway (delivery not confirmed), ${failCount} failed.\n` +
        formatHubResponseSummary(relayResults),
    );
  });
}
