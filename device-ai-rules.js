// Apple's on-device model (device-ai.js, native/device-ai): the decisions,
// without Electron – which helper runs where, what a page may ask and what
// the helper may answer. test/device-ai.mjs runs them with Node alone.
//
// The instance's pages reach the model through window.FlowplanDesktop.ai
// (preload.js) – only on macOS builds that carry the helper, only with the
// setting on, only from the main frame of the profile's own instance. Every
// request is checked here again before it reaches the helper; prompts and
// answers never leave the Mac.
const path = require("node:path");

// The contract with the web app (window.FlowplanDesktop.ai.version).
const VERSION = 1;
const ERROR_CODES = ["unavailable", "context-too-long", "guardrail", "cancelled", "busy", "error"];
const REASONS = ["unsupported-os", "device-not-eligible", "apple-intelligence-off", "model-not-ready", "unsupported-language", "error"];

// What a page may send. The model's context is a few thousand tokens: longer
// prompts are refused before they reach it ("context-too-long").
const LIMITS = {
  id: 128,
  prompt: 24_000,
  instructions: 8_000,
  schemaDepth: 6,
  schemaNodes: 200,
  properties: 50,
  enumValues: 100,
  text: 300, // an enum value, a property name
  description: 1_000,
  maxTokens: 4_096,
  maxItems: 1_000,
  // What the helper may answer: one line, the text of an answer.
  line: 4 * 1024 * 1024,
  answer: 1024 * 1024,
};

// Timings of the helper (device-ai.js): stopped after five idle minutes, a
// request ends after two minutes, an availability check after 15 seconds.
const TIMING = {
  idleMs: 5 * 60_000,
  requestMs: 120_000,
  availabilityMs: 15_000,
  // After a cancel or a timeout: how long the helper may take to stop.
  graceMs: 3_000,
};

class AiError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = ERROR_CODES.includes(code) ? code : "error";
    this.detail = detail || "";
  }
}
const isText = (value) => typeof value === "string";
const ID = /^[\w.:-]{1,128}$/;

// A JSON schema of the subset the model takes – object, array, string,
// number, integer, boolean and string enums – in the helper's own form:
// objects keep their properties in order (a JSON object in Swift would not),
// with "optional" instead of "required". Unknown keywords ($schema, title,
// additionalProperties, format …) fall away; unknown types are refused.
function helperSchema(input) {
  let nodes = 0;
  function node(value, depth) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiError("error", "schema: every node is an object");
    if (++nodes > LIMITS.schemaNodes) throw new AiError("error", `schema: more than ${LIMITS.schemaNodes} nodes`);
    if (depth > LIMITS.schemaDepth) throw new AiError("error", `schema: deeper than ${LIMITS.schemaDepth} levels`);
    const out = {};
    if (value.description !== undefined) {
      if (!isText(value.description) || value.description.length > LIMITS.description) throw new AiError("error", "schema: description");
      if (value.description) out.description = value.description;
    }
    if (value.enum !== undefined) {
      const list = value.enum;
      if (value.type !== undefined && value.type !== "string") throw new AiError("error", "schema: enums are strings");
      if (!Array.isArray(list) || !list.length || list.length > LIMITS.enumValues) throw new AiError("error", "schema: enum");
      if (!list.every((v) => isText(v) && v.length > 0 && v.length <= LIMITS.text)) throw new AiError("error", "schema: enum values are strings");
      return { ...out, enum: [...new Set(list)] };
    }
    switch (value.type) {
      case "object": {
        const properties = value.properties ?? {};
        if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new AiError("error", "schema: properties");
        const names = Object.keys(properties);
        if (!names.length || names.length > LIMITS.properties) throw new AiError("error", `schema: 1 to ${LIMITS.properties} properties`);
        const required = value.required === undefined ? [] : value.required;
        if (!Array.isArray(required) || !required.every(isText)) throw new AiError("error", "schema: required");
        out.type = "object";
        out.properties = names.map((name) => {
          if (!name || name.length > LIMITS.text) throw new AiError("error", "schema: property name");
          const schema = node(properties[name], depth + 1);
          const entry = { name, schema, optional: !required.includes(name) };
          // JSON Schema puts a property's description on its own schema.
          if (schema.description) entry.description = schema.description;
          return entry;
        });
        return out;
      }
      case "array": {
        out.type = "array";
        out.items = node(value.items, depth + 1);
        for (const key of ["minItems", "maxItems"]) {
          if (value[key] === undefined) continue;
          if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > LIMITS.maxItems) throw new AiError("error", `schema: ${key}`);
          out[key] = value[key];
        }
        if (out.minItems !== undefined && out.maxItems !== undefined && out.minItems > out.maxItems) throw new AiError("error", "schema: minItems > maxItems");
        return out;
      }
      case "string":
      case "number":
      case "integer":
      case "boolean":
        return { ...out, type: value.type };
      default:
        throw new AiError("error", `schema: type ${JSON.stringify(value.type)} is not supported`);
    }
  }
  return node(input, 1);
}

