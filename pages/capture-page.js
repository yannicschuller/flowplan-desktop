// Quick capture (capture.js): Enter saves, Shift+Enter starts a new line,
// Esc closes – the text stays until it is saved, also when the window is
// put away or saving fails. Tab (or Alt+↑/↓) picks where it goes; the
// shorthand shows as chips under the text, each removable; Mod+Shift+V
// pastes (a link gets its title); files can be dropped, a screen region
// taken, a voice note held to talk; an AI suggestion is offered as chips
// to accept. After saving: "Öffnen" and "Rückgängig" for ten seconds; ↓ in
// the empty field shows "Zuletzt erfasst".
const { t } = window.flowplanStrings;
const desktop = window.flowplanDesktop;
const $ = (id) => document.getElementById(id);
const text = $("text"),
  task = $("task"),
  status = $("status"),
  targetButton = $("target"),
  targetName = $("target-name"),
  picker = $("picker"),
  pickerSearch = $("picker-search"),
  pickerList = $("picker-list"),
  pickerNote = $("picker-note"),
  chipsList = $("chips"),
  attachmentsList = $("attachments"),
  suggestion = $("suggestion"),
  toast = $("toast"),
  recent = $("recent"),
  recentList = $("recent-list"),
  queueBadge = $("queue"),
  attention = $("attention"),
  actionLabel = $("action");
const mac = new URLSearchParams(location.search).get("platform") === "darwin";
const mod = (event) => (mac ? event.metaKey : event.ctrlKey);
const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
pickerList.setAttribute("aria-label", t("capture.targetLabel"));
recentList.setAttribute("aria-label", t("capture.recent"));
$("paste").title = t("capture.pasteTitle", mac ? "⇧⌘V" : "Ctrl+Shift+V");
$("screen").title = t("capture.screenTitle");
$("voice").title = t("capture.voiceTitle", mac ? "⇧⌘R" : "Ctrl+Shift+R");
$("suggest").title = t("capture.suggestTitle");

let info = { targets: [] };
let targetId = "inbox";
let literal = new Set();
let chips = [];
let link = null;
let attachments = [];
let accepted = {};
let templateId = null;
let saving = false;
let lastEntry = null;
let toastTimer = null;
let previewTimer = null;
let previewSeq = 0;
let active = 0;

function say(message, kind = "", button = null) {
  status.replaceChildren(document.createTextNode(message));
  status.className = `capture-status ${kind}`;
  if (button) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "link";
    b.textContent = button.label;
    b.addEventListener("click", button.run);
    status.append(" ", b);
  }
}
const button = (label, run, className = "secondary") => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", run);
  return b;
};

