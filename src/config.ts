import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  ALLOWED_TELEGRAM_USER_IDS: z
    .string()
    .min(1, "ALLOWED_TELEGRAM_USER_IDS is required (comma-separated user ids)"),
  HUB_BASE_URL: z.string().url("HUB_BASE_URL must be a valid URL"),
  HUB_API_KEY: z.string().min(1, "HUB_API_KEY is required"),
  HUB_SESSION_ID: z.string().min(1).default("main"),
  DEFAULT_DESTINATIONS: z.string().default(""),
  DEFAULT_COUNTRY_CODE: z
    .string()
    .regex(/^(?:|[1-9]\d{0,2})$/, "DEFAULT_COUNTRY_CODE must be a 1-3 digit calling code without +")
    .default(""),
  DATA_DIR: z.string().default("./data"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  HEALTH_BIND_ADDR: z.string().default("127.0.0.1"),
  HUB_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  HUB_MAX_RETRIES: z.coerce.number().int().nonnegative().max(5).default(2),
  HUB_RETRY_BASE_MS: z.coerce.number().int().nonnegative().default(500),
  TELEGRAM_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MAX_STICKER_DOWNLOAD_BYTES: z.coerce.number().int().positive().default(5_000_000),
  TGS_MAX_FRAMES: z.coerce.number().int().positive().max(1000).default(300),
  TGS_RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  FFMPEG_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  CWEBP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  IMG2WEBP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  telegramBotToken: string;
  allowedTelegramUserIds: Set<number>;
  hubBaseUrl: string;
  hubApiKey: string;
  hubSessionId: string;
  defaultDestinations: string[];
  defaultCountryCode: string;
  dataDir: string;
  logLevel: Env["LOG_LEVEL"];
  port: number;
  healthBindAddr: string;
  hubTimeoutMs: number;
  hubMaxRetries: number;
  hubRetryBaseMs: number;
  telegramDownloadTimeoutMs: number;
  maxStickerDownloadBytes: number;
  tgsMaxFrames: number;
  tgsRenderTimeoutMs: number;
  ffmpegTimeoutMs: number;
  cwebpTimeoutMs: number;
  img2webpTimeoutMs: number;
}

function parseUserIds(raw: string): Set<number> {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const id = Number(part);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(`ALLOWED_TELEGRAM_USER_IDS contains an invalid Telegram user ID: ${part}`);
      }
      return id;
    });
  if (ids.length === 0) {
    throw new Error("ALLOWED_TELEGRAM_USER_IDS must contain at least one Telegram user id");
  }
  return new Set(ids);
}

function parseDestinations(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    allowedTelegramUserIds: parseUserIds(parsed.ALLOWED_TELEGRAM_USER_IDS),
    hubBaseUrl: parsed.HUB_BASE_URL.replace(/\/+$/, ""),
    hubApiKey: parsed.HUB_API_KEY,
    hubSessionId: parsed.HUB_SESSION_ID,
    defaultDestinations: parseDestinations(parsed.DEFAULT_DESTINATIONS),
    defaultCountryCode: parsed.DEFAULT_COUNTRY_CODE,
    dataDir: parsed.DATA_DIR,
    logLevel: parsed.LOG_LEVEL,
    port: parsed.PORT,
    healthBindAddr: parsed.HEALTH_BIND_ADDR,
    hubTimeoutMs: parsed.HUB_TIMEOUT_MS,
    hubMaxRetries: parsed.HUB_MAX_RETRIES,
    hubRetryBaseMs: parsed.HUB_RETRY_BASE_MS,
    telegramDownloadTimeoutMs: parsed.TELEGRAM_DOWNLOAD_TIMEOUT_MS,
    maxStickerDownloadBytes: parsed.MAX_STICKER_DOWNLOAD_BYTES,
    tgsMaxFrames: parsed.TGS_MAX_FRAMES,
    tgsRenderTimeoutMs: parsed.TGS_RENDER_TIMEOUT_MS,
    ffmpegTimeoutMs: parsed.FFMPEG_TIMEOUT_MS,
    cwebpTimeoutMs: parsed.CWEBP_TIMEOUT_MS,
    img2webpTimeoutMs: parsed.IMG2WEBP_TIMEOUT_MS,
  };
}
