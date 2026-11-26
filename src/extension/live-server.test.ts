import * as http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { type LiveServer, type LiveSource, routeOf, startLiveServer } from "./live-server";

const TOKEN = "ab".repeat(32);

describe("routeOf — who may ask the live server for what", () => {
  it("serves a document's page, data and updates only under the private link", () => {
    const host = "127.0.0.1:5000";
    expect(routeOf("GET", `/${TOKEN}/doc/3`, host, TOKEN)).toEqual({ kind: "page", id: 3 });
    expect(routeOf("GET", `/${TOKEN}/data/3?x=1`, host, TOKEN)).toEqual({ kind: "data", id: 3 });
    expect(routeOf("GET", `/${TOKEN}/events/0`, host, TOKEN)).toEqual({ kind: "events", id: 0 });
    expect(routeOf("GET", `/${TOKEN}/file/abc123`, host, TOKEN)).toEqual({ kind: "file", key: "abc123" });
  });

  it("refuses a wrong or missing token, unknown paths and path tricks", () => {
    const host = "localhost:5000";
    for (const url of [
      `/${"cd".repeat(32)}/doc/1`,
      "/doc/1",
      `/${TOKEN}`,
      `/${TOKEN}/doc/x`,
      `/${TOKEN}/doc/../data/1`,
      `/${TOKEN}/file/a.b`,
    ])
      expect(routeOf("GET", url, host, TOKEN)).toEqual({ kind: "refuse", status: 404 });
  });

  it("refuses a page that points its own domain at this computer (DNS rebinding) and anything but GET", () => {
    expect(routeOf("GET", `/${TOKEN}/doc/1`, "evil.example:5000", TOKEN)).toEqual({
      kind: "refuse",
      status: 403,
    });
    expect(routeOf("GET", `/${TOKEN}/doc/1`, undefined, TOKEN)).toEqual({ kind: "refuse", status: 403 });
    expect(routeOf("POST", `/${TOKEN}/doc/1`, "127.0.0.1:5000", TOKEN)).toEqual({
      kind: "refuse",
      status: 405,
    });
    expect(routeOf("GET", `/${TOKEN}/doc/1`, "[::1]:5000", TOKEN)).toEqual({ kind: "page", id: 1 });
  });
});

function get(
  url: string,
  host?: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, host ? { headers: { host } } : {}, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          body += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      })
      .on("error", reject);
  });
}

describe("startLiveServer — the real server on 127.0.0.1", () => {
  let server: LiveServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  const source: LiveSource = {
    page: async (id) => (id === 0 ? "<!doctype html><p>page zero</p>" : undefined),
    data: async (id) => (id === 0 ? '{"type":"render","n":1}' : undefined),
    file: () => undefined,
  };

  it("listens only on 127.0.0.1 with a fresh 64-character private link", async () => {
    server = await startLiveServer(source, { keepAliveMs: 60000, maxListeners: 5 });
    expect(server.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}$/);
    const page = await get(`${server.base}/doc/0`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("page zero");
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    expect(page.headers["access-control-allow-origin"]).toBeUndefined();
    expect((await get(`${server.base}/doc/7`)).status).toBe(404);
    expect((await get(`${server.base}/doc/0`, "evil.example")).status).toBe(403);
  });

  it("pushes 'change' to the tabs of the changed document only", async () => {
    server = await startLiveServer(source, { keepAliveMs: 60000, maxListeners: 5 });
    const live = server;
    const listen = (id: number) => {
      const got = { text: "" };
      const req = http.get(`${live.base}/events/${id}`, (res) => {
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          got.text += c;
        });
      });
      return { got, req };
    };
    const zero = listen(0);
    const one = listen(1);
    await expect.poll(() => live.listeners()).toBe(2);
    live.notify(0);
    await expect.poll(() => zero.got.text).toContain("data: change");
    expect(one.got.text).not.toContain("data: change");
    zero.req.destroy();
    one.req.destroy();
    await expect.poll(() => live.listeners()).toBe(0);
  });

  it("caps the tabs that may listen at once", async () => {
    server = await startLiveServer(source, { keepAliveMs: 60000, maxListeners: 1 });
    const first = http.get(`${server.base}/events/0`);
    const live = server;
    await expect.poll(() => live.listeners()).toBe(1);
    expect((await get(`${server.base}/events/0`)).status).toBe(503);
    first.destroy();
  });

  it("after close, nothing answers on that address any more", async () => {
    server = await startLiveServer(source, { keepAliveMs: 60000, maxListeners: 5 });
    const base = server.base;
    await server.close();
    server = undefined;
    await expect(get(`${base}/doc/0`)).rejects.toThrow();
  });
});
