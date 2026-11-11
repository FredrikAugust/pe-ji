/**
 * MCP relay for ぴこぴこ作文帳.
 *
 * The desktop app keeps a WebSocket open to /connect (APP_KEY). An AI posts
 * MCP JSON-RPC to /mcp (BOT_KEY); the message is passed down the socket, the
 * app answers with its own MCP handler, and the reply goes back as the HTTP
 * response. One Durable Object holds the socket, so the URL never changes and
 * whichever computer opened the app last is the one the AI talks to.
 */

import { DurableObject } from "cloudflare:workers";

const TIMEOUT_MS = 25_000;

export default {
  fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname !== "/mcp" && pathname !== "/connect") return new Response("not found", { status: 404 });
    return env.RELAY.get(env.RELAY.idFromName("main")).fetch(req);
  },
};

/** Constant-time compare, so a key cannot be guessed byte by byte. */
function same(given, secret) {
  if (!given || !secret) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(secret);
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

const rpcError = (id, message) =>
  Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32000, message } });

export class Relay extends DurableObject {
  pending = new Map();
  next = 0;

  constructor(ctx, env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/connect") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      if (!same(url.searchParams.get("key"), this.env.APP_KEY)) return new Response("unauthorized", { status: 401 });
      // The newest app wins; the old one is told why and stops reconnecting.
      for (const old of this.ctx.getWebSockets()) old.close(4000, "replaced by another computer");
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    const auth = req.headers.get("Authorization") ?? "";
    if (!same(auth.replace(/^Bearer /, ""), this.env.BOT_KEY)) return new Response("unauthorized", { status: 401 });
    if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });

    let msg;
    try {
      msg = JSON.parse(await req.text());
    } catch {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
    }
    const [app] = this.ctx.getWebSockets();
    if (!("id" in msg)) {
      app?.send(JSON.stringify({ rid: null, msg }));
      return new Response(null, { status: 202 });
    }
    if (!app) return rpcError(msg.id, "ぴこぴこ作文帳 is not open on any computer right now.");

    const rid = ++this.next;
    const reply = await new Promise((resolve) => {
      this.pending.set(rid, resolve);
      app.send(JSON.stringify({ rid, msg }));
      setTimeout(() => this.pending.delete(rid) && resolve(null), TIMEOUT_MS);
    });
    return reply ? Response.json(reply) : rpcError(msg.id, "The app did not answer in time.");
  }

  webSocketMessage(_ws, data) {
    if (data === "ping") return;
    const { rid, reply } = JSON.parse(data);
    const resolve = this.pending.get(rid);
    if (resolve) {
      this.pending.delete(rid);
      resolve(reply);
    }
  }
}