// ---- Target ----
const currentTarget = () => info.targets.find((x) => x.id === targetId) || info.targets[0] || { id: "inbox", kind: "inbox", name: "" };
function targetText(x) {
  if (!x) return "";
  if (x.kind === "inbox") return `${t("capture.kind.inbox")}${x.name ? ` · ${x.name}` : ""}`;
  return x.name;
}
function renderTarget() {
  const x = currentTarget();
  targetName.textContent = `${targetText(x)}${info.profile ? ` – ${info.profile}` : ""}`;
  targetButton.title = `${t(`capture.kind.${x.kind}`)}${info.host ? ` · ${info.host}` : ""}`;
  // A task needs somewhere to be due: pages and the journal get a task item.
  task.disabled = false;
}
function setTarget(id) {
  if (!info.targets.some((x) => x.id === id)) return;
  targetId = id;
  renderTarget();
  schedulePreview();
}
function filtered() {
  const words = pickerSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
  return info.targets.filter((x) => words.every((w) => `${targetText(x)} ${x.space || ""} ${x.workspace || ""}`.toLowerCase().includes(w)));
}
function renderPicker() {
  const list = filtered();
  active = Math.min(active, Math.max(0, list.length - 1));
  pickerList.replaceChildren(
    ...list.map((x, index) => {
      const li = document.createElement("li");
      li.role = "option";
      li.id = `target-${index}`;
      li.dataset.id = x.id;
      li.className = `capture-option${index === active ? " active" : ""}`;
      li.setAttribute("aria-selected", String(x.id === targetId));
      const name = document.createElement("span");
      name.textContent = targetText(x);
      const kind = document.createElement("small");
      kind.textContent = [t(`capture.kind.${x.kind}`), x.space, x.recent ? t("capture.recentTarget") : ""].filter(Boolean).join(" · ");
      li.append(name, kind);
      li.addEventListener("mousedown", (event) => {
        event.preventDefault();
        choose(x.id);
      });
      return li;
    }),
  );
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "capture-option empty";
    li.textContent = t("capture.noTargets");
    pickerList.append(li);
  }
  pickerSearch.setAttribute("aria-activedescendant", list.length ? `target-${active}` : "");
  pickerNote.hidden = !info.encryptedExcluded;
  pickerNote.textContent = info.encryptedExcluded ? t("capture.encryptedNote", info.encryptedExcluded) : "";
  pickerList.querySelector(".active")?.scrollIntoView({ block: "nearest" });
}
function openPicker() {
  closeRecent();
  picker.hidden = false;
  targetButton.setAttribute("aria-expanded", "true");
  pickerSearch.value = "";
  active = Math.max(0, filtered().findIndex((x) => x.id === targetId));
  renderPicker();
  pickerSearch.focus();
}
function closePicker(focusText = true) {
  picker.hidden = true;
  targetButton.setAttribute("aria-expanded", "false");
  if (focusText) text.focus();
}
function choose(id) {
  setTarget(id);
  closePicker();
}
targetButton.addEventListener("click", () => (picker.hidden ? openPicker() : closePicker()));
pickerSearch.addEventListener("input", () => {
  active = 0;
  renderPicker();
});
pickerSearch.addEventListener("keydown", (event) => {
  const list = filtered();
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    active = (active + (event.key === "ArrowDown" ? 1 : -1) + list.length) % Math.max(1, list.length);
    renderPicker();
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (list[active]) choose(list[active].id);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closePicker();
  } else if (event.key === "Tab") {
    event.preventDefault();
    if (list[active]) choose(list[active].id);
  }
});
function cycleTarget(step) {
  const index = info.targets.findIndex((x) => x.id === targetId);
  const next = info.targets[(index + step + info.targets.length) % info.targets.length];
  if (next) setTarget(next.id);
}

// ---- Chips ----
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(preview, 250);
}
async function preview() {
  const seq = ++previewSeq;
  if (!text.value.trim()) {
    chips = [];
    return renderChips();
  }
  let result = null;
  try {
    result = await desktop.capture.preview({ text: text.value, targetId, literal: [...literal], task: task.checked });
  } catch {}
  if (seq !== previewSeq) return;
  chips = result ? result.chips : null;
  renderChips();
}
// "2026-10-27T15:00" → "Di., 27. Okt., 15:00" in the window's language.
function dayLabel(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(value));
  if (!m) return value;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
  const lang = document.documentElement.lang;
  const day = date.toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
  return m[4] ? `${day}, ${date.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })}` : day;
}
function renderChips() {
  if (chips === null) {
    // Offline: the instance reads the shorthand when the capture is sent.
    const shorthand = /(^|\s)[#@!]\S/.test(text.value);
    chipsList.replaceChildren(...(shorthand ? [Object.assign(document.createElement("li"), { className: "capture-chip muted", textContent: t("capture.shorthandOffline") })] : []));
    return;
  }
  chipsList.replaceChildren(
    ...chips.map((chip) => {
      const li = document.createElement("li");
      li.className = `capture-chip ${chip.applies ? "" : "muted"} kind-${chip.kind}`;
      li.dataset.id = chip.id;
      const label = document.createElement("span");
      const value = chip.kind === "date" ? dayLabel(chip.label) : chip.label;
      label.textContent = chip.applies ? (chip.field?.id === "task" ? `${t("capture.chipTask")}: ${value}` : `${chip.field.name}: ${value}`) : `${chip.raw} · ${t("capture.chipText")}`;
      label.title = chip.raw;
      li.append(label);
      if (chip.applies) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "chip-remove";
        remove.textContent = "×";
        remove.title = t("capture.chipKeep");
        remove.setAttribute("aria-label", `${t("capture.chipKeep")}: ${chip.raw}`);
        remove.addEventListener("click", () => {
          literal.add(chip.id);
          void preview();
          text.focus();
        });
        li.append(remove);
      }
      return li;
    }),
  );
}

