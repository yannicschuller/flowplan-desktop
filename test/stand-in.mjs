// A small stand-in for a Flowplan instance: just the endpoints the app asks
// itself (health, bootstrap, capture targets, the capture command, quick
// capture's targets, preview, save, undo, link preview, transcription and
// AI suggestion – with Idempotency-Key like lib/idempotency.ts –, tasks,
// upload and the two imports, notifications) and a page with what the
// right-click menu and the bridge need (an editor that keeps its own menu, a
// field, links, an image). It records every request with its Origin header
// and cookie. Used by test/features.mjs (Node's fetch) and test/app.mjs (the
// running app). No running Flowplan is needed.
import { createServer } from "node:http";
import crypto from "node:crypto";

export const WORKSPACE = "11111111-1111-4111-8111-111111111111";
export const SPACE = "22222222-2222-4222-8222-222222222222";
export const INBOX = "33333333-3333-4333-8333-333333333333";
export const PAGE = "44444444-4444-4444-8444-444444444444";
export const TASK_PAGE = "55555555-5555-4555-8555-555555555555";
export const USER = "66666666-6666-4666-8666-666666666666";
export const PROJECTS = "77777777-7777-4777-8777-777777777777";
export const JOURNAL = "88888888-8888-4888-8888-888888888888";
export const TEMPLATE = "99999999-9999-4999-8999-999999999999";
export const ANNA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// The shorthand as the instance reads it (lib/capture-parse.ts), enough for
// the tests: morgen/tomorrow (with "15 Uhr"), #kunde, @anna, !hoch.
function chipsOf(text, literal = []) {
  const found = [];
  const add = (kind, re, field, label) => {
    const m = re.exec(text);
    if (!m) return;
    const raw = m[0].trim();
    const id = `${kind}:${raw.toLowerCase()}`;
    if (literal.includes(id)) return;
    found.push({ id, kind, raw, start: m.index, end: m.index + m[0].length, label, field, applies: true });
  };
  add("date", /\b(morgen|tomorrow)( \d{1,2} Uhr)?/i, { id: "due", name: "Fällig" }, "2026-10-27T15:00");
  add("tag", /#kunde\b/i, { id: "tags", name: "Tags" }, "Kunde");
  add("person", /@anna\b/i, { id: "who", name: "Zuständig" }, "Anna Schmidt");
  add("priority", /!hoch\b/i, { id: "prio", name: "Priorität" }, "Hoch");
  const rest = found.reduce((acc, c) => acc.replace(c.raw, ""), text).replace(/\s+/g, " ").trim();
  return { chips: found.sort((a, b) => a.start - b.start), title: rest.split("\n")[0] };
}
// multipart fields (strings only) and file parts, enough for the tests.
function parseMultipart(body, contentType) {
  const boundary = /boundary=(.+)$/.exec(contentType || "")?.[1];
  const fields = {};
  const files = [];
  if (!boundary) return { fields, files };
  for (const part of body.toString("latin1").split(`--${boundary}`)) {
    const name = /name="([^"]+)"/.exec(part)?.[1];
    if (!name) continue;
    const value = part.slice(part.indexOf("\r\n\r\n") + 4, part.lastIndexOf("\r\n"));
    const filename = /filename="([^"]*)"/.exec(part)?.[1];
    if (filename !== undefined) files.push({ name: filename, type: /Content-Type: (\S+)/.exec(part)?.[1], size: value.length });
    else fields[name] = Buffer.from(value, "latin1").toString("utf8");
  }
  return { fields, files };
}

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
  // Quick capture: what was saved (once per Idempotency-Key), what was undone.
  const state = { status: {}, saved: [], undone: [], keys: new Map(), ...options };
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
        user: { id: USER, name: "Alex <Morgan>" },
        workspace: { id: WORKSPACE, name: "Team" },
        workspaces: [{ id: WORKSPACE, name: "Team", role: "owner", guest: 0 }],
        spaces: [{ id: SPACE, name: "General", deleted_at: null }],
        pages: [{ id: INBOX, space_id: SPACE, kind: "database", title: "Eingang" }],
      });
    if (url.pathname === "/api/capture") return json(200, state.capture || { databases: [{ id: INBOX, title: "Eingang", space: "General" }], default: INBOX });
    // An older instance has none of these.
    if (url.pathname.startsWith("/api/capture/") && state.legacy) return json(404, { error: "Nicht gefunden." });
    if (url.pathname === "/api/capture/targets")
      return json(200, {
        inbox: { id: INBOX, name: "Eingang", kind: "database" },
        targets: [
          { id: INBOX, kind: "database", name: "Eingang", space: "General", workspace: "Team", fills: { date: "Fällig", tags: true, person: "Zuständig" }, templates: [{ id: TEMPLATE, name: "Besprechung", default: false }] },
          { id: PROJECTS, kind: "database", name: "Projekte", space: "General", workspace: "Team", fills: { date: null, tags: false, person: null }, templates: [] },
          { id: PAGE, kind: "document", name: "Notizen", space: "General", workspace: "Team" },
          { id: JOURNAL, kind: "journal", name: "Tagebuch", space: "General", workspace: "Team" },
        ],
        encryptedExcluded: 2,
        voice: true,
        suggest: { server: true, device: false, prefer: "server" },
        maxFiles: 10,
        maxUploadMb: 50,
      });
    if (url.pathname === "/api/capture/preview") {
      const input = JSON.parse(body.toString("utf8") || "{}");
      return json(200, { target: { id: input.targetId }, text: "", ...chipsOf(String(input.text || ""), input.literal || []) });
    }
    if (url.pathname === "/api/capture/save") {
      const key = req.headers["idempotency-key"];
      // A retry with the same key: the stored answer (lib/idempotency.ts).
      if (key && state.keys.has(key)) {
        res.writeHead(200, { "Content-Type": "application/json", "Idempotent-Replayed": "true" });
        return res.end(state.keys.get(key));
      }
      const multipart = String(req.headers["content-type"] || "").startsWith("multipart/form-data");
      const input = multipart ? parseMultipart(body, req.headers["content-type"]) : { fields: JSON.parse(body.toString("utf8") || "{}"), files: [] };
      const rowId = crypto.randomUUID();
      const targetId = input.fields.targetId === "inbox" || !input.fields.targetId ? INBOX : input.fields.targetId;
      const parsed = chipsOf(String(input.fields.text || ""), typeof input.fields.literal === "string" ? JSON.parse(input.fields.literal) : input.fields.literal || []);
      const record = targetId === INBOX || targetId === PROJECTS;
      const answer = JSON.stringify({
        ok: true,
        kind: record ? "record" : "append",
        pageId: targetId,
        ...(record ? { rowId } : { undo: { blocks: 1, digest: "0123456789abcdef0123456789abcdef" } }),
        url: `/#page=${targetId}`,
        title: parsed.title || input.fields.linkTitle || "Notiz",
        target: { [INBOX]: "Eingang", [PROJECTS]: "Projekte", [PAGE]: "Notizen", [JOURNAL]: "Tagebuch" }[targetId] || "Eingang",
        files: input.files.map((f) => f.name),
      });
      state.saved.push({ key, fields: input.fields, files: input.files, rowId, chips: parsed.chips });
      if (key) state.keys.set(key, answer);
      // The answer gets lost on the way (once): the app must retry with the same key.
      if (state.loseAnswer) {
        state.loseAnswer = false;
        return req.socket.destroy();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(answer);
    }
    if (url.pathname === "/api/capture/undo") {
      state.undone.push(JSON.parse(body.toString("utf8") || "{}"));
      return json(200, { undone: true });
    }
    if (url.pathname === "/api/embed") {
      const target = url.searchParams.get("url") || "";
      return json(200, { kind: "card", url: target, title: "Ein guter Artikel", provider: "Example News", description: "Worum es geht", image: "" });
    }
    if (url.pathname === "/api/transcribe") return json(200, { text: "Diktierter Gedanke", segments: [], speakers: false });
    if (url.pathname === "/api/ai/capture/suggest")
      return json(200, { suggestion: { targetId: PROJECTS, targetName: "Projekte", title: "Angebot für Kunde schreiben", fields: [] } });
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
  await new Promise((done) => server.listen(options.port || 0, "127.0.0.1", done));
  const port = server.address().port;
  origin = `http://localhost:${port}`;
  return {
    origin,
    requests,
    state,
    // The requests to one path.
    to: (path) => requests.filter((r) => r.path === path || (path instanceof RegExp && path.test(r.path))),
    stop: () => new Promise((closed) => (server.close(closed), server.closeAllConnections())),
    // Back on the same port (the instance was unreachable for a while).
    start: () => new Promise((done) => server.listen(port, "127.0.0.1", done)),
  };
}