// A request from a page: generate (optionally with a schema) or stream (no
// schema). Returns what goes to the helper, or throws an AiError.
function checkRequest(input, kind) {
  if (kind !== "generate" && kind !== "stream") throw new AiError("error", "unknown request");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AiError("error", "the request is an object");
  const { id, prompt, instructions, schema, temperature, maxTokens } = input;
  if (!isText(id) || !ID.test(id)) throw new AiError("error", "id: 1 to 128 letters, digits, _ . : -");
  if (!isText(prompt) || !prompt.trim()) throw new AiError("error", "prompt: a text");
  if (prompt.length > LIMITS.prompt) throw new AiError("context-too-long", `prompt: at most ${LIMITS.prompt} characters`);
  const request = { id, prompt };
  if (instructions !== undefined && instructions !== null) {
    if (!isText(instructions)) throw new AiError("error", "instructions: a text");
    if (instructions.length > LIMITS.instructions) throw new AiError("context-too-long", `instructions: at most ${LIMITS.instructions} characters`);
    if (instructions.trim()) request.instructions = instructions;
  }
  if (schema !== undefined && schema !== null) {
    if (kind === "stream") throw new AiError("error", "stream takes no schema");
    request.schema = helperSchema(schema);
  }
  if (temperature !== undefined && temperature !== null) {
    if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new AiError("error", "temperature: 0 to 2");
    request.temperature = temperature;
  }
  if (maxTokens !== undefined && maxTokens !== null) {
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > LIMITS.maxTokens) throw new AiError("error", `maxTokens: 1 to ${LIMITS.maxTokens}`);
    request.maxTokens = maxTokens;
  }
  return request;
}

// What the helper wrote: one JSON line with an id and a known type, or null.
const HELPER_TYPES = ["availability", "chunk", "done", "error"];
function helperMessage(line) {
  if (!isText(line) || !line || line.length > LIMITS.line) return null;
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!isText(value.id) || !HELPER_TYPES.includes(value.type)) return null;
  return value;
}

// The helper's availability as the page gets it: known reasons only.
function availabilityOf(message) {
  if (!message || message.available !== true) {
    const reason = REASONS.includes(message?.reason) ? message.reason : "error";
    return { available: false, reason, ...languagesOf(message) };
  }
  return { available: true, ...languagesOf(message) };
}
function languagesOf(message) {
  const list = Array.isArray(message?.languages) ? message.languages.filter((l) => isText(l) && /^[A-Za-z0-9-]{1,35}$/.test(l)).slice(0, 100) : null;
  return list && list.length ? { languages: list } : {};
}

// A finished answer: text, or the JSON of a request with a schema.
function answerOf(message, { schema }) {
  if (schema) {
    if (!("json" in message)) throw new AiError("error", "the helper sent no JSON");
    if (JSON.stringify(message.json).length > LIMITS.answer) throw new AiError("error", "the answer is too long");
    return { json: message.json };
  }
  if (!isText(message.text)) throw new AiError("error", "the helper sent no text");
  if (message.text.length > LIMITS.answer) throw new AiError("error", "the answer is too long");
  return { text: message.text };
}
// An error of the helper: a known code, a short message.
function errorOf(message) {
  const detail = isText(message?.message) ? message.message.slice(0, 500) : "";
  return new AiError(ERROR_CODES.includes(message?.code) ? message.code : "error", detail);
}

// After a crash the next start waits a little longer: 0.5 s, 1 s, 2 s … up
// to 30 s. More than five crashes within ten minutes: unavailable until
// those ten minutes are over.
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES = 5;
function restartDelay(crashes, now = Date.now()) {
  const recent = crashes.filter((at) => now - at < CRASH_WINDOW_MS);
  if (!recent.length) return 0;
  if (recent.length > MAX_CRASHES) return Infinity;
  const last = Math.max(...recent);
  return Math.max(0, Math.min(30_000, 500 * 2 ** (recent.length - 1)) - (now - last));
}

// Which helper runs: in the packaged macOS app Contents/MacOS/device-ai, next
// to the app's executable (built by the release workflow, signed with the
// app), nothing in other packaged builds. Outside the packaged app (npm start, the tests)
// FLOWPLAN_DEVICE_AI_HELPER may name one – a .js/.mjs file runs with
// Electron as Node, like the stand-in of the tests – or the helper built
// in native/device-ai on a Mac. Returns { command, args, env } or null.
function helperCommand({ platform, packaged, appDir, env = {}, execPath, exists }) {
  if (packaged) {
    if (platform !== "darwin" || !execPath) return null;
    const file = path.join(path.dirname(execPath), "device-ai");
    return exists(file) ? { command: file, args: [], env: {} } : null;
  }
  const wanted = env.FLOWPLAN_DEVICE_AI_HELPER;
  if (wanted) {
    if (wanted === "off") return null;
    const file = path.resolve(appDir, wanted);
    if (!exists(file)) return null;
    if (/\.m?js$/.test(file)) return { command: execPath, args: [file], env: { ELECTRON_RUN_AS_NODE: "1" } };
    return { command: file, args: [], env: {} };
  }
  if (platform !== "darwin") return null;
  const built = path.join(appDir, "native", "device-ai", ".build", "release", "device-ai");
  return exists(built) ? { command: built, args: [], env: {} } : null;
}

module.exports = {
  VERSION,
  ERROR_CODES,
  REASONS,
  LIMITS,
  TIMING,
  AiError,
  helperSchema,
  checkRequest,
  helperMessage,
  availabilityOf,
  answerOf,
  errorOf,
  restartDelay,
  CRASH_WINDOW_MS,
  MAX_CRASHES,
  helperCommand,
};