// ---- Attachments and the link ----
function renderAttachments() {
  const items = [];
  if (link) {
    const li = document.createElement("li");
    li.className = "capture-attachment link";
    const label = document.createElement("span");
    label.textContent = `🔗 ${link.title || link.url}${link.provider ? ` – ${link.provider}` : ""}`;
    label.title = [link.url, link.description].filter(Boolean).join("\n");
    li.append(label, button("×", () => ((link = null), renderAttachments()), "chip-remove"));
    items.push(li);
  }
  for (const a of attachments) {
    const li = document.createElement("li");
    li.className = "capture-attachment";
    li.dataset.id = a.id;
    const icon = a.kind === "audio" ? "🎤" : a.kind === "pdf" ? "📄" : a.kind === "image" ? "🖼" : "📝";
    const label = document.createElement("span");
    label.textContent = `${icon} ${a.name} (${Math.max(1, Math.round(a.size / 1024))} KB)`;
    const remove = button(
      "×",
      async () => {
        attachments = attachments.filter((x) => x.id !== a.id);
        await desktop.capture.removeAttachment(a.id).catch(() => {});
        renderAttachments();
      },
      "chip-remove",
    );
    remove.title = t("capture.remove");
    remove.setAttribute("aria-label", `${t("capture.remove")}: ${a.name}`);
    li.append(label, remove);
    items.push(li);
  }
  attachmentsList.replaceChildren(...items);
}
function insertText(value) {
  const start = text.selectionStart,
    end = text.selectionEnd;
  text.setRangeText(value, start, end, "end");
  text.dispatchEvent(new Event("input"));
}
async function paste() {
  try {
    const clip = await desktop.capture.clipboard();
    if (clip.link) {
      link = clip.link;
      renderAttachments();
    } else if (clip.text) insertText(clip.text);
    else say(t("capture.clipboardEmpty"));
  } catch (e) {
    say(clean(e), "error");
  }
  text.focus();
}
$("paste").addEventListener("click", paste);
$("attach").title = t("capture.attachTitle");
$("attach").addEventListener("click", async () => {
  const result = await desktop.capture.pickFiles().catch((e) => ({ added: [], refused: [{ name: "", reason: clean(e) }] }));
  attachments.push(...result.added);
  renderAttachments();
  if (result.refused.length) say(result.refused.map((r) => t("capture.refused", r.name, r.reason)).join(" · "), "error");
  text.focus();
});
$("screen").addEventListener("click", async () => {
  say("");
  const result = await desktop.capture.screen().catch((e) => ({ error: clean(e) }));
  if (result.added) {
    attachments.push(result.added);
    renderAttachments();
  } else if (result.error) say(result.error, "error", result.permission ? { label: t("capture.openSystemSettings"), run: () => desktop.capture.openSettings("screen") } : null);
  text.focus();
});
// Files from the disk, dropped on the window (real drops only).
const editor = $("editor");
editor.addEventListener("dragover", (event) => {
  if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
  event.preventDefault();
  $("drop").hidden = false;
});
editor.addEventListener("dragleave", () => ($("drop").hidden = true));
editor.addEventListener("drop", async (event) => {
  $("drop").hidden = true;
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  if (!event.isTrusted) return;
  const result = await desktop.capture.dropFiles(event.dataTransfer.files).catch((e) => ({ added: [], refused: [{ name: "", reason: clean(e) }] }));
  attachments.push(...result.added);
  renderAttachments();
  if (result.refused.length) say(result.refused.map((r) => t("capture.refused", r.name, r.reason)).join(" · "), "error");
});

