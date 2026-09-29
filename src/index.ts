import { Bot } from "grammy";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { Store } from "./db/store.js";
import { HubClient } from "./hub/client.js";
import { allowlist } from "./bot/allowlist.js";
import { registerCoreCommands } from "./bot/commands/core.js";
import { registerDestinationCommands } from "./bot/commands/destinations.js";
import { registerPackCommand } from "./bot/commands/pack.js";
import { normalizeChatId } from "./hub/phone.js";
import { startHealthServer } from "./health.js";
import { assertConversionToolsAvailable } from "./convert/sticker.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  process.on("unhandledRejection", (error) => {
    logger.fatal({ err: error }, "unhandled rejection");
    process.exit(1);
  });
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    process.exit(1);
  });
  await assertConversionToolsAvailable();

  const store = new Store(join(config.dataDir, "bot.sqlite3"));
  if (config.defaultDestinations.length > 0) {
    store.seedDefaultsIfEmpty(
      config.defaultDestinations.map((raw) => ({
        label: raw,
        chatId: normalizeChatId(raw, config.defaultCountryCode),
      })),
    );
  }

  const hub = new HubClient(
    config.hubBaseUrl,
    config.hubApiKey,
    config.hubSessionId,
    config.hubTimeoutMs,
    config.hubMaxRetries,
    config.hubRetryBaseMs,
  );
  const bot = new Bot(config.telegramBotToken);

  bot.use(allowlist(config.allowedTelegramUserIds));

  registerCoreCommands(bot, store, hub, config.telegramBotToken, logger, {
    downloadTimeoutMs: config.telegramDownloadTimeoutMs,
    maxDownloadBytes: config.maxStickerDownloadBytes,
    tgsMaxFrames: config.tgsMaxFrames,
    tgsRenderTimeoutMs: config.tgsRenderTimeoutMs,
    ffmpegTimeoutMs: config.ffmpegTimeoutMs,
    cwebpTimeoutMs: config.cwebpTimeoutMs,
    img2webpTimeoutMs: config.img2webpTimeoutMs,
  });
  registerDestinationCommands(bot, store, config.defaultCountryCode);
  registerPackCommand(
    bot,
    store,
    hub,
    config.telegramBotToken,
    logger,
    config.telegramDownloadTimeoutMs,
    config.maxStickerDownloadBytes,
    config.tgsMaxFrames,
    {
      tgsRenderTimeoutMs: config.tgsRenderTimeoutMs,
      ffmpegTimeoutMs: config.ffmpegTimeoutMs,
      cwebpTimeoutMs: config.cwebpTimeoutMs,
      img2webpTimeoutMs: config.img2webpTimeoutMs,
    },
  );

  bot.catch((err) => {
    logger.error({
      err: err.error,
      updateId: err.ctx.update.update_id,
      chatType: err.ctx.chat?.type,
      updateType: Object.keys(err.ctx.update).filter((key) => key !== "update_id"),
    }, "unhandled bot error");
  });

  let botReady = false;
  const healthServer = startHealthServer(config.port, config.healthBindAddr, () => botReady);
  healthServer.on("error", (error) => {
    logger.fatal({ err: error }, "health server failed");
    process.exit(1);
  });

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    botReady = false;
    shutdownPromise = (async () => {
      logger.info("shutting down");
      const forceExit = setTimeout(() => {
        logger.fatal("graceful shutdown timed out");
        process.exit(1);
      }, 10_000);
      try {
        await bot.stop();
        await new Promise<void>((resolve) => healthServer.close(() => resolve()));
      } finally {
        store.close();
        clearTimeout(forceExit);
      }
    })();
    return shutdownPromise;
  };
  process.on("SIGINT", () => void shutdown().catch((error) => {
    logger.fatal({ err: error }, "shutdown failed");
    process.exit(1);
  }));
  process.on("SIGTERM", () => void shutdown().catch((error) => {
    logger.fatal({ err: error }, "shutdown failed");
    process.exit(1);
  }));

  logger.info("starting bot (long polling)");
  await bot.start({
    onStart: (botInfo) => {
      botReady = true;
      logger.info({ username: botInfo.username }, "bot started");
    },
  });
}

main().catch((error) => {
  console.error("fatal error during startup", error);
  process.exit(1);
});
