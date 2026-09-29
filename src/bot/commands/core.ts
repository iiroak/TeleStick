import type { Bot } from "grammy";
import type { Logger } from "../../logger.js";
import type { Store } from "../../db/store.js";
import type { HubClient } from "../../hub/client.js";
import {
  formatHubResponseSummary,
  formatRelayResult,
  relayStickerToDestinations,
  restoreBatchStickerRef,
  type RelayResult,
  type StickerRef,
  type StoredStickerRef,
} from "../relay.js";
import { formatDestinationsSummary } from "./destinations.js";

const MAX_BATCH_ITEMS = 120;

function parseBatchItems(raw: string): StoredStickerRef[] | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return undefined;
    if (value.length > MAX_BATCH_ITEMS) return undefined;
    if (!value.every((item) => item && typeof item.fileId === "string" &&
      typeof item.fileUniqueId === "string" && typeof item.isAnimated === "boolean" &&
      typeof item.isVideo === "boolean" &&
      (item.sourceChatId === undefined || Number.isSafeInteger(item.sourceChatId)) &&
      (item.sourceMessageId === undefined || typeof item.sourceMessageId === "string"))) {
      return undefined;
    }
    return value as StoredStickerRef[];
  } catch {
    return undefined;
  }
}

export function registerCoreCommands(
  bot: Bot,
  store: Store,
  hub: HubClient,
  botToken: string,
  logger: Logger,
  downloadOptions: {
    downloadTimeoutMs: number;
    maxDownloadBytes: number;
    tgsMaxFrames: number;
    tgsRenderTimeoutMs: number;
    ffmpegTimeoutMs: number;
    cwebpTimeoutMs: number;
    img2webpTimeoutMs: number;
  },
): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hi! I forward Telegram stickers to WhatsApp.\n\n" +
        "Commands:\n" +
        "/destinations - view and configure sticker destinations\n" +
        "/add <number> [label] - add a destination\n" +
        "/mode - forward each sticker you send\n" +
        "/batch - collect stickers and forward them with /send\n" +
        "/stop - stop continuous or batch mode\n" +
        "/status - check the WhatsApp session and bot state\n" +
        "/pack <link or name> - forward a Telegram sticker pack\n\n" +
        "Outside these modes, each sticker is submitted to the gateway for active destinations. " +
        "A gateway response does not confirm final delivery.",
    );
  });

  bot.command("status", async (ctx) => {
    const userId = ctx.from!.id;
    const state = store.getState(userId);
    const destinations = store.listEnabledDestinations();
    let hubStatus: string;
    try {
      const status = await hub.getSessionStatus();
      hubStatus = status.status;
    } catch (error) {
      logger.warn({ err: error }, "failed to read messaging session status");
      hubStatus = "unavailable";
    }
    await ctx.reply(
      `Current mode: ${state.mode}\n` +
        `WhatsApp session: ${hubStatus}\n` +
        `Active destinations: ${destinations.length}\n\n` +
        formatDestinationsSummary(store),
    );
  });

  bot.command("mode", async (ctx) => {
    const userId = ctx.from!.id;
    store.setState(userId, { mode: "continuous", batchItems: "[]" });
    await ctx.reply(
      "Continuous mode is on. Each sticker you send is submitted to the gateway immediately. " +
        "The reported status does not confirm delivery. Use /stop to exit.",
    );
  });

  bot.command("batch", async (ctx) => {
    const userId = ctx.from!.id;
    store.setState(userId, { mode: "batch", batchItems: "[]" });
    await ctx.reply(
      "Batch mode is on. Send stickers, then use /send to submit them or /stop to cancel.",
    );
  });

  bot.command("send", async (ctx) => {
    const userId = ctx.from!.id;
    const state = store.getState(userId);
    if (state.mode !== "batch") {
      await ctx.reply("Batch mode is not active. Use /batch to start one.");
      return;
    }
    const storedItems = parseBatchItems(state.batchItems);
    if (!storedItems) {
      logger.error("invalid persisted batch state; resetting it");
      store.setState(userId, { mode: "idle", batchItems: "[]" });
      await ctx.reply("Saved batch data was invalid and has been cleared. Start a new batch with /batch.");
      return;
    }
    const items: StickerRef[] = storedItems.map((item, index) =>
      restoreBatchStickerRef(item, ctx.chat.id, ctx.message!.message_id, index),
    );
    if (items.length === 0) {
      await ctx.reply("The batch is empty. There is nothing to send.");
      store.setState(userId, { mode: "idle", batchItems: "[]" });
      return;
    }
    const destinations = store.listEnabledDestinations();
    if (destinations.length === 0) {
      await ctx.reply("There are no active destinations. Configure one with /destinations.");
      return;
    }
    store.setState(userId, { mode: "idle", batchItems: "[]" });
    await ctx.reply(`Submitting ${items.length} sticker(s) to ${destinations.length} destination(s)...`);

    let okCount = 0;
    let failCount = 0;
    const relayResults: RelayResult[] = [];
    for (const item of items) {
      try {
        const results = await relayStickerToDestinations(
          ctx.api,
          botToken,
          hub,
          item,
          destinations,
          { ...downloadOptions, logger },
        );
        relayResults.push(...results);
        if (results.every((r) => r.ok)) okCount++;
        else failCount++;
      } catch (error) {
        logger.error({ err: error }, "failed to relay batched sticker");
        failCount++;
      }
    }
    await ctx.reply(
      `Batch complete: ${okCount} sticker(s) accepted by the gateway (delivery not confirmed), ${failCount} failed.\n` +
        formatHubResponseSummary(relayResults),
    );
  });

  bot.command("stop", async (ctx) => {
    const userId = ctx.from!.id;
    store.setState(userId, { mode: "idle", batchItems: "[]" });
    await ctx.reply("Continuous/batch mode stopped.");
  });

  bot.on("message:sticker", async (ctx) => {
    const userId = ctx.from!.id;
    const state = store.getState(userId);
    const destinations = store.listEnabledDestinations();

    if (destinations.length === 0) {
      await ctx.reply("There are no active destinations. Configure one with /destinations first.");
      return;
    }

    const stickerRef: StickerRef = {
      fileId: ctx.message.sticker.file_id,
      fileUniqueId: ctx.message.sticker.file_unique_id,
      isAnimated: ctx.message.sticker.is_animated ?? false,
      isVideo: ctx.message.sticker.is_video ?? false,
      sourceChatId: ctx.chat.id,
      sourceMessageId: String(ctx.message.message_id),
    };

    if (state.mode === "batch") {
      const items = parseBatchItems(state.batchItems);
      if (!items) {
        logger.error("invalid persisted batch state; resetting it");
        store.setState(userId, { mode: "idle", batchItems: "[]" });
        await ctx.reply("Saved batch data was invalid and has been cleared. Start a new batch with /batch.");
        return;
      }
      if (items.length >= MAX_BATCH_ITEMS) {
        await ctx.reply(`A batch can contain at most ${MAX_BATCH_ITEMS} stickers.`);
        return;
      }
      items.push(stickerRef);
      store.setState(userId, { mode: "batch", batchItems: JSON.stringify(items) });
      await ctx.reply(
        `Sticker added to the batch (${items.length} total). Use /send when ready.`,
      );
      return;
    }

    await ctx.reply("Converting the sticker and submitting it to the messaging gateway...");
    try {
      const results = await relayStickerToDestinations(
        ctx.api,
        botToken,
        hub,
        stickerRef,
        destinations,
        { ...downloadOptions, logger },
      );
      const lines = results.map((r) =>
        formatRelayResult(r),
      );
      await ctx.reply(lines.join("\n"));
    } catch (error) {
      logger.error({ err: error }, "failed to relay sticker");
      await ctx.reply("Failed to process the sticker. Check the service logs for details.");
    }
  });
}
