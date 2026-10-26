// What the app asks the instance of a profile itself – with that profile's
// own session (its cookies; nothing new is stored on the server) and only
// at fixed addresses of its own origin. The endpoints are the web app's own:
//
//   GET  /api/bootstrap            the person's workspaces and spaces
//   GET  /api/capture?workspace=…  the databases to capture into and the default (the inbox)
//   POST /api/command              capture.record – quick capture, as in the web app
//   GET  /api/tasks?workspace=…    "My tasks" – today's for the tray
//   POST /api/upload               an image or PDF for the inbox record
//   POST /api/pages/<id>/import-markdown   Markdown or text files as inbox records
//   POST /api/import/source        files as new pages (a one-note Obsidian vault)
//
// fetch is passed in (session.fetch in the app, a stand-in in
// test/features.mjs), so this file runs with Node alone. Answers are
// checked: redirects are refused, and only the fields used are read.
const { randomUUID } = require("node:crypto");

const TIMEOUT = 20_000;
const UPLOAD_TIMEOUT = 120_000;
const MAX_TEXT = 20_000;
const MAX_TITLE = 300;
const MAX_WORKSPACES = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What went wrong, for a message the person understands:
//   offline     – no connection (or the server is down)
//   signed-out  – the profile is not signed in (401/403)
//   too-large   – 413
//   rejected    – the instance said no (4xx, with its message)
//   server      – 5xx, a redirect elsewhere or an answer that is no JSON
class ApiError extends Error {
  constructor(kind, status = 0, detail = "") {
    super(detail || kind);
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}
function kindOf(status) {
  if (status === 401 || status === 403) return "signed-out";
  if (status === 413) return "too-large";
  if (status >= 400 && status < 500) return "rejected";
  return "server";
}
const text = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const isId = (value) => typeof value === "string" && UUID.test(value);

// The local date as YYYY-MM-DD (due dates in Flowplan are days).
function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const esc = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paragraphsHtml = (value) =>
  value
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

// Quick capture as the web app's command: the first line is the title, the
// rest the text. As a task, the first line becomes an open task due today,
// assigned to the person capturing (a mention, as the editor writes it), so
// it shows under "My tasks" and in the tray, with the rest below it.
function captureCommand({ text: raw = "", task = false } = {}, { pageId, rowId = randomUUID(), today = localDay(), user = null } = {}) {
  const value = String(raw).replace(/\r\n?/g, "\n").trim();
  if (!value) throw new ApiError("empty");
  if (value.length > MAX_TEXT) throw new ApiError("too-long");
  if (!isId(pageId) || !isId(rowId)) throw new ApiError("no-inbox");
  const [first, ...more] = value.split("\n");
  const title = first.trim().slice(0, MAX_TITLE) || value.slice(0, MAX_TITLE);
  const rest = more.join("\n").trim();
  const command = { action: "capture.record", pageId, rowId, title };
  if (task) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new ApiError("empty");
    const mention = user && isId(user.id) ? ` <span data-mention="${user.id}" class="mention">@${esc(text(user.name, 80) || "…")}</span>` : "";
    command.article = `<ul data-type="taskList"><li data-type="taskItem" data-checked="false" data-due="${today}"><p>${esc(title)}${mention}</p></li></ul>${paragraphsHtml(rest)}`;
  } else if (rest) command.text = rest;
  return command;
}

