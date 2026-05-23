import Cocoa
import Foundation
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var dragStartMouse: NSPoint?
    private var dragStartWindow: NSPoint?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: 390, height: 390)
        let origin = NSPoint(
            x: screenFrame.maxX - size.width - 28,
            y: screenFrame.minY + 28
        )

        window = NSWindow(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isMovableByWindowBackground = true

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "petDrag")
        webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")

        window.contentView = webView
        window.orderFront(nil)
        window.orderFrontRegardless()

        let env = ProcessInfo.processInfo.environment
        let port = env["CLAUDE_PET_PORT"] ?? "37421"
        let page = env["CLAUDE_PET_DESKTOP_URL"] ?? "http://127.0.0.1:\(port)/desktop.html"
        if let url = URL(string: page) {
            webView.load(URLRequest(url: url))
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "petDrag",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String
        else { return }

        switch type {
        case "start":
            dragStartMouse = NSEvent.mouseLocation
            dragStartWindow = window.frame.origin
        case "move":
            guard let startMouse = dragStartMouse,
                  let startWindow = dragStartWindow
            else { return }
            let mouse = NSEvent.mouseLocation
            let nextOrigin = NSPoint(
                x: startWindow.x + mouse.x - startMouse.x,
                y: startWindow.y + mouse.y - startMouse.y
            )
            window.setFrameOrigin(nextOrigin)
        case "end":
            dragStartMouse = nil
            dragStartWindow = nil
        case "close":
            if let projectRoot = ProcessInfo.processInfo.environment["CLAUDE_PET_ROOT"] {
                let pidPath = URL(fileURLWithPath: projectRoot)
                    .appendingPathComponent(".build")
                    .appendingPathComponent("robot-pet-overlay.pid")
                let legacyPidPath = URL(fileURLWithPath: projectRoot)
                    .appendingPathComponent(".build")
                    .appendingPathComponent("claude-pet.pid")
                try? FileManager.default.removeItem(at: pidPath)
                try? FileManager.default.removeItem(at: legacyPidPath)
            }
            NSApp.terminate(nil)
        default:
            break
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
