// swift-tools-version:5.9
// The helper that lets Flowplan use Apple's on-device model (device-ai.js).
// Built on the macOS runner of the release workflow:
//   swift build -c release --arch arm64 --arch x86_64
// It builds with older SDKs too: without the FoundationModels framework (or
// below macOS 26) it answers every request with "unavailable".
import PackageDescription

let package = Package(
  name: "device-ai",
  platforms: [.macOS(.v12)],
  targets: [
    .executableTarget(name: "device-ai", path: "Sources/device-ai")
  ]
)