// Today's open tasks of "My tasks" (all workspaces: the answer for one
// lists the others too): due today or earlier, the oldest first.
function todayTasks(data, today = localDay(), max = 8) {
  const lists = [];
  if (data && Array.isArray(data.tasks)) lists.push(data.tasks);
  if (data && Array.isArray(data.others)) for (const w of data.others) if (w && Array.isArray(w.tasks)) lists.push(w.tasks);
  const seen = new Set();
  const result = [];
  for (const list of lists)
    for (const task of list) {
      if (!task || task.checked === true || !isId(task.pageId)) continue;
      const due = typeof task.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.due) ? task.due : null;
      if (!due || due > today) continue;
      const rowId = isId(task.rowId) ? task.rowId : null;
      const key = `${task.pageId}:${rowId}:${task.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ text: text(task.text, 120) || "…", page: text(task.title, 60), pageId: task.pageId, rowId, due, overdue: due < today });
    }
  result.sort((a, b) => (a.due === b.due ? 0 : a.due < b.due ? -1 : 1));
  return { tasks: result.slice(0, max), more: Math.max(0, result.length - max) };
}

// The address of a page of the instance (#page=…&row=…).
function pageAddress(origin, pageId, rowId) {
  if (!isId(pageId)) return new URL("/", origin).href;
  const params = new URLSearchParams({ page: pageId });
  if (isId(rowId)) params.set("row", rowId);
  return `${new URL("/", origin).href}#${params}`;
}

