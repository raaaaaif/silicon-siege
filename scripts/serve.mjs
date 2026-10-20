import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve("web");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".log": "text/plain",
  ".svg": "image/svg+xml",
  ".md": "text/plain",
  ".v": "text/plain",
  ".txt": "text/plain",
  ".woff2": "font/woff2",
};
http
  .createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (p.startsWith("/api/")) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              "Live mentor is available on the Cloudflare deployment. Local search works offline.",
          }),
        );
        return;
      }
      const target = path.resolve(root, "." + (p === "/" ? "/index.html" : p));
      if (!target.startsWith(root + path.sep)) throw Error("Forbidden");
      const body = await fs.readFile(target);
      res.writeHead(200, {
        "Content-Type":
          types[path.extname(target)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(4173, "127.0.0.1", () =>
    console.log("Silicon Siege: http://127.0.0.1:4173"),
  );
