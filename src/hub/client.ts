import { z } from "zod";

export interface SendStickerPayload {
  chatId: string;
  mimetype: string;
  url?: string;
  data?: string;
  filename?: string;
  idempotencyKey?: string;
}

export interface HubMessage {
  id: string;
  chat_id: string;
  provider_message_key: string;
  message_type: string;
  text: string | null;
  status: string;
  created_at: string;
}

const hubMessageSchema = z.object({
  id: z.string(),
  chat_id: z.string(),
  provider_message_key: z.string(),
  message_type: z.string(),
  text: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
}).passthrough();

const sendStickerResponseSchema = z.object({
  message: hubMessageSchema,
  provider: z.string().optional(),
  provider_message_id: z.string().optional(),
  status: z.string().optional(),
  idempotent_replay: z.boolean(),
});

const sessionStatusResponseSchema = z.object({ status: z.string() });

export interface SendStickerResult {
  message: HubMessage;
  provider: string;
  providerMessageId: string;
  status: string;
  idempotentReplay: boolean;
}

export class HubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "HubApiError";
  }
}

export class HubClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly sessionId: string,
    private readonly timeoutMs = 15_000,
    private readonly maxRetries = 2,
    private readonly retryBaseMs = 500,
  ) {}

  async sendSticker(payload: SendStickerPayload): Promise<SendStickerResult> {
    const body: Record<string, unknown> = {
      chat_id: payload.chatId,
      mimetype: payload.mimetype,
    };
    if (payload.url) body["url"] = payload.url;
    if (payload.data) body["data"] = payload.data;
    if (payload.filename) body["filename"] = payload.filename;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (payload.idempotencyKey) {
      headers["Idempotency-Key"] = payload.idempotencyKey;
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(
          `${this.baseUrl}/api/v1/sessions/${encodeURIComponent(this.sessionId)}/messages/sticker`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
          },
        );

        const text = await response.text();
        if (!response.ok) {
          const error = new HubApiError(
            `Messaging gateway returned HTTP ${response.status}`,
            response.status,
            text,
          );
          if (response.status < 500 || !payload.idempotencyKey || attempt >= this.maxRetries) {
            throw error;
          }
        } else {
          const parsed = parseJsonResponse(text, sendStickerResponseSchema);
          return {
            message: parsed.message,
            provider: parsed.provider ?? "",
            providerMessageId: parsed.provider_message_id ?? "",
            status: parsed.status ?? "",
            idempotentReplay: parsed.idempotent_replay,
          };
        }
      } catch (error) {
        const canRetry = payload.idempotencyKey && attempt < this.maxRetries &&
          (!(error instanceof HubApiError) || error.status >= 500);
        if (!canRetry) throw error;
      }
      const backoff = this.retryBaseMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoff + Math.random() * backoff));
    }
  }

  async getSessionStatus(): Promise<{ status: string }> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/sessions/${encodeURIComponent(this.sessionId)}/status`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new HubApiError(
        `Messaging gateway returned HTTP ${response.status}`,
        response.status,
        text,
      );
    }
    return parseJsonResponse(text, sessionStatusResponseSchema);
  }
}

function parseJsonResponse<T extends z.ZodType>(text: string, schema: T): z.infer<T> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Messaging gateway returned invalid JSON");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Messaging gateway returned an unexpected response");
  }
  return parsed.data;
}