// ---- Voice note: hold to talk ----
let recorder = null;
async function startRecording() {
  if (recorder) return;
  say("");
  const access = await desktop.capture.microphone().catch(() => ({ granted: false }));
  if (!access.granted) return say(t("capture.micDenied"), "error", mac ? { label: t("capture.openSystemSettings"), run: () => desktop.capture.openSettings("microphone") } : null);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return say(t("capture.micUnavailable"), "error");
  }
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((x) => MediaRecorder.isTypeSupported(x)) || "";
  const parts = [];
  const current = new MediaRecorder(stream, type ? { mimeType: type } : {});
  recorder = current;
  current.ondataavailable = (event) => event.data.size && parts.push(event.data);
  current.onstop = async () => {
    stream.getTracks().forEach((track) => track.stop());
    $("voice").classList.remove("recording");
    recorder = null;
    const blob = new Blob(parts, { type: current.mimeType || type || "audio/webm" });
    if (blob.size < 200) return say("");
    say(t("capture.voiceWorking"));
    try {
      const result = await desktop.capture.audio(new Uint8Array(await blob.arrayBuffer()), blob.type, targetId);
      if (result.transcript) {
        insertText(`${text.value && !/\s$/.test(text.value) ? " " : ""}${result.transcript}`);
        say(t("capture.voiceTranscribed"), "ok");
      } else if (result.added) {
        attachments.push(result.added);
        renderAttachments();
        say(t("capture.voiceAttached"));
      }
    } catch (e) {
      say(clean(e) || t("capture.voiceFailed"), "error");
    }
    text.focus();
  };
  current.start(250);
  $("voice").classList.add("recording");
  say(t("capture.voiceRecording"));
  if (released && !keyHeld) stopRecording();
}
function stopRecording() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
}
// The pointer is captured: the layout may shift under it while recording.
$("voice").addEventListener("pointerdown", (event) => {
  event.preventDefault();
  $("voice").setPointerCapture(event.pointerId);
  void startRecording();
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) $("voice").addEventListener(name, stopRecording);
// Released before the microphone was ready: stop right after it starts.
let released = false;
$("voice").addEventListener("pointerdown", () => (released = false));
$("voice").addEventListener("pointerup", () => (released = true));

// ---- AI suggestion: chips to accept, never applied by themselves ----
function renderSuggestion(s) {
  if (!s) {
    suggestion.hidden = true;
    return suggestion.replaceChildren();
  }
  const items = [];
  const chip = (label, accept) => {
    const span = document.createElement("span");
    span.className = "capture-chip suggest";
    const l = document.createElement("span");
    l.textContent = label;
    const yes = button("✓", () => {
      accept();
      span.remove();
      if (!suggestion.querySelector(".suggest")) renderSuggestion(null);
    }, "chip-accept");
    yes.title = t("capture.suggestAccept");
    yes.setAttribute("aria-label", `${t("capture.suggestAccept")}: ${label}`);
    const no = button("×", () => {
      span.remove();
      if (!suggestion.querySelector(".suggest")) renderSuggestion(null);
    }, "chip-remove");
    no.title = t("capture.suggestIgnore");
    no.setAttribute("aria-label", `${t("capture.suggestIgnore")}: ${label}`);
    span.append(l, yes, no);
    items.push(span);
  };
  if (s.targetId && s.targetId !== targetId && info.targets.some((x) => x.id === s.targetId)) chip(t("capture.suggestTarget", s.targetName), () => setTarget(s.targetId));
  const firstLine = text.value.split("\n")[0].trim();
  if (s.title && s.title !== firstLine)
    chip(t("capture.suggestTitleChip", s.title), () => {
      const [, ...rest] = text.value.split("\n");
      text.value = [s.title, ...rest].join("\n");
      schedulePreview();
    });
  for (const f of s.fields || []) chip(`${f.name}: ${f.label}`, () => (accepted[f.id] = f.value));
  if (!items.length) {
    say(t("capture.suggestNothing"));
    return renderSuggestion(null);
  }
  const head = document.createElement("strong");
  head.textContent = `${t("capture.suggestHeading")} (${t(s.source === "device" ? "capture.suggestDevice" : "capture.suggestServer")})`;
  suggestion.replaceChildren(head, ...items);
  suggestion.hidden = false;
}
$("suggest").addEventListener("click", async () => {
  say(t("capture.suggestWorking"));
  try {
    const s = await desktop.capture.suggest({ text: text.value });
    say("");
    renderSuggestion(s);
  } catch (e) {
    say(clean(e), "error");
  }
});

// ---- Saving, the toast, undo ----
function reset() {
  text.value = "";
  task.checked = false;
  literal = new Set();
  chips = [];
  link = null;
  attachments = [];
  accepted = {};
  templateId = null;
  actionLabel.hidden = true;
  renderChips();
  renderAttachments();
  renderSuggestion(null);
}
function showToast(message, entry) {
  lastEntry = entry;
  $("toast-text").textContent = message;
  $("toast-open").hidden = !entry?.open;
  $("toast-undo").hidden = !entry?.undo;
  toast.hidden = false;
  say("");
  clearTimeout(toastTimer);
  // Ten seconds for "Rückgängig"; then the window goes unless a new capture started.
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    lastEntry = null;
    if (!text.value.trim() && document.hasFocus()) void desktop.capture.close();
  }, 10_000);
}
async function save() {
  if (saving) return;
  if (!text.value.trim() && !link && !attachments.length) return say(t("capture.empty"), "error");
  saving = true;
  say(t("capture.saving"));
  try {
    const result = await desktop.capture.save({
      text: text.value,
      task: task.checked,
      targetId,
      literal: [...literal],
      link,
      attachments: attachments.map((a) => a.id),
      cells: accepted,
      templateId: templateId || undefined,
    });
    reset();
    showToast(result.message, result.entry);
    if (result.queued) toast.classList.add("queued");
    else toast.classList.remove("queued");
  } catch (e) {
    // The text stays: try again once the connection is back.
    say(clean(e), "error");
  } finally {
    saving = false;
  }
}
$("toast-undo").addEventListener("click", async () => {
  if (!lastEntry) return;
  try {
    const result = await desktop.capture.undo(lastEntry.id);
    toast.hidden = true;
    say(result.message, "ok");
  } catch (e) {
    say(clean(e), "error");
  }
});
$("toast-open").addEventListener("click", () => lastEntry && desktop.capture.open(lastEntry.id));