// multipart/form-data built by hand: the body has a known length, which
// the instance asks for before it reads anything (lib/upload-safety.ts).
function multipart(fields = {}, files = []) {
  const boundary = `----flowplan${randomUUID().replace(/-/g, "")}`;
  const parts = [];
  const quote = (v) => String(v).replace(/["\r\n\\]/g, "_");
  for (const [name, value] of Object.entries(fields))
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`));
  for (const file of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(file.field || "file")}"; filename="${quote(file.name)}"\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`));
    parts.push(Buffer.from(file.bytes));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// A ZIP without compression (STORE) – enough to hand one note and its file
// to the instance's Obsidian import, which turns Markdown into a real page.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt32LE(0, 10); // time, date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function createInstanceApi({ origin, fetch }) {
  if (!origin) throw new ApiError("no-profile");
  async function request(path, { method = "GET", json, body, contentType, timeout = TIMEOUT } = {}) {
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new ApiError("server");
    const headers = { Accept: "application/json" };
    // The instance checks the origin of every change (lib/auth.ts checkOrigin).
    if (method !== "GET") headers.Origin = origin;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (contentType) headers["Content-Type"] = contentType;
    let response;
    try {
      response = await fetch(url.href, { method, headers, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      throw new ApiError("offline", 0, String(e?.cause?.code || e?.code || e?.name || "network"));
    }
    if (response.url && new URL(response.url).origin !== origin) throw new ApiError("server", response.status);
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(kindOf(response.status), response.status, text(data?.error, 300));
    if (data === null) throw new ApiError("server", response.status);
    return data;
  }

  // The person's workspaces (the first is the one the web app starts with)
  // and, per workspace, its spaces and databases' spaces – asked once.
  const boots = new Map();
  async function bootstrap(workspaceId) {
    const key = workspaceId || "";
    if (!boots.has(key))
      boots.set(
        key,
        request(`/api/bootstrap${workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ""}`).then((data) => ({
          workspace: isId(data?.workspace?.id) ? data.workspace.id : null,
          user: isId(data?.user?.id) ? { id: data.user.id, name: text(data.user.name, 80) } : null,
          workspaces: (Array.isArray(data?.workspaces) ? data.workspaces : [])
            .filter((w) => w && isId(w.id) && w.role !== "viewer" && !w.guest)
            .slice(0, MAX_WORKSPACES)
            .map((w) => ({ id: w.id, name: text(w.name, 80) })),
          spaces: (Array.isArray(data?.spaces) ? data.spaces : []).filter((s) => s && isId(s.id) && !s.deleted_at).map((s) => s.id),
          pageSpaces: new Map((Array.isArray(data?.pages) ? data.pages : []).filter((p) => p && isId(p.id) && isId(p.space_id)).map((p) => [p.id, p.space_id])),
        })),
      );
    try {
      return await boots.get(key);
    } catch (e) {
      boots.delete(key);
      throw e;
    }
  }

  // The inbox: the default capture database of the first workspace that has
  // one, otherwise the first database of the first workspace (like the web
  // app's quick capture).
  async function inbox() {
    const boot = await bootstrap();
    const order = [boot.workspace, ...boot.workspaces.map((w) => w.id)].filter((id, i, all) => id && all.indexOf(id) === i);
    let fallback = null;
    for (const workspaceId of order) {
      const data = await request(`/api/capture?workspace=${encodeURIComponent(workspaceId)}`);
      const databases = (Array.isArray(data?.databases) ? data.databases : []).filter((d) => d && isId(d.id));
      const chosen = databases.find((d) => d.id === data.default);
      if (chosen) return { workspaceId, pageId: chosen.id, title: text(chosen.title, 80) };
      if (!fallback && databases[0]) fallback = { workspaceId, pageId: databases[0].id, title: text(databases[0].title, 80) };
    }
    if (fallback) return fallback;
    throw new ApiError("no-inbox");
  }

  return {
    request,
    bootstrap,
    inbox,
    // Quick capture into the inbox; answers with the new record's address.
    async capture(input, today = localDay()) {
      const target = await inbox();
      const { user } = await bootstrap();
      const command = captureCommand(input, { pageId: target.pageId, today, user });
      const result = await request("/api/command", { method: "POST", json: command });
      const rowId = isId(result?.rowId) ? result.rowId : command.rowId;
      return { ...target, rowId, url: pageAddress(origin, target.pageId, rowId) };
    },
    async todayTasks(today = localDay()) {
      const boot = await bootstrap();
      if (!boot.workspace) return { tasks: [], more: 0 };
      return todayTasks(await request(`/api/tasks?workspace=${encodeURIComponent(boot.workspace)}`), today);
    },
    // An image or PDF, stored with the inbox database.
    async upload(pageId, file) {
      if (!isId(pageId)) throw new ApiError("no-inbox");
      const { body, contentType } = multipart({ pageId }, [file]);
      const data = await request("/api/upload", { method: "POST", body, contentType, timeout: UPLOAD_TIMEOUT });
      if (typeof data.url !== "string" || !/^\/api\/files\/[A-Za-z0-9-]+$/.test(data.url)) throw new ApiError("server");
      return { url: data.url, name: text(data.name, 200) || file.name, mime: text(data.mime, 100) };
    },
    // One inbox record per uploaded file (the file shown in its text).
    async recordWithFile(pageId, title, file) {
      const media = file.mime === "application/pdf" ? `<div data-pdf="${esc(file.url)}" data-title="${esc(file.name)}"></div>` : `<p><img src="${esc(file.url)}" alt="${esc(file.name)}"></p>`;
      const rowId = randomUUID();
      const result = await request("/api/command", { method: "POST", json: { action: "capture.record", pageId, rowId, title: String(title).slice(0, MAX_TITLE), article: media } });
      return isId(result?.rowId) ? result.rowId : rowId;
    },
    // Markdown and text files as records of the inbox database.
    async importRecords(pageId, files) {
      if (!isId(pageId)) throw new ApiError("no-inbox");
      const { body, contentType } = multipart({}, files);
      const data = await request(`/api/pages/${pageId}/import-markdown`, { method: "POST", body, contentType, timeout: UPLOAD_TIMEOUT });
      return { created: Number.isInteger(data.created) ? data.created : files.length };
    },
    // Files as new pages: the instance's Obsidian import of a small vault.
    async importPages(workspaceId, spaceId, vault) {
      if (!isId(workspaceId) || !isId(spaceId)) throw new ApiError("no-inbox");
      const { body, contentType } = multipart({ workspaceId, spaceId, source: "obsidian", mode: "pages" }, [{ name: "flowplan-desktop.zip", type: "application/zip", bytes: vault }]);
      const data = await request("/api/import/source", { method: "POST", body, contentType, timeout: UPLOAD_TIMEOUT });
      return { rootIds: (Array.isArray(data.rootIds) ? data.rootIds : []).filter(isId) };
    },
  };
}

module.exports = { ApiError, MAX_TEXT, localDay, captureCommand, todayTasks, pageAddress, multipart, zipStore, crc32, createInstanceApi };
