// Flowplan's helper for Apple's on-device model (FoundationModels, macOS 26,
// Apple silicon, Apple Intelligence on). The app (device-ai.js) starts it
// when a page first asks and talks to it in JSON lines:
//
//   in   {"id":"1","type":"availability"}
//        {"id":"2","type":"generate","prompt":"…","instructions":"…",
//         "schema":{…},"temperature":0.3,"maxTokens":400}
//        {"id":"3","type":"stream","prompt":"…"}
//        {"id":"3","type":"cancel"}
//   out  {"id":"1","type":"availability","available":true,"languages":["de","en"]}
//        {"id":"3","type":"chunk","text":"the text so far"}
//        {"id":"2","type":"done","json":{…}}  or  {"id":"3","type":"done","text":"…"}
//        {"id":"2","type":"error","code":"busy","message":"…"}
//
// One request at a time (another one gets "busy"; availability is always
// answered). Error codes: unavailable, context-too-long, guardrail,
// cancelled, busy, error. "schema" is the app's own form of a JSON schema
// subset (device-ai-rules.js): object with ordered properties, array,
// string, number, integer, boolean and string enums. Nothing here touches
// the network: prompts and answers stay on the Mac. When stdin closes, the
// helper ends.
//
// The model only exists on Apple silicon: the Intel slice of the universal
// binary leaves it out ("device-not-eligible"), and so does a build with an
// SDK older than macOS 26 or a Mac below it ("unsupported-os").
import Foundation
#if canImport(FoundationModels) && arch(arm64)
import FoundationModels
#endif

// One request, read on the main actor and handed to the model.
struct Request: Sendable {
  let id: String
  let stream: Bool
  let prompt: String
  let instructions: String?
  let schema: Data?
  let temperature: Double?
  let maxTokens: Int?
}

enum Reply: Sendable {
  case text(String)
  case json(String)
  case failure(String, String)
}

// Writes one JSON line. Chunks come from the model's task, the rest from the
// main actor: one lock keeps lines whole.
enum Out {
  private static let lock = NSLock()
  static func send(_ message: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(message),
      var data = try? JSONSerialization.data(withJSONObject: message, options: [])
    else { return }
    data.append(0x0A)
    lock.lock()
    defer { lock.unlock() }
    // The app went away: nothing to do, stdin closes next.
    try? FileHandle.standardOutput.write(contentsOf: data)
  }
  static func error(_ id: String, _ code: String, _ message: String) {
    send(["id": id, "type": "error", "code": code, "message": message])
  }
}

@MainActor
final class Helper {
  private var current: (id: String, task: Task<Void, Never>)?

  func handle(_ line: String) {
    guard let data = line.data(using: .utf8),
      let message = (try? JSONSerialization.jsonObject(with: data, options: [])) as? [String: Any],
      let type = message["type"] as? String
    else { return Out.error("", "error", "Unreadable request.") }
    let id = message["id"] as? String ?? ""
    switch type {
    case "availability":
      Out.send(availability(id))
    case "cancel":
      if let current, current.id == id { current.task.cancel() }
    case "generate", "stream":
      if current != nil { return Out.error(id, "busy", "Another request is still running.") }
      guard let prompt = message["prompt"] as? String, !prompt.isEmpty else {
        return Out.error(id, "error", "The request has no prompt.")
      }
      var schema: Data? = nil
      if type == "generate", let node = message["schema"] as? [String: Any] {
        schema = try? JSONSerialization.data(withJSONObject: node, options: [])
      }
      let request = Request(
        id: id,
        stream: type == "stream",
        prompt: prompt,
        instructions: message["instructions"] as? String,
        schema: schema,
        temperature: (message["temperature"] as? NSNumber)?.doubleValue,
        maxTokens: (message["maxTokens"] as? NSNumber)?.intValue
      )
      let task = Task {
        let reply = await respond(request)
        self.finish(request.id, reply)
      }
      current = (id, task)
    default:
      Out.error(id, "error", "Unknown request type.")
    }
  }

  // The slot is free before the answer goes out: the app may send the next
  // request as soon as it reads it.
  private func finish(_ id: String, _ reply: Reply) {
    if current?.id == id { current = nil }
    switch reply {
    case .text(let text):
      Out.send(["id": id, "type": "done", "text": text])
    case .json(let string):
      if let value = try? JSONSerialization.jsonObject(with: Data(string.utf8), options: [.fragmentsAllowed]) {
        Out.send(["id": id, "type": "done", "json": value])
      } else {
        Out.error(id, "error", "The model's answer was not valid JSON.")
      }
    case .failure(let code, let message):
      Out.error(id, code, message)
    }
  }
}

func availability(_ id: String) -> [String: Any] {
  // An Intel Mac never gets the model; otherwise the system is too old.
  #if arch(x86_64)
    var answer: [String: Any] = ["available": false, "reason": "device-not-eligible"]
  #else
    var answer: [String: Any] = ["available": false, "reason": "unsupported-os"]
  #endif
  #if canImport(FoundationModels) && arch(arm64)
    if #available(macOS 26.0, *) { answer = Model.availability() }
  #endif
  answer["id"] = id
  answer["type"] = "availability"
  return answer
}

func respond(_ request: Request) async -> Reply {
  #if canImport(FoundationModels) && arch(arm64)
    if #available(macOS 26.0, *) {
      return await Model.respond(request)
    }
  #endif
  return .failure("unavailable", "Apple's on-device model needs macOS 26 or newer.")
}

