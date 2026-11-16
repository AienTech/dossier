import Cocoa
import ApplicationServices

// Diagnostics contain stages only, never prompts, clipboard contents or job details.
func diagnostic(_ stage: String) {
  let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs")
  try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  let file = folder.appendingPathComponent("HireMeBotHelper.log")
  let line = Data((ISO8601DateFormatter().string(from: Date()) + " " + stage + "\n").utf8)
  if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
  if let handle = try? FileHandle(forWritingTo: file) { defer { try? handle.close() }; _ = try? handle.seekToEnd(); try? handle.write(contentsOf: line) }
}

// Rich-text composers may change paragraph breaks and nonbreaking spaces on paste.
// Compare every word and URL while allowing whitespace layout normalization.
func samePrompt(_ actual: String, _ expected: String) -> Bool {
  func canonical(_ value: String) -> String { value.precomposedStringWithCanonicalMapping.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
  return canonical(actual) == canonical(expected)
}

struct Handoff {
  let message: String
  let agent: String
  let bot: String
  /// Set from HireMe's bot settings when the app is installed under another name.
  let appNameOverride: String?
  var appName: String { appNameOverride ?? (bot == "grok" ? "Grok Bot" : "OpenBot") }
  var bundleID: String { bot == "grok" ? "com.anysphere.sand" : "app.openbot.desktop" }
  init(_ url: URL) throws {
    guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false), c.scheme == "hireme-bot", ["openbot", "grok"].contains(c.host ?? ""), c.path == "/apply",
      c.user == nil, c.password == nil, c.port == nil, c.fragment == nil,
      let items = c.queryItems, Set(items.map { $0.name }).count == items.count,
      items.allSatisfy({ ["message", "agent", "app"].contains($0.name) }),
      let text = items.first(where: { $0.name == "message" })?.value, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf8.count <= 16000 else { throw HelperError.invalidLink }
    let name = (items.first(where: { $0.name == "agent" })?.value ?? (c.host == "grok" ? "Job Finder" : "Job Manager")).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty, name.count <= 100, name.rangeOfCharacter(from: .controlCharacters) == nil else { throw HelperError.invalidLink }
    // An app name can only be a name: no path, no bundle id we did not expect.
    let app = (items.first(where: { $0.name == "app" })?.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard app.count <= 100, app.rangeOfCharacter(from: .controlCharacters) == nil, !app.contains("/"), !app.contains(":") else { throw HelperError.invalidLink }
    message = text; agent = name; bot = c.host!; appNameOverride = app.isEmpty ? nil : app
  }
  var applicationURL: String? {
    guard let r = message.range(of: #"https?://[^\s]+/applications/[A-Za-z0-9_-]+"#, options: .regularExpression) else { return nil }
    return String(message[r])
  }
}
enum HelperError: LocalizedError {
  case invalidLink, permission, unavailable, missingAgent(String), draft, focus, paste
  var errorDescription: String? {
    switch self {
    case .invalidLink: return "This is not a valid HireMe bot handoff link."
    case .permission: return "One-time setup: allow HireMe Bot Helper in System Settings → Privacy & Security → Accessibility, then click Apply with bot again. This lets the helper focus the selected bot and paste the prompt. It never presses Send. Local scripts is not required."
    case .unavailable: return "The configured bot app could not be opened. Check the app name in HireMe’s Bot settings, or leave it empty to use the default app. Your full prompt is also copied in HireMe."
    case .missingAgent(let name): return "Could not find the bot agent ‘\(name)’. Check agent name in HireMe’s Bot settings. No text was pasted."
    case .draft: return "The bot already has a draft in this agent’s composer. Send or clear it first, then click Apply with bot again. Your existing text was preserved."
    case .focus: return "The bot’s intended composer could not be focused. Nothing was pasted. Open that agent and try again, or paste the copied prompt manually."
    case .paste: return "Could not verify the pasted prompt in the bot. Check its composer; the full prompt remains available in HireMe. Nothing was sent."
    }
  }
}

/// A stable stage name for the log. It never includes prompts, clipboard text or job details.
func stage(of error: Error) -> String {
  switch error as? HelperError {
  case .some(.invalidLink): return "invalidLink"
  case .some(.permission): return "permission"
  case .some(.unavailable): return "unavailable"
  case .some(.missingAgent(let name)): return "missingAgent(\(name))"
  case .some(.draft): return "draft"
  case .some(.focus): return "focus"
  case .some(.paste): return "paste"
  case .none: return "unexpected(\(type(of: error)))"
  }
}

func axAttribute(_ element: AXUIElement, _ key: CFString) -> CFTypeRef? {
  var value: CFTypeRef?; guard AXUIElementCopyAttributeValue(element, key, &value) == .success else { return nil }; return value
}
func axString(_ element: AXUIElement, _ key: CFString) -> String { axAttribute(element, key) as? String ?? "" }
func axLabel(_ element: AXUIElement) -> String {
  [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, "AXPlaceholderValue"].map { axString(element, $0 as CFString) }.joined(separator: "\n")
}
func axFind(_ root: AXUIElement, limit: Int = 12000, matching: (AXUIElement) -> Bool) -> AXUIElement? {
  var queue = [root]; var index = 0
  while index < queue.count && index < limit {
    let node = queue[index]; index += 1
    if matching(node) { return node }
    if let children = axAttribute(node, kAXChildrenAttribute as CFString) as? [AXUIElement] { queue.append(contentsOf: children) }
  }
  return nil
}

/// Chromium and Electron keep their web accessibility tree off until a client
/// asks for it. Turning it on up front makes the composer appear immediately
/// instead of after the tree's own lazy warm-up.
func enableAccessibilityTree(_ root: AXUIElement) {
  AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
}

/// Prints the accessibility nodes a bot exposes. Used by `--dump` while
/// diagnosing a bot update; it never types, pastes or sends anything.
func dumpAccessibility(bundleIDs: [String]) {
  for bundleID in bundleIDs {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else { print("\(bundleID): not running"); continue }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 2)
    enableAccessibilityTree(root)
    for _ in 0..<20 {
      if axFind(root, limit: 400, matching: { [kAXTextAreaRole, kAXTextFieldRole].contains(axString($0, kAXRoleAttribute as CFString)) }) != nil { break }
      Thread.sleep(forTimeInterval: 0.25)
    }
    print("\(bundleID): pid \(app.processIdentifier)")
    var queue = [root]; var index = 0; var seen = 0
    while index < queue.count && index < 3000 {
      let node = queue[index]; index += 1; seen += 1
      let role = axString(node, kAXRoleAttribute as CFString)
      if role == kAXTextAreaRole || role == kAXTextFieldRole || role == kAXButtonRole || role == kAXCheckBoxRole || role == kAXRadioButtonRole || role == "AXWebArea" {
        let title = axString(node, kAXTitleAttribute as CFString).replacingOccurrences(of: "\n", with: "⏎")
        let description = axString(node, kAXDescriptionAttribute as CFString).replacingOccurrences(of: "\n", with: "⏎")
        let help = axString(node, kAXHelpAttribute as CFString).replacingOccurrences(of: "\n", with: "⏎")
        let placeholder = axString(node, "AXPlaceholderValue" as CFString).replacingOccurrences(of: "\n", with: "⏎")
        let checked = axAttribute(node, kAXValueAttribute as CFString) as? Bool
        print("  \(role) | title=\(title.prefix(60)) | desc=\(description.prefix(60)) | help=\(help.prefix(60)) | placeholder=\(placeholder.prefix(60)) | bool=\(checked.map(String.init) ?? "-")")
      }
      if let children = axAttribute(node, kAXChildrenAttribute as CFString) as? [AXUIElement] { queue.append(contentsOf: children) }
    }
    print("  nodes visited: \(seen)")
  }
}

/// Where the owner approved a bot app that is not one of the two built-ins.
func appStoreURL() -> URL {
  FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/HireMe/bot-apps.json")
}
func approvedBundles() -> Set<String> {
  guard let data = try? Data(contentsOf: appStoreURL()), let list = try? JSONSerialization.jsonObject(with: data) as? [String] else { return [] }
  return Set(list)
}
func approveBundle(_ id: String) {
  let url = appStoreURL()
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  if let data = try? JSONSerialization.data(withJSONObject: Array(approvedBundles().union([id])).sorted(), options: [.prettyPrinted]) {
    try? data.write(to: url, options: .atomic)
  }
}

/// The installed app for a name from HireMe's bot settings. A copy that is
/// already running wins, so an install kept outside /Applications still works.
func locateApp(named name: String) -> URL? {
  for folder in ["/Applications", NSHomeDirectory() + "/Applications", "/System/Applications"] {
    let url = URL(fileURLWithPath: folder).appendingPathComponent(name + ".app")
    if FileManager.default.fileExists(atPath: url.path) { return url }
  }
  return NSWorkspace.shared.runningApplications.first {
    $0.localizedName?.caseInsensitiveCompare(name) == .orderedSame
  }?.bundleURL
}

final class Helper: NSObject, NSApplicationDelegate {
  var busy = false
  @objc func handleURL(_ event: NSAppleEventDescriptor, withReplyEvent reply: NSAppleEventDescriptor) {
    diagnostic("URL event received")
    guard let text = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue, let url = URL(string: text) else { return }
    application(NSApp, open: [url])
  }
  func applicationDidFinishLaunching(_ notification: Notification) { NSApp.setActivationPolicy(.accessory) }
  func application(_ application: NSApplication, open urls: [URL]) {
    // Cold-launch URL events can precede applicationDidFinishLaunching. Present
    // permission errors only after AppKit finishes launching so they stay visible.
    DispatchQueue.main.async { self.process(urls) }
  }
  func process(_ urls: [URL]) {
    diagnostic("handoff requested")
    guard !busy, let url = urls.first else { return }
    do {
      let handoff = try Handoff(url)
      NSLog("HireMe handoff received: %@", handoff.bot)
      diagnostic("Accessibility trusted: \(AXIsProcessTrusted())")
      // Ask once per launch when the grant is missing, so macOS can show its
      // own prompt instead of only an explanation in the helper's alert.
      let trusted = AXIsProcessTrusted() || AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
      guard trusted else { report(HelperError.permission); return }
      busy = true
      guard let target = locateApp(named: handoff.appName) else {
        diagnostic("app not found: \(handoff.appNameOverride == nil ? "default" : "configured")")
        busy = false; report(HelperError.unavailable); return
      }
      let configuration = NSWorkspace.OpenConfiguration(); configuration.activates = true
      NSWorkspace.shared.openApplication(at: target, configuration: configuration) { app, error in
        diagnostic("target launch callback")
        guard let app = app, error == nil else { DispatchQueue.main.async { self.busy = false; self.report(HelperError.unavailable) }; return }
        DispatchQueue.main.async {
          // A configured app is used only after the owner allows it once, so a
          // link cannot make the helper type into an app nobody chose.
          guard self.allow(app, handoff) else { self.busy = false; self.report(HelperError.unavailable); return }
          DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try self.inject(handoff, into: app) }
            if case .success = result { diagnostic("composer filled"); NSLog("HireMe handoff filled composer: %@", handoff.bot) }
            DispatchQueue.main.async { self.busy = false; if case .failure(let error) = result { self.report(error) } }
          }
        }
      }
    } catch { report(error) }
  }
  /// True for the bot's own app, or for a configured app the owner approved.
  func allow(_ app: NSRunningApplication, _ handoff: Handoff) -> Bool {
    guard let id = app.bundleIdentifier else { return false }
    if id == handoff.bundleID || approvedBundles().contains(id) { return true }
    let alert = NSAlert()
    alert.messageText = "Allow HireMe to fill prompts in \(app.localizedName ?? handoff.appName)?"
    alert.informativeText = "This app is set as the bot app in HireMe. The helper pastes the job prompt into it and presses nothing else — not even Send. Only allow a bot you would give the job packet to."
    alert.addButton(withTitle: "Allow")
    alert.addButton(withTitle: "Don’t allow")
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    let answer = alert.runModal()
    NSApp.setActivationPolicy(.accessory)
    guard answer == .alertFirstButtonReturn else { diagnostic("configured app declined"); return false }
    approveBundle(id)
    diagnostic("configured app approved")
    return true
  }
  func report(_ error: Error) {
    diagnostic("handoff failed: \(stage(of: error))")
    NSLog("HireMe handoff failed: %@", error.localizedDescription)
    let alert = NSAlert(); alert.messageText = "HireMe → application bot"; alert.informativeText = error.localizedDescription
    alert.addButton(withTitle: "OK")
    if case HelperError.permission = error { alert.addButton(withTitle: "Open Accessibility settings") }
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    defer { NSApp.setActivationPolicy(.accessory) }
    if alert.runModal() == .alertSecondButtonReturn { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!) }
  }
  /// The bot's own control for this agent: Grok Bot lists agents as buttons,
  /// OpenBot opens a chat from "Chat with …" checkboxes.
  func agentControl(_ root: AXUIElement, _ handoff: Handoff) -> AXUIElement? {
    let name = handoff.agent.lowercased()
    return axFind(root, matching: { node in
      let role = axString(node, kAXRoleAttribute as CFString)
      guard [kAXButtonRole, kAXCheckBoxRole, kAXRadioButtonRole].contains(role) else { return false }
      return axLabel(node).components(separatedBy: "\n").contains { line in
        let text = line.trimmingCharacters(in: .whitespaces).lowercased()
        return text == name || text == "chat with " + name
      }
    })
  }
  /// True when this agent's control reports itself as the open chat. Grok Bot
  /// uses aria-current, OpenBot uses a checked toggle.
  func agentIsCurrent(_ root: AXUIElement, _ handoff: Handoff) -> Bool {
    guard let control = agentControl(root, handoff) else { return false }
    if let current = axString(control, "AXARIACurrent" as CFString) as String?, !current.isEmpty { return true }
    if let selected = axAttribute(control, kAXSelectedAttribute as CFString) as? Bool, selected { return true }
    if let checked = axAttribute(control, kAXValueAttribute as CFString) as? Bool, checked { return true }
    return false
  }
  /// Opens the agent's chat. A press can be ignored while the bot is busy, so
  /// this retries a few times — but never while that agent already reports
  /// itself open, because pressing again would close its chat.
  func openAgentChat(_ root: AXUIElement, _ handoff: Handoff, attempts: Int) -> Int {
    var made = attempts
    while made < 3, !agentIsCurrent(root, handoff) {
      guard let control = agentControl(root, handoff),
        AXUIElementPerformAction(control, kAXPressAction as CFString) == .success else { break }
      made += 1
      Thread.sleep(forTimeInterval: 0.4)
    }
    return made
  }
  /// Every composer the app currently exposes. More than one means several
  /// chats are open, so a generic composer label can no longer be trusted.
  func composers(_ root: AXUIElement) -> [AXUIElement] {
    var found: [AXUIElement] = []
    _ = axFind(root, matching: { node in
      let role = axString(node, kAXRoleAttribute as CFString)
      if [kAXTextAreaRole, kAXTextFieldRole].contains(role) { found.append(node) }
      return false
    })
    return found
  }
  /// The composer that belongs to this agent, or nil when that cannot be proven.
  func agentComposer(_ root: AXUIElement, _ handoff: Handoff, _ expected: String) -> AXUIElement? {
    if let named = axFind(root, matching: { node in
      let role = axString(node, kAXRoleAttribute as CFString)
      return [kAXTextAreaRole, kAXTextFieldRole].contains(role) && axLabel(node).lowercased().contains(expected)
    }) { return named }
    // Grok Bot labels its only composer just "Prompt", so accept a generic one
    // only while this agent's own sidebar item is marked current and no other
    // chat composer is on screen.
    let all = composers(root)
    if all.count == 1, agentIsCurrent(root, handoff) { return all[0] }
    return nil
  }
  func inject(_ handoff: Handoff, into app: NSRunningApplication) throws {
    // The PID is supplied by LaunchServices for this exact app; a configured
    // name only counts when the owner approved that bundle identifier.
    guard let bundle = app.bundleIdentifier, bundle == handoff.bundleID || approvedBundles().contains(bundle) else { throw HelperError.unavailable }
    let root = AXUIElementCreateApplication(app.processIdentifier); AXUIElementSetMessagingTimeout(root, 1)
    enableAccessibilityTree(root)
    let expected = "message " + handoff.agent.lowercased()
    let deadline = Date().addingTimeInterval(20)
    var opened = 0
    var editor: AXUIElement?
    while Date() < deadline {
      if let found = agentComposer(root, handoff, expected) { editor = found; break }
      opened = openAgentChat(root, handoff, attempts: opened)
      Thread.sleep(forTimeInterval: 0.2)
    }
    guard let editor = editor else {
      // Labels are logged without their text so a bot update is diagnosable without leaking a prompt.
      diagnostic("composer not found: openedChat=\(opened) current=\(agentIsCurrent(root, handoff)) composers=\(composers(root).count) labels=\(composers(root).map { axLabel($0).replacingOccurrences(of: "\n", with: " ").prefix(60) })")
      throw agentControl(root, handoff) == nil ? HelperError.missingAgent(handoff.agent) : HelperError.focus
    }
    var text = handoff.message
    // The browser copies the complete prompt before opening this URL. Use it only if it
    // identifies the exact same job and contains HireMe's complete handoff instructions.
    if let job = handoff.applicationURL {
      for _ in 0..<8 {
        if let full = NSPasteboard.general.string(forType: .string), full.utf8.count <= 200000,
          full.contains(job), full.contains("## 1. Application and links"), full.contains("## 8. Update this exact job") { text = full; break }
        Thread.sleep(forTimeInterval: 0.1)
      }
    }
    let old = axString(editor, kAXValueAttribute as CFString)
    if samePrompt(old, text) { app.activate(options: [.activateIgnoringOtherApps]); return }
    guard old.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw HelperError.draft }
    app.activate(options: [.activateIgnoringOtherApps])
    guard AXUIElementSetAttributeValue(editor, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { throw HelperError.focus }
    Thread.sleep(forTimeInterval: 0.15)
    let system = AXUIElementCreateSystemWide()
    guard let focused = axAttribute(system, kAXFocusedUIElementAttribute as CFString), CFGetTypeID(focused) == AXUIElementGetTypeID() else { throw HelperError.focus }
    let field = unsafeBitCast(focused, to: AXUIElement.self); var pid: pid_t = 0; AXUIElementGetPid(field, &pid)
    guard pid == app.processIdentifier, CFEqual(field, editor) || axLabel(field).lowercased().contains(expected), app.isActive else { throw HelperError.focus }
    let saved = NSPasteboard.general.pasteboardItems?.map { item -> NSPasteboardItem in
      let copy = NSPasteboardItem(); for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }; return copy
    } ?? []
    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
    defer { if NSPasteboard.general.string(forType: .string) == text { NSPasteboard.general.clearContents(); NSPasteboard.general.writeObjects(saved) } }
    // Cmd+V only. No Return/Enter event, CLI task, API request or shell execution.
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true), let up = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false) else { throw HelperError.paste }
    down.flags = .maskCommand; up.flags = .maskCommand; down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
    // Large job prompts can take several seconds to reach Electron's AX value.
    for _ in 0..<120 { if samePrompt(axString(editor, kAXValueAttribute as CFString), text) { return }; Thread.sleep(forTimeInterval: 0.1) }
    let actual = axString(editor, kAXValueAttribute as CFString)
    let a = Array(actual.precomposedStringWithCanonicalMapping.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").unicodeScalars)
    let b = Array(text.precomposedStringWithCanonicalMapping.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").unicodeScalars)
    let offset = zip(a, b).prefix(while: { $0 == $1 }).count
    diagnostic("paste check mismatch: actualLength=\(a.count) expectedLength=\(b.count) offset=\(offset) actualScalar=\(offset < a.count ? a[offset].value : 0) expectedScalar=\(offset < b.count ? b[offset].value : 0)")
    throw HelperError.paste
  }
}

