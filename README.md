# TeleStick

TeleStick forwards Telegram stickers to WhatsApp through a compatible HTTP messaging gateway. It supports static WebP, video stickers (WebM/VP9), and animated Telegram stickers (TGS/Lottie).

The bot uses Telegram long polling and only accepts commands and stickers from configured Telegram user IDs in private chats. It does not confirm WhatsApp delivery: gateway acceptance/status is reported as returned by the gateway.

## Requirements

- Node.js 22.23 or newer
- pnpm 10.34.4
- Python 3, `rlottie-python` 1.3.8, and Pillow 11.0.0 (TGS conversion)
- `ffmpeg` (video sticker conversion)
- `webp` command-line tools (`cwebp`, `img2webp`)
- A Telegram bot token and an HTTP gateway that implements the sticker and session-status endpoints used by TeleStick

## Configure

```sh
cp .env.example .env
```

Set `TELEGRAM_BOT_TOKEN`, `ALLOWED_TELEGRAM_USER_IDS`, `HUB_BASE_URL`, and `HUB_API_KEY`. Leave `DEFAULT_COUNTRY_CODE` empty to require international phone numbers beginning with `+`; set it to a calling code such as `1` if you want national-format numbers accepted. Do not commit `.env`.

| Variable | Default | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | required | Token from BotFather |
| `ALLOWED_TELEGRAM_USER_IDS` | required | Comma-separated numeric user IDs; access is restricted to private chats |
| `HUB_BASE_URL` | required | Base URL of the compatible messaging gateway |
| `HUB_API_KEY` | required | Bearer API key for the gateway |
| `HUB_SESSION_ID` | `main` | Gateway session identifier |
| `DEFAULT_DESTINATIONS` | empty | Optional comma-separated numbers/JIDs, seeded only into an empty database |
| `DEFAULT_COUNTRY_CODE` | empty | Calling code used for national-format phone numbers; digits only |
| `DATA_DIR` | `./data` | SQLite database directory |
| `LOG_LEVEL` | `info` | Pino log level |
| `PORT` | `3000` | Health endpoint port |
| `HEALTH_BIND_ADDR` | `127.0.0.1` | Health endpoints bind address; keep private |
| `HUB_TIMEOUT_MS` | `15000` | Gateway request timeout |
| `HUB_MAX_RETRIES` | `2` | Retries for idempotent sends after network/5xx errors (0–5) |
| `HUB_RETRY_BASE_MS` | `500` | Exponential retry backoff base |
| `TELEGRAM_DOWNLOAD_TIMEOUT_MS` | `30000` | Sticker download timeout |
| `MAX_STICKER_DOWNLOAD_BYTES` | `5000000` | Maximum downloaded sticker size |
| `TGS_MAX_FRAMES` | `300` | Maximum rendered frames per animated sticker |
| `TGS_RENDER_TIMEOUT_MS` | `30000` | Maximum TGS rendering time |
| `FFMPEG_TIMEOUT_MS` | `30000` | Maximum ffmpeg call time |
| `CWEBP_TIMEOUT_MS` | `15000` | Maximum cwebp call time |
| `IMG2WEBP_TIMEOUT_MS` | `30000` | Maximum img2webp call time |

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm start
```

## Bot commands

- `/start` — help
- `/destinations` — view, enable/disable, or remove destinations
- `/add <number> [label]` — add a WhatsApp destination
- `/mode` — forward each sticker as it arrives
- `/batch` and `/send` — collect and forward a batch
- `/pack <link or name>` — forward a Telegram sticker pack
- `/status` — check bot state and gateway session status
- `/stop` — stop continuous or batch mode

## Docker

Build with `docker build -t telestick .`. Provide the required environment variables at runtime and mount a persistent volume at `/app/data`; the SQLite database contains destinations and per-user batch state. The image includes the Python renderer and conversion tools. The health endpoint binds to loopback by default.

## Privacy and security

- Store tokens and API keys in a secret manager or deployment environment, never in source control.
- Restrict bot access to trusted user IDs. Group chats are denied.
- Keep `/healthz` and `/readyz` private; they are health probes, not authenticated APIs. `/healthz` is liveness; `/readyz` is readiness.
- The gateway API key is sent only to `HUB_BASE_URL`. Sticker downloads use Telegram's Bot API file endpoint.
- Use persistent storage and back up the SQLite database before upgrades.

## License

MIT. See [LICENSE](LICENSE).