#if canImport(FoundationModels) && arch(arm64)
  @available(macOS 26.0, *)
  enum Model {
    static func availability() -> [String: Any] {
      let model = SystemLanguageModel.default
      switch model.availability {
      case .available:
        let languages = model.supportedLanguages.map { $0.minimalIdentifier }.sorted()
        // The model answers in the languages it knows; a Mac set to another
        // language gets no answers worth having.
        let current = Locale.current.language.languageCode
        let supported = model.supportedLanguages.contains { $0.languageCode == current }
        if !supported { return ["available": false, "reason": "unsupported-language", "languages": languages] }
        return ["available": true, "languages": languages]
      case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible: return ["available": false, "reason": "device-not-eligible"]
        case .appleIntelligenceNotEnabled: return ["available": false, "reason": "apple-intelligence-off"]
        case .modelNotReady: return ["available": false, "reason": "model-not-ready"]
        @unknown default: return ["available": false, "reason": "error"]
        }
      @unknown default:
        return ["available": false, "reason": "error"]
      }
    }

    static func respond(_ request: Request) async -> Reply {
      guard case .available = SystemLanguageModel.default.availability else {
        return .failure("unavailable", "Apple Intelligence is not available on this Mac.")
      }
      let session: LanguageModelSession
      if let instructions = request.instructions, !instructions.isEmpty {
        session = LanguageModelSession(instructions: instructions)
      } else {
        session = LanguageModelSession()
      }
      let options = GenerationOptions(sampling: nil, temperature: request.temperature, maximumResponseTokens: request.maxTokens)
      let prompt = Prompt(request.prompt)
      do {
        if let data = request.schema {
          guard let node = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else {
            return .failure("error", "Unreadable schema.")
          }
          var builder = SchemaBuilder()
          let schema = try GenerationSchema(root: try builder.build(node), dependencies: [])
          let response = try await session.respond(to: prompt, schema: schema, includeSchemaInPrompt: true, options: options)
          try Task.checkCancellation()
          return .json(response.content.jsonString)
        }
        if request.stream {
          var text = ""
          for try await snapshot in session.streamResponse(to: prompt, options: options) {
            try Task.checkCancellation()
            text = snapshot.content
            Out.send(["id": request.id, "type": "chunk", "text": text])
          }
          try Task.checkCancellation()
          return .text(text)
        }
        let response = try await session.respond(to: prompt, options: options)
        try Task.checkCancellation()
        return .text(response.content)
      } catch {
        return failure(error)
      }
    }

    static func failure(_ error: Error) -> Reply {
      if error is CancellationError || Task.isCancelled { return .failure("cancelled", "Cancelled.") }
      if let generation = error as? LanguageModelSession.GenerationError {
        let message = generation.localizedDescription
        switch generation {
        case .exceededContextWindowSize: return .failure("context-too-long", message)
        case .guardrailViolation: return .failure("guardrail", message)
        case .assetsUnavailable, .unsupportedLanguageOrLocale: return .failure("unavailable", message)
        default: return .failure("error", message)
        }
      }
      if error is HelperSchemaError { return .failure("error", "Unsupported schema.") }
      return .failure("error", error.localizedDescription)
    }
  }

  // The app's schema (device-ai-rules.js → helperSchema) as a dynamic
  // generation schema. Objects get names of their own (Object1, Object2, …);
  // nothing refers to them, so there are no dependencies.
  enum HelperSchemaError: Error { case unsupported }

  @available(macOS 26.0, *)
  struct SchemaBuilder {
    private var count = 0

    mutating func build(_ node: [String: Any]) throws -> DynamicGenerationSchema {
      if let choices = node["enum"] as? [String] {
        return DynamicGenerationSchema(type: String.self, guides: [.anyOf(choices)])
      }
      switch node["type"] as? String {
      case "object":
        count += 1
        let name = "Object\(count)"
        var properties: [DynamicGenerationSchema.Property] = []
        for entry in node["properties"] as? [[String: Any]] ?? [] {
          guard let key = entry["name"] as? String, let schema = entry["schema"] as? [String: Any] else { throw HelperSchemaError.unsupported }
          properties.append(
            DynamicGenerationSchema.Property(
              name: key,
              description: entry["description"] as? String,
              schema: try build(schema),
              isOptional: entry["optional"] as? Bool ?? false
            ))
        }
        return DynamicGenerationSchema(name: name, description: node["description"] as? String, properties: properties)
      case "array":
        guard let items = node["items"] as? [String: Any] else { throw HelperSchemaError.unsupported }
        return DynamicGenerationSchema(
          arrayOf: try build(items),
          minimumElements: (node["minItems"] as? NSNumber)?.intValue,
          maximumElements: (node["maxItems"] as? NSNumber)?.intValue
        )
      case "string": return DynamicGenerationSchema(type: String.self)
      case "number": return DynamicGenerationSchema(type: Double.self)
      case "integer": return DynamicGenerationSchema(type: Int.self)
      case "boolean": return DynamicGenerationSchema(type: Bool.self)
      default: throw HelperSchemaError.unsupported
      }
    }
  }
#endif

@main
struct DeviceAI {
  @MainActor
  static func main() async {
    // A write to an app that went away must not end the helper with SIGPIPE.
    signal(SIGPIPE, SIG_IGN)
    let helper = Helper()
    do {
      for try await line in FileHandle.standardInput.bytes.lines {
        helper.handle(line)
      }
    } catch {}
    exit(0)
  }
}
