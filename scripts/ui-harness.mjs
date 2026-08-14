import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const port = Number(process.env.UGS_UI_PORT || 4173);
let turns = 0;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json"
};

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || "{}");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/mock-api/health") return sendJson(response, { allowed: true });

    if (url.pathname === "/mock-api/chat" && request.method === "POST") {
      const body = await readBody(request);
      turns += 1;
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (/створи\s+сайт/iu.test(body.message || "")) {
        return sendJson(response, {
          answer: "Готово — створено безпечний демонстраційний сайт.",
          turnsUsed: turns,
          conversationState: `mock-${turns}`,
          artifactGenerationsRemaining: 2,
          artifactState: "mock-artifact",
          artifact: {
            type: "site",
            title: "Навчальний проєкт",
            html: "<!doctype html><html lang='uk'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Навчальний проєкт</title><style>body{font:18px system-ui;padding:2rem;background:#eef8ff;color:#123}button{padding:.8rem}</style></head><body><h1>Навчальний проєкт</h1><p>Безпечний локальний перегляд.</p><button onclick=\"this.textContent='Готово'\">Перевірити</button></body></html>"
          }
        });
      }
      return sendJson(response, {
        answer: "## Коротка відповідь\n\nЦе **тестова** відповідь локального UI-harness.\n\n- Перший пункт\n- Другий пункт",
        turnsUsed: turns,
        conversationState: `mock-${turns}`
      });
    }

    let pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(root, pathname.replace(/^\/+/, "")));
    if (!file.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    let content = await readFile(file);
    if (pathname === "/index.html") {
      content = Buffer.from(content.toString("utf8").replace(
        "connect-src https://ugs-chat-api.kysliakov.workers.dev",
        "connect-src 'self'"
      ));
    } else if (pathname === "/app.js") {
      content = Buffer.from(content.toString("utf8").replace(
        'const API_URL = "https://ugs-chat-api.kysliakov.workers.dev";',
        `const API_URL = "http://127.0.0.1:${port}/mock-api";`
      ));
    }
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(content);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error?.code === "ENOENT" ? "Not found" : String(error?.message || error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`UGS UI harness: http://127.0.0.1:${port}`);
});
