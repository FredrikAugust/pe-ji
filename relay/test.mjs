// End-to-end check against `wrangler dev`: a fake app on /connect, a fake AI on /mcp.
import assert from "node:assert/strict";

const BASE = process.env.RELAY ?? "http://127.0.0.1:8787";
const APP_KEY = process.env.APP_KEY ?? "app-test-key";
const BOT_KEY = process.env.BOT_KEY ?? "bot-test-key";

const post = (body, key = BOT_KEY) =>
  fetch(`${BASE}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

function app(name) {
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/connect?key=${APP_KEY}`);
  ws.closed = new Promise((r) => ws.addEventListener("close", (e) => r(e.code)));
  ws.addEventListener("message", (e) => {
    const { rid, msg } = JSON.parse(e.data);
    if (rid !== null) ws.send(JSON.stringify({ rid, reply: { jsonrpc: "2.0", id: msg.id, result: { from: name, method: msg.method } } }));
  });
  return new Promise((r) => ws.addEventListener("open", () => r(ws)));
}

assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, "wrong")).status, 401);
assert.match((await (await post({ jsonrpc: "2.0", id: 1, method: "ping" })).json()).error.message, /not open/);
const bad = await new Promise((r) => {
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/connect?key=wrong`);
  ws.addEventListener("error", () => r("refused"));
  ws.addEventListener("open", () => r("open"));
});
assert.equal(bad, "refused");

const home = await app("home");
assert.deepEqual((await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()).result, { from: "home", method: "tools/list" });
assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);

const laptop = await app("laptop");
assert.equal(await home.closed, 4000);
assert.equal((await (await post({ jsonrpc: "2.0", id: 3, method: "ping" })).json()).result.from, "laptop");
laptop.close();
console.log("relay ok");
