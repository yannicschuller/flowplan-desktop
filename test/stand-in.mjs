// A small stand-in for a Flowplan instance: just the endpoints the app asks
// itself (health, bootstrap, capture targets, the capture command, tasks,
// upload and the two imports, notifications) and a page with what the
// right-click menu and the bridge need (an editor that keeps its own menu, a
// field, links, an image). It records every request with its Origin header
// and cookie. Used by test/features.mjs (Node's fetch) and test/app.mjs (the
// running app). No running Flowplan is needed.
import { createServer } from "node:http";

export const WORKSPACE = "11111111-1111-4111-8111-111111111111";
export const SPACE = "22222222-2222-4222-8222-222222222222";
export const INBOX = "33333333-3333-4333-8333-333333333333";
export const PAGE = "44444444-4444-4444-8444-444444444444";
export const TASK_PAGE = "55555555-5555-4555-8555-555555555555";

// A 1×1 PNG.
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const page = (origin) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Stand-in</title>
<style>body{font:16px sans-serif;margin:20px} #editor{border:1px solid #ccc;padding:8px;min-height:60px} #plain{margin:12px 0;padding:8px;background:#f4f4f4}
@media print { .no-print { display:none } }</style></head>
<body>
<h1 id="title">Stand-in instance</h1>
<div id="editor" contenteditable="true" spellcheck="true">Flowplans editor keeps its own menu</div>
<input id="field" value="Ein Feld mit Text" spellcheck="true" style="width:300px">
<p id="plain">Plain text to select</p>
<p><a id="own" href="${origin}/#page=${PAGE}">A page of this instance</a> · <a id="other" href="https://example.org/">another site</a> · <a id="mail" href="mailto:someone@example.org">mail</a></p>
<img id="image" src="/image.png" width="80" height="80" alt="">
<p class="no-print">Not printed</p>
<script>
  // Like components/text-menu.tsx: the editor shows its own menu.
  document.addEventListener("contextmenu", (e) => {
    if (e.target.closest("#editor") && !e.shiftKey) { e.preventDefault(); window.webMenu = (window.webMenu || 0) + 1; }
  });
</script>
</body></html>`;

// options.today: the day tasks are due; options.capture: the answer of
// GET /api/capture; options.status: path → forced status.
export async function standIn(options = {}) {
  const requests = [];
  const state = { status: {}, ...options };
  let origin = "";
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body };
    requests.push(entry);
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const forced = state.status[url.pathname];
    if (forced) return json(forced, { error: `forced ${forced}` });
    if (url.pathname === "/api/health") return json(200, { service: "flowplan" });
    if (url.pathname === "/set") {
      res.setHeader("Set-Cookie", "sid=stand-in; Path=/; HttpOnly");
      return res.end("ok");
    }
    if (url.pathname === "/image.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(PNG);
    }
    if (url.pathname.startsWith("/api/")) {
      // Changes need the instance's own origin (lib/auth.ts checkOrigin).
      if (req.method !== "GET" && req.headers.origin !== origin) return json(403, { error: "Ungültiger Anfrageursprung." });
      if (state.signedOut) return json(401, { error: "Bitte melde dich an." });
    }
    if (url.pathname === "/api/bootstrap")
      return json(200, {
        workspace: { id: WORKSPACE, name: "Team" },
        workspaces: [{ id: WORKSPACE, name: "Team", role: "owner", guest: 0 }],
        spaces: [{ id: SPACE, name: "General", deleted_at: null }],
        pages: [{ id: INBOX, space_id: SPACE, kind: "database", title: "Eingang" }],
      });
    if (url.pathname === "/api/capture") return json(200, state.capture || { databases: [{ id: INBOX, title: "Eingang", space: "General" }], default: INBOX });
    if (url.pathname === "/api/command") {
      const command = JSON.parse(body.toString("utf8") || "{}");
      if (command.action !== "capture.record") return json(400, { error: "Unbekannt" });
      return json(200, { id: command.pageId, rowId: command.rowId });
    }
    if (url.pathname === "/api/tasks") {
      const today = state.today || new Date().toISOString().slice(0, 10);
      return json(200, {
        tasks: [
          { pageId: TASK_PAGE, rowId: null, index: 0, text: "Angebot schicken", checked: false, due: today, title: "Projekt" },
          { pageId: TASK_PAGE, rowId: null, index: 1, text: "Später", checked: false, due: "2999-01-01", title: "Projekt" },
          { pageId: TASK_PAGE, rowId: null, index: 2, text: "Ohne Datum", checked: false, due: null, title: "Projekt" },
        ],
        others: [{ workspaceId: "x", name: "Other", tasks: [{ pageId: PAGE, rowId: null, index: 0, text: "Überfällig", checked: false, due: "2020-01-01", title: "Alt" }] }],
      });
    }
    if (url.pathname === "/api/upload") {
      // Multipart must state its size before anything is read.
      if (!req.headers["content-length"]) return json(411, { error: "Länge fehlt" });
      return json(200, { id: "f1", url: "/api/files/f1", name: "bild.png", mime: "image/png" });
    }
    if (/^\/api\/pages\/[^/]+\/import-markdown$/.test(url.pathname)) return json(200, { created: 1 });
    if (url.pathname === "/api/import/source") return json(200, { rootIds: [PAGE], pages: 1 });
    if (url.pathname === "/api/notifications") return json(200, { notifications: [], unread: 2 });
    if (url.pathname.startsWith("/api/")) return json(404, { error: "Nicht gefunden." });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(origin));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://localhost:${server.address().port}`;
  return {
    origin,
    requests,
    state,
    // The requests to one path.
    to: (path) => requests.filter((r) => r.path === path || (path instanceof RegExp && path.test(r.path))),
    stop: () => new Promise((closed) => (server.close(closed), server.closeAllConnections())),
  };
}