if CommandLine.arguments.contains("--self-test") {  for link in ["hireme-bot://grok/apply?agent=Job%20Finder&message=Test", "hireme-bot://openbot/apply?message=Test", "hireme-bot://openbot/apply?agent=Job%20Manager&message=A%26B%0AReview"] { precondition((try? Handoff(URL(string: link)!)) != nil) }
  for link in ["https://example.com/?message=x", "hireme-bot://openbot/apply?message=x&message=y", "hireme-bot://openbot/apply?message=", "hireme-bot://other/apply?message=x", "hireme-bot://openbot/apply?message=x&command=bad", "hireme-bot://openbot/apply?message=x&agent=%0A", "hireme-bot://openbot/apply?message=x&app=../../evil", "hireme-bot://openbot/apply?message=x&app=a:b"] { precondition((try? Handoff(URL(string: link)!)) == nil) }
  // A configured app name is only a name; empty means the bot's default app.
  let named = try Handoff(URL(string: "hireme-bot://openbot/apply?message=Test&app=OpenBot%20Beta")!)
  precondition(named.appName == "OpenBot Beta" && named.applicationURL == nil)
  precondition((try? Handoff(URL(string: "hireme-bot://openbot/apply?message=Test&app=%20")!))!.appName == "OpenBot")
  let h = try Handoff(URL(string: "hireme-bot://openbot/apply?message=HireMe:%20https://hireme.example/applications/job-one")!)
  precondition(h.applicationURL == "https://hireme.example/applications/job-one")
  precondition(samePrompt("Approval required.\r\n\nDrive: https://drive.google.com/x", "Approval required.\nDrive: https://drive.google.com/x"))
  precondition(!samePrompt("Approval required. Drive: https://drive.google.com/other", "Approval required. Drive: https://drive.google.com/x"))
  precondition(!samePrompt("Apply now", "Never apply now"))
  print("Direct-injection handoff checks passed. No app was controlled and no task was sent.")
} else if let index = CommandLine.arguments.firstIndex(of: "--dump") {
  let targets = Array(CommandLine.arguments.dropFirst(index + 1))
  dumpAccessibility(bundleIDs: targets.isEmpty ? ["com.anysphere.sand", "app.openbot.desktop"] : targets)
} else { diagnostic("helper started"); let app = NSApplication.shared; let delegate = Helper(); app.delegate = delegate; app.setActivationPolicy(.accessory); NSAppleEventManager.shared().setEventHandler(delegate, andSelector: #selector(Helper.handleURL(_:withReplyEvent:)), forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL)); withExtendedLifetime(delegate) { app.run() } }
