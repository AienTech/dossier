import Cocoa
import WebKit

// Same host as launcher.sh health checks. Mixing localhost and 127.0.0.1
// broke Next.js dev HMR in this WebView; keep one origin for cookies too.
let localURL = URL(string: "http://127.0.0.1:3000")!
let splashColor = NSColor(calibratedRed: 29.0 / 255.0, green: 28.0 / 255.0, blue: 26.0 / 255.0, alpha: 1.0)

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var updateItem: NSMenuItem?
  private var startedServer = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    setupMenus()
    setupWindow()
    NSApp.activate(ignoringOtherApps: true)
    showStarting()
    startServerThenLoad()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    window.makeKeyAndOrderFront(nil)
    return true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    let launcher = launcherURL()
    guard FileManager.default.isExecutableFile(atPath: launcher.path) else { return .terminateNow }
    let process = Process()
    process.executableURL = launcher
    process.arguments = ["quit"]
    process.environment = launcherEnvironment()
    try? process.run()
    process.waitUntilExit()
    return .terminateNow
  }

  private func setupMenus() {
    let main = NSMenu()

    let appItem = NSMenuItem()
    main.addItem(appItem)
    let appMenu = NSMenu()
    appItem.submenu = appMenu
    appMenu.addItem(withTitle: "About HireMe", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    let update = NSMenuItem(title: "Update HireMe", action: #selector(updateHireMe), keyEquivalent: "u")
    update.target = self
    updateItem = update
    appMenu.addItem(update)
    appMenu.addItem(NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r"))
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Quit HireMe", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

    let editItem = NSMenuItem()
    main.addItem(editItem)
    let edit = NSMenu(title: "Edit")
    editItem.submenu = edit
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

    NSApp.mainMenu = main
  }

  private func setupWindow() {
    let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
    let size = NSSize(width: min(1280, screen.width * 0.85), height: min(840, screen.height * 0.85))
    let frame = NSRect(
      x: screen.midX - size.width / 2,
      y: screen.midY - size.height / 2,
      width: size.width,
      height: size.height
    )
    window = NSWindow(
      contentRect: frame,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "HireMe"
    window.minSize = NSSize(width: 960, height: 640)
    window.titlebarAppearsTransparent = false
    window.isReleasedWhenClosed = false
    window.backgroundColor = splashColor

    let configuration = WKWebViewConfiguration()
    webView = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    webView.uiDelegate = self
    // Keep an opaque page colour between navigations so the window does not
    // flash through a transparent WebView (drawsBackground=false did that).
    webView.setValue(true, forKey: "drawsBackground")
    if #available(macOS 12.0, *) {
      webView.underPageBackgroundColor = splashColor
    }
    window.contentView = webView
    window.makeKeyAndOrderFront(nil)
  }

  private func showStarting() {
    window.title = "Starting HireMe…"
    webView.loadHTMLString(
      """
      <!doctype html>
      <html>
      <head><meta charset="utf-8"><title>HireMe</title></head>
      <body style="margin:0;height:100vh;display:grid;place-items:center;background:#1d1c1a;color:#f4f2ed;font:16px -apple-system,sans-serif;">
        <p>Starting HireMe…</p>
      </body>
      </html>
      """,
      baseURL: nil
    )
  }

  private func startServerThenLoad() {
    runLauncher("open") { [weak self] status in
      guard let self else { return }
      if status == 0 {
        self.startedServer = true
        self.window.title = "HireMe"
        self.webView.load(URLRequest(url: localURL))
      } else {
        self.window.title = "HireMe"
        self.webView.loadHTMLString(
          """
          <!doctype html>
          <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#1d1c1a;color:#f4f2ed;font:16px -apple-system,sans-serif;">
          <p>HireMe didn't start. See ~/Library/Logs/HireMe.log.</p>
          </body></html>
          """,
          baseURL: nil
        )
      }
    }
  }

  @objc private func reloadPage() {
    if webView.url?.host == "127.0.0.1" || webView.url?.host == "localhost" {
      webView.reload()
    } else {
      webView.load(URLRequest(url: localURL))
    }
  }

  @objc private func updateHireMe() {
    updateItem?.isEnabled = false
    window.title = "Updating HireMe…"
    showStarting()
    runLauncher("update") { [weak self] status in
      guard let self else { return }
      self.updateItem?.isEnabled = true
      self.window.title = "HireMe"
      if status == 0 {
        self.webView.load(URLRequest(url: localURL))
      }
    }
  }

  private func runLauncher(_ mode: String, completion: @escaping (Int32) -> Void) {
    let process = Process()
    process.executableURL = launcherURL()
    process.arguments = [mode]
    process.environment = launcherEnvironment()
    process.terminationHandler = { process in
      DispatchQueue.main.async {
        completion(process.terminationStatus)
      }
    }
    do {
      try process.run()
    } catch {
      DispatchQueue.main.async { completion(1) }
    }
  }

  private func launcherURL() -> URL {
    Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/launcher")
  }

  private func launcherEnvironment() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    env["HIREME_NO_OPEN"] = "1"
    let node = "/opt/homebrew/opt/node@24/bin"
    let brew = "/opt/homebrew/bin"
    env["PATH"] = "\(node):\(brew):/usr/bin:/bin:/usr/sbin:/sbin"
    return env
  }

  private func isLocal(_ url: URL) -> Bool {
    guard let host = url.host?.lowercased() else { return false }
    return host == "127.0.0.1" || host == "localhost"
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.allow)
      return
    }
    if navigationAction.shouldPerformDownload {
      decisionHandler(.download)
      return
    }
    // Custom schemes (e.g. grokbot://) leave to the registered Mac app.
    if let scheme = url.scheme?.lowercased(),
       scheme != "http", scheme != "https", scheme != "about", scheme != "blob", scheme != "data", scheme != "file" {
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
      return
    }
    if navigationAction.navigationType == .linkActivated, !isLocal(url), url.scheme?.hasPrefix("http") == true {
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    if navigationResponse.canShowMIMEType {
      decisionHandler(.allow)
    } else {
      decisionHandler(.download)
    }
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
      ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Downloads")
    var destination = folder.appendingPathComponent(suggestedFilename)
    if FileManager.default.fileExists(atPath: destination.path) {
      let stem = destination.deletingPathExtension().lastPathComponent
      let ext = destination.pathExtension
      destination = folder.appendingPathComponent("\(stem)-\(Int(Date().timeIntervalSince1970)).\(ext)")
    }
    completionHandler(destination)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    guard let url = navigationAction.request.url else { return nil }
    // Popups that start as about:blank have no handler on macOS (Finder alert).
    if url.scheme == "about" || url.absoluteString == "about:blank" {
      return nil
    }
    if isLocal(url) {
      webView.load(navigationAction.request)
    } else {
      NSWorkspace.shared.open(url)
    }
    return nil
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.begin { response in
      completionHandler(response == .OK ? panel.urls : nil)
    }
  }
}

@main
enum HireMeMain {
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
  }
}