// ---- Recently captured, the queue ----
const time = (at) => new Date(at).toLocaleTimeString(document.documentElement.lang, { hour: "2-digit", minute: "2-digit" });
function renderState(state) {
  if (!state) return;
  const q = state.queue || { waiting: 0, failed: 0 };
  queueBadge.hidden = !q.waiting;
  queueBadge.textContent = q.waiting ? t("capture.queueCount", q.waiting) : "";
  queueBadge.title = t("capture.queueRetry");
  info.history = state.history || [];
  if (!recent.hidden) renderRecent();
  void renderAttention(q.failed);
}
queueBadge.addEventListener("click", () => desktop.capture.retry().then(renderState));
async function renderAttention(failed) {
  if (!failed) {
    attention.hidden = true;
    return attention.replaceChildren();
  }
  const items = await desktop.capture.attention().catch(() => []);
  const head = document.createElement("strong");
  head.textContent = t("capture.queueAttention", items.length);
  attention.replaceChildren(
    head,
    ...items.map((item) => {
      const row = document.createElement("div");
      row.className = "capture-attention-item";
      const label = document.createElement("span");
      label.textContent = `${item.title} – ${item.error}`;
      row.append(
        label,
        button(t("capture.copy"), () => {
          if (!text.value.trim()) text.value = item.text;
          text.focus();
        }),
        button(t("capture.discard"), async () => renderState(await desktop.capture.discard(item.id))),
      );
      return row;
    }),
  );
  attention.hidden = false;
}
let recentActive = 0;
function renderRecent() {
  const list = info.history || [];
  recentActive = Math.min(recentActive, Math.max(0, list.length - 1));
  recentList.replaceChildren(
    ...(list.length
      ? list.map((e, index) => {
          const li = document.createElement("li");
          li.role = "option";
          li.className = `capture-option${index === recentActive ? " active" : ""}`;
          li.dataset.id = e.id;
          const title = document.createElement("span");
          title.textContent = e.title;
          const meta = document.createElement("small");
          meta.textContent = [e.target, time(e.at), e.queued ? t("capture.recentQueued") : ""].filter(Boolean).join(" · ");
          li.append(title, meta);
          if (e.open) li.append(button(t("capture.open"), () => desktop.capture.open(e.id)));
          return li;
        })
      : [Object.assign(document.createElement("li"), { className: "capture-option empty", textContent: t("capture.recentEmpty") })]),
  );
}
function openRecent() {
  closePicker(false);
  recent.hidden = false;
  recentActive = 0;
  renderRecent();
}
function closeRecent() {
  recent.hidden = true;
}

