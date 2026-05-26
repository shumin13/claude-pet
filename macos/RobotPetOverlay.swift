import Cocoa
import Foundation
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var dragStartMouse: NSPoint?
    private var dragStartWindow: NSPoint?
    private var hitRegions: [NSRect] = []
    private var globalMouseMonitor: Any?
    private var localMouseMonitor: Any?
    private let defaultSize = NSSize(width: 420, height: 520)

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = defaultSize
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
        window.acceptsMouseMovedEvents = true

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

        installMouseMonitors()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "petDrag",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String
        else { return }

        switch type {
        case "resizeWindow":
            guard let width = numberValue(body["width"]),
                  let height = numberValue(body["height"])
            else { return }
            resizeWindow(width: width, height: height)
        case "hitRegions":
            guard let regions = body["regions"] as? [[String: Any]] else { return }
            updateHitRegions(regions, viewportHeight: numberValue(body["viewportHeight"]))
        case "start":
            window.ignoresMouseEvents = false
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
            updateMousePassthrough()
        case "end":
            dragStartMouse = nil
            dragStartWindow = nil
            updateMousePassthrough()
        case "close":
            let env = ProcessInfo.processInfo.environment
            if let buildDir = env["CLAUDE_PET_BUILD_DIR"] {
                let pidPath = URL(fileURLWithPath: buildDir)
                    .appendingPathComponent("robot-pet-overlay.pid")
                try? FileManager.default.removeItem(at: pidPath)
            }
            if let projectRoot = env["CLAUDE_PET_ROOT"] {
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

    private func resizeWindow(width: Double, height: Double) {
        let nextSize = NSSize(
            width: max(defaultSize.width, ceil(width)),
            height: max(defaultSize.height, ceil(height))
        )
        let currentFrame = window.frame
        let nextOrigin = NSPoint(
            x: currentFrame.maxX - nextSize.width,
            y: currentFrame.minY
        )
        window.setFrame(NSRect(origin: nextOrigin, size: nextSize), display: true)
        updateMousePassthrough()
    }

    private func updateHitRegions(_ regions: [[String: Any]], viewportHeight: Double?) {
        let height = viewportHeight ?? Double(webView.bounds.height)
        hitRegions = regions.compactMap { region in
            guard let x = numberValue(region["x"]),
                  let y = numberValue(region["y"]),
                  let width = numberValue(region["width"]),
                  let heightValue = numberValue(region["height"]),
                  width > 0,
                  heightValue > 0
            else { return nil }

            return NSRect(
                x: x,
                y: height - y - heightValue,
                width: width,
                height: heightValue
            )
        }
        updateMousePassthrough()
    }

    private func numberValue(_ value: Any?) -> Double? {
        if let double = value as? Double {
            return double
        }
        if let number = value as? NSNumber {
            return number.doubleValue
        }
        return nil
    }

    private func installMouseMonitors() {
        globalMouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] _ in
            self?.updateMousePassthrough()
        }
        localMouseMonitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] event in
            self?.updateMousePassthrough()
            return event
        }
    }

    private func updateMousePassthrough() {
        guard window != nil else { return }
        if dragStartMouse != nil {
            window.ignoresMouseEvents = false
            return
        }

        let screenPoint = NSEvent.mouseLocation
        guard window.frame.contains(screenPoint) else {
            window.ignoresMouseEvents = true
            return
        }

        let windowPoint = NSPoint(
            x: screenPoint.x - window.frame.minX,
            y: screenPoint.y - window.frame.minY
        )
        window.ignoresMouseEvents = !hitRegions.contains { $0.contains(windowPoint) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
