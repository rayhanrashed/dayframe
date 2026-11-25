import AppKit
import Foundation
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private let targetUrl: String

    init(targetUrl: String) {
        self.targetUrl = targetUrl
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()
        setupStatusItem()
        setupWindow()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Closing the window hides Dayframe to the macOS menu bar instead of losing the session!
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            showWindow()
        }
        return true
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    private func setupMainMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)

        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "Show Dayframe",
            action: #selector(showWindow),
            keyEquivalent: "1"
        )
        appMenu.addItem(
            withTitle: "Stop AI Models (0 MB RAM)",
            action: #selector(stopModelsNow),
            keyEquivalent: "k"
        )
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(
            withTitle: "Quit Dayframe Completely",
            action: #selector(quitEverything),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu
        NSApp.mainMenu = mainMenu
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "◷ Dayframe"

        let menu = NSMenu()
        menu.addItem(
            withTitle: "Open Dayframe Window",
            action: #selector(showWindow),
            keyEquivalent: ""
        )
        menu.addItem(
            withTitle: "Unload & Stop AI Models (0 MB)",
            action: #selector(stopModelsNow),
            keyEquivalent: ""
        )
        menu.addItem(NSMenuItem.separator())
        menu.addItem(
            withTitle: "Quit Dayframe & Background Daemon",
            action: #selector(quitEverything),
            keyEquivalent: "q"
        )
        statusItem.menu = menu
    }

    private func setupWindow() {
        let rect = NSRect(x: 0, y: 0, width: 1380, height: 860)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = "Dayframe"
        window.delegate = self

        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: rect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        window.contentView = webView

        if let url = URL(string: targetUrl) {
            webView.load(URLRequest(url: url))
        }
        window.makeKeyAndOrderFront(nil)
    }

    @objc private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func stopModelsNow() {
        let tokenPath = (NSHomeDirectory() as NSString).appendingPathComponent(".dayframe-bridge-token")
        guard let token = try? String(contentsOfFile: tokenPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
              let url = URL(string: "http://127.0.0.1:43822/api/models/sleep-ollama") else {
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = Data("{}".utf8)
        URLSession.shared.dataTask(with: req).resume()
    }

    @objc private func quitEverything() {
        let tokenPath = (NSHomeDirectory() as NSString).appendingPathComponent(".dayframe-bridge-token")
        if let token = try? String(contentsOfFile: tokenPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           let url = URL(string: "http://127.0.0.1:43822/api/system/shutdown") {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let sem = DispatchSemaphore(value: 0)
            URLSession.shared.dataTask(with: req) { _, _, _ in sem.signal() }.resume()
            _ = sem.wait(timeout: .now() + 1.5)
        }
        NSApp.terminate(nil)
    }
}

let urlArg = CommandLine.arguments.dropFirst().first ?? "http://127.0.0.1:43820"
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate(targetUrl: urlArg)
app.delegate = delegate
app.run()
