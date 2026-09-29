import { createServer, type Server } from "node:http";

/**
 * Minimal healthcheck server. The bot itself runs on Telegram long polling
 * and has no other reason to bind a port. Keep the endpoint on loopback by
 * default; IPv4 avoids localhost resolving to IPv6 in some containers.
 */
export function startHealthServer(
  port: number,
  bindAddress: string,
  isReady: () => boolean,
): Server {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/readyz") {
      if (isReady()) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ready" }));
      } else {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "not_ready" }));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, bindAddress);
  return server;
}
