import { describe, expect, it, vi } from "vitest";
import { connectRelay, type RelayStatus, type Socket } from "../src/lib/relay";

class Fake implements Socket {
  sent: string[] = [];
  onopen: Socket["onopen"] = null;
  onmessage: Socket["onmessage"] = null;
  onclose: Socket["onclose"] = null;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  open() {
    this.onopen?.(new Event("open"));
  }
  receive(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  drop(code: number) {
    this.onclose?.(new CloseEvent("close", { code }));
  }
}

describe("relay client", () => {
  it("answers requests, reconnects, and stops when another computer takes over", async () => {
    vi.useFakeTimers();
    const sockets: Fake[] = [];
    const status: RelayStatus[] = [];
    const stop = connectRelay(
      "https://pe-ji-relay.me.workers.dev/",
      "k ey",
      async (msg) => ({ jsonrpc: "2.0", id: (msg as { id: number }).id, result: {} }),
      (s) => status.push(s),
      (url) => {
        const ws = new Fake(url);
        sockets.push(ws);
        return ws;
      },
    );
    expect(sockets[0].url).toBe("wss://pe-ji-relay.me.workers.dev/connect?key=k%20ey");
    sockets[0].open();
    sockets[0].receive({ rid: 3, msg: { jsonrpc: "2.0", id: 9, method: "ping" } });
    sockets[0].receive({ rid: null, msg: { jsonrpc: "2.0", method: "notifications/initialized" } });
    await vi.waitFor(() => expect(sockets[0].sent).toEqual([JSON.stringify({ rid: 3, reply: { jsonrpc: "2.0", id: 9, result: {} } })]));

    sockets[0].drop(1006);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sockets[1].drop(4000);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
    expect(status).toEqual(["connecting", "online", "offline", "connecting", "replaced"]);
    stop();
    vi.useRealTimers();
  });
});
