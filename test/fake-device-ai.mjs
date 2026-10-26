// A stand-in for native/device-ai: the same JSON lines, no model. The prompt
// picks what it does – "crash" ends the process, "hang" never answers,
// "slow" streams ten chunks 60 ms apart (and listens for a cancel),
// "stubborn" streams slowly and ignores cancels, "guardrail" and
// "too-long" answer with those errors; anything else is echoed. With a
// schema it answers JSON that fits it. FAKE_DEVICE_AI may set the
// availability as JSON; FAKE_DEVICE_AI_LOG names a file that gets one line
// per start and per request. Used by test/device-ai.mjs and test/app.mjs.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = (line) => process.env.FAKE_DEVICE_AI_LOG && appendFileSync(process.env.FAKE_DEVICE_AI_LOG, `${line}\n`);
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const availability = process.env.FAKE_DEVICE_AI ? JSON.parse(process.env.FAKE_DEVICE_AI) : { available: true, languages: ["de", "en", "fr"] };
log(`start ${process.pid}`);

let current = null; // { id, cancelled, stubborn }
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
function sample(node) {
  if (node.enum) return node.enum[0];
  if (node.type === "object") return Object.fromEntries(node.properties.filter((p) => !p.optional).map((p) => [p.name, sample(p.schema)]));
  if (node.type === "array") return Array.from({ length: Math.max(node.minItems || 0, 1) }, () => sample(node.items));
  return { string: "text", number: 1.5, integer: 2, boolean: true }[node.type];
}
async function run(message) {
  const { id, prompt, type } = message;
  const answer = `${message.instructions ? `[${message.instructions}] ` : ""}echo: ${prompt}`;
  if (prompt === "crash") process.exit(3);
  if (prompt === "hang") return new Promise(() => {});
  if (prompt === "guardrail") return send({ id, type: "error", code: "guardrail", message: "That cannot be answered." });
  if (prompt === "too-long") return send({ id, type: "error", code: "context-too-long", message: "Too long." });
  if (message.schema) return send({ id, type: "done", json: sample(message.schema) });
  if (prompt === "slow" || prompt === "stubborn") {
    let text = "";
    for (let i = 0; i < 10; i++) {
      await sleep(60);
      if (current.cancelled && !current.stubborn) return send({ id, type: "error", code: "cancelled", message: "Cancelled." });
      text += `${i} `;
      if (type === "stream") send({ id, type: "chunk", text });
    }
    return send({ id, type: "done", text });
  }
  if (type === "stream") {
    const words = answer.split(" ");
    for (let i = 1; i <= words.length; i++) send({ id, type: "chunk", text: words.slice(0, i).join(" ") });
  }
  send({ id, type: "done", text: answer });
}

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  log(`${message.type} ${message.id}`);
  if (message.type === "availability") send({ id: message.id, type: "availability", ...availability });
  else if (message.type === "cancel") {
    if (current?.id === message.id) current.cancelled = true;
  } else if (current) send({ id: message.id, type: "error", code: "busy", message: "Busy." });
  else {
    current = { id: message.id, cancelled: false, stubborn: message.prompt === "stubborn" };
    // The slot is free before the answer goes out (as in the real helper).
    const done = run(message);
    void done.finally(() => {
      if (current?.id === message.id) current = null;
    });
  }
}
process.exit(0);
