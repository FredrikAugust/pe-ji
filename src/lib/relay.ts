/**
 * Client for the cloud relay (`relay/`): keeps a WebSocket to `/connect`
 * open and answers each MCP message with `handle`. Reconnects with backoff,
 * except when another computer took over (close code 4000).
 */

export type RelayStatus = "connecting" | "online" | "offline" | "replaced";

/** The part of WebSocket this uses (tests pass a fake). */
export interface Socket {
  send(data: string): void;
  close(): void;
  onopen: ((e: Event) => unknown) | null;
  onmessage: ((e: MessageEvent) => unknown) | null;
  onclose: ((e: CloseEvent) => unknown) | null;
}

export function connectRelay(
  base: string,
  key: string,
  handle: (msg: unknown) => Promise<unknown>,
  onStatus: (s: RelayStatus) => void,
  open: (url: string) => Socket = (url) => new WebSocket(url),
): () => void {
  const url = `${base.trim().replace(/^http/, "ws").replace(/\/+$/, "")}/connect?key=${encodeURIComponent(key.trim())}`;
  let ws: Socket;
  let stopped = false;
  let delay = 1000;
  let ping: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    onStatus("connecting");
    ws = open(url);
    ws.onopen = () => {
      delay = 1000;
      onStatus("online");
      ping = setInterval(() => ws.send("ping"), 30_000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data === "pong") return;
      const { rid, msg } = JSON.parse(e.data) as { rid: number | null; msg: { id?: unknown } };
      void handle(msg)
        .catch((err) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: String(err) } }))
        .then((reply) => {
          if (rid !== null && reply) ws.send(JSON.stringify({ rid, reply }));
        });
    };
    ws.onclose = (e) => {
      clearInterval(ping);
      if (stopped) return;
      if (e.code === 4000) return onStatus("replaced");
      onStatus("offline");
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(ping);
    ws.close();
  };
}