// ---- Keys ----
text.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!recent.hidden) {
      const entry = (info.history || [])[recentActive];
      if (entry?.open) void desktop.capture.open(entry.id);
      return;
    }
    void save();
  } else if (event.key === "Tab" && !event.shiftKey && !event.altKey && !mod(event)) {
    event.preventDefault();
    openPicker();
  } else if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    cycleTarget(event.key === "ArrowDown" ? 1 : -1);
  } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !text.value && !event.shiftKey) {
    event.preventDefault();
    if (recent.hidden) {
      if (event.key === "ArrowDown") openRecent();
      return;
    }
    const n = (info.history || []).length || 1;
    recentActive = (recentActive + (event.key === "ArrowDown" ? 1 : -1) + n) % n;
    renderRecent();
  } else if (mod(event) && event.shiftKey && event.key.toLowerCase() === "v") {
    event.preventDefault();
    void paste();
  } else if (mod(event) && event.shiftKey && event.key.toLowerCase() === "r" && !event.repeat) {
    event.preventDefault();
    keyHeld = true;
    void startRecording();
  }
});
let keyHeld = false;
text.addEventListener("keyup", (event) => {
  if (event.key.toLowerCase() !== "r" || !keyHeld) return;
  keyHeld = false;
  stopRecording();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (!picker.hidden) return closePicker();
  if (!recent.hidden) return closeRecent();
  void desktop.capture.close();
});
document.getElementById("form").addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});
text.addEventListener("input", () => {
  if (status.classList.contains("ok")) say("");
  if (text.value) closeRecent();
  schedulePreview();
});
task.addEventListener("change", schedulePreview);

// ---- The window comes back ----
function applyPreset(preset) {
  if (!preset) {
    actionLabel.hidden = true;
    templateId = null;
    return;
  }
  actionLabel.hidden = false;
  actionLabel.textContent = t("capture.action", preset.name);
  if (preset.target && info.targets.some((x) => x.id === preset.target)) setTarget(preset.target);
  task.checked = preset.task === true;
  templateId = preset.template || null;
  if (preset.prefix && !text.value) text.value = preset.prefix;
  if (preset.paste) void paste();
  schedulePreview();
}
async function refresh(preset) {
  try {
    const keep = targetId;
    info = await desktop.capture.info();
    targetId = info.targets.some((x) => x.id === keep) && keep !== "inbox" && !preset ? keep : info.target || "inbox";
    renderTarget();
    $("suggest").hidden = !info.suggest;
    for (const id of ["attach", "screen", "voice"]) $(id).disabled = !!info.legacy;
    renderState(info);
    if (preset !== undefined) applyPreset(preset);
  } catch {}
  text.focus();
}
desktop.capture.onPreset((preset) => {
  if (status.classList.contains("ok")) say("");
  void refresh(preset);
});
desktop.capture.onState(renderState);
void refresh();
