import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The live browser view's local web server (owner call 2026-11-17). Knows nothing about VS Code: it serves what a
 * `LiveSource` hands it and pushes "change" to the browser tabs that listen.
 *
 * Who can reach it: only this computer (bound to 127.0.0.1), only with the private link (a random 32-byte token is
 * the first part of every path; anything else is 404), only by a loopback host name (a web page that points its own
 * domain at 127.0.0.1 is refused), only GET. No cross-origin headers, so another site's script cannot read a reply.
 */
export interface LiveSource {
  /** The page of document `id` (HTML), or undefined if there is none. */
  page(id: number): Promise<string | undefined>;
  /** The newest render message of document `id`, as JSON text. */
  data(id: number): Promise<string | undefined>;
  /** An approved file by its key (images the page shows, the diagram library). */
  file(key: string): { readonly path: string; readonly type: string } | undefined;
}

export interface LiveServer {
  /** `http://127.0.0.1:<port>/<token>` — every URL of this server starts with it. */
  readonly base: string;
  /** Tells the tabs showing document `id` (all tabs if none given) that it changed. */
  notify(id?: number): void;
  /** Tabs listening right now (for tests and the log). */
  listeners(): number;
  close(): Promise<void>;
}

export type LiveRoute =
  | { readonly kind: "page" | "data" | "events"; readonly id: number }
  | { readonly kind: "file"; readonly key: string }
  | { readonly kind: "refuse"; readonly status: 403 | 404 | 405 };

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

/** Pure: what a request asks for, or why it is refused. */
export function routeOf(
  method: string | undefined,
  url: string | undefined,
  host: string | undefined,
  token: string,
): LiveRoute {
  if (method !== "GET" && method !== "HEAD") return { kind: "refuse", status: 405 };
  if (!host || !LOOPBACK_HOST.test(host)) return { kind: "refuse", status: 403 };
  const path = (url ?? "").split(/[?#]/, 1)[0] ?? "";
  const m = /^\/([0-9a-f]{64})\/(doc|data|events|file)\/([A-Za-z0-9-]{1,40})$/.exec(path);
  if (!m || !sameToken(m[1] ?? "", token)) return { kind: "refuse", status: 404 };
  const what = m[2] as "doc" | "data" | "events" | "file";
  const rest = m[3] ?? "";
  if (what === "file") return { kind: "file", key: rest };
  if (!/^\d{1,6}$/.test(rest)) return { kind: "refuse", status: 404 };
  return { kind: what === "doc" ? "page" : what, id: Number(rest) };
}

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Headers on every reply: never cached, never sniffed, never framed, never leaks the private link to another site. */
const COMMON = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "frame-ancestors 'none'",
} as const;

/** A served file (an SVG could hold script): sandboxed, nothing loads, if a reader opens its URL directly. */
const FILE_LOCKDOWN = {
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
} as const;

export async function startLiveServer(
  source: LiveSource,
  options: {
    readonly keepAliveMs: number;
    readonly maxListeners: number;
    readonly onError?: (e: unknown) => void;
  },
): Promise<LiveServer> {
  const token = randomBytes(32).toString("hex");
  const tabs = new Map<number, Set<ServerResponse>>();
  const count = () => [...tabs.values()].reduce((n, s) => n + s.size, 0);

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      options.onError?.(error);
      if (!res.headersSent) send(res, 500, "text/plain; charset=utf-8", "Something went wrong.");
      else res.destroy();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const route = routeOf(req.method, req.url, req.headers.host, token);
    switch (route.kind) {
      case "refuse":
        return send(
          res,
          route.status,
          "text/plain; charset=utf-8",
          route.status === 404 ? "Not found." : "Refused.",
        );
      case "page": {
        const html = await source.page(route.id);
        return html === undefined
          ? send(res, 404, "text/plain; charset=utf-8", "Not found.")
          : send(res, 200, "text/html; charset=utf-8", html, req.method === "HEAD");
      }
      case "data": {
        const json = await source.data(route.id);
        return json === undefined
          ? send(res, 404, "text/plain; charset=utf-8", "Not found.")
          : send(res, 200, "application/json; charset=utf-8", json, req.method === "HEAD");
      }
      case "events": {
        if (count() >= options.maxListeners)
          return send(res, 503, "text/plain; charset=utf-8", "Too many tabs.");
        res.writeHead(200, {
          ...COMMON,
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive",
        });
        res.write(": docmap live\n\n");
        const set = tabs.get(route.id) ?? new Set<ServerResponse>();
        tabs.set(route.id, set);
        set.add(res);
        req.on("close", () => {
          set.delete(res);
          if (set.size === 0) tabs.delete(route.id);
        });
        return;
      }
      case "file": {
        const file = source.file(route.key);
        if (!file) return send(res, 404, "text/plain; charset=utf-8", "Not found.");
        const size = await stat(file.path).then(
          (s) => (s.isFile() ? s.size : undefined),
          () => undefined,
        );
        if (size === undefined) return send(res, 404, "text/plain; charset=utf-8", "Not found.");
        // opened on its own (not as an image or the page's script), a file can never run script in this origin
        const headers = { ...COMMON, ...FILE_LOCKDOWN, "Content-Type": file.type, "Content-Length": size };
        if (req.method === "HEAD") {
          res.writeHead(200, headers);
          res.end();
          return;
        }
        const stream = createReadStream(file.path, { end: Math.max(0, size - 1) });
        stream.once("open", () => {
          res.writeHead(200, headers);
          stream.pipe(res);
        });
        stream.once("error", () => {
          if (!res.headersSent) send(res, 404, "text/plain; charset=utf-8", "Not found.");
          else res.destroy();
        });
        return;
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", (e) => options.onError?.(e));
  const { port } = server.address() as AddressInfo;

  const ping = setInterval(() => {
    for (const set of tabs.values())
      for (const res of set) if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
  }, options.keepAliveMs);
  ping.unref();

  return {
    base: `http://127.0.0.1:${port}/${token}`,
    notify(id) {
      const sets = id === undefined ? [...tabs.values()] : [tabs.get(id)].filter((s) => s !== undefined);
      for (const set of sets)
        for (const res of set) if (!res.writableEnded && !res.destroyed) res.write("data: change\n\n");
    },
    listeners: count,
    close() {
      clearInterval(ping);
      for (const set of tabs.values()) for (const res of set) res.end();
      tabs.clear();
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

function send(res: ServerResponse, status: number, type: string, body: string, headOnly = false): void {
  res.writeHead(status, { ...COMMON, "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
  res.end(headOnly ? undefined : body);
}
