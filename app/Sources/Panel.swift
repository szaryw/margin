import AppKit
import WebKit

/// A borderless floating panel that can take typing without activating Margin Capture, so the app being read stays in front.
final class MarginPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

/// Takes the first click even while the card isn't the key window, so its buttons work on one click.
final class CardWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// Shows the card (server/card/card.html) beside the pointer. The page draws the card on a transparent window and
/// reports its height; the window follows it. The page is loaded once and driven through window.marginOpen /
/// marginFail / marginBlur; it answers through the `margin` message handler.
final class PanelController: NSObject, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    static let width: CGFloat = 420
    let panel: MarginPanel
    let web: CardWebView
    private var ready = false
    private var queued: [String] = []
    private var shown = 0   // counts show() calls, so a fade-out doesn't hide a card opened during it
    private var above = false   // placed above the pointer: grows upward from its bottom edge, so it never covers the selection
    private var dragMonitor: Any?

    override init() {
        let config = WKWebViewConfiguration()
        let frame = NSRect(x: 0, y: 0, width: Self.width, height: 150)
        web = CardWebView(frame: frame, configuration: config)
        panel = MarginPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        config.userContentController.add(self, name: "margin")
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = web
        panel.delegate = self
        load()
    }

    private func load() {
        ready = false
        web.load(URLRequest(url: Server.base.appendingPathComponent("card")))
    }

    private func run(_ js: String) {
        if ready { web.evaluateJavaScript(js); return }
        queued.append(js)
        if !web.isLoading { load() }
    }

    private static func literal(_ s: String) -> String {
        String(data: try! JSONEncoder().encode([s]), encoding: .utf8)!.dropFirst().dropLast().description
    }

    func open(_ id: String?) { run("window.marginOpen(\(id.map(Self.literal) ?? "null"))") }

    func fail(_ message: String) {
        if ready { web.evaluateJavaScript("window.marginFail(\(Self.literal(message)))"); return }
        queued = []
        ready = false
        let text = message.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        web.loadHTMLString("""
            <body style="margin:0;background:transparent;font:13px -apple-system">
            <div style="margin:0;padding:14px;border-radius:12px;background:Canvas;color:#c4453a;border:1px solid rgba(128,128,128,.3)">\(text)</div></body>
            """, baseURL: nil)
        resize(to: 70)
    }

    /// Shows the card beside the pointer (where the selection was just made), kept on screen. It starts small (the
    /// "Saving…" card) whatever size the last card grew to, goes below the pointer when there's room for a typical card
    /// and above it otherwise, and then grows away from the pointer as the page reports its height.
    func show() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        let area = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width = Self.width, height: CGFloat = 60, room: CGFloat = 260
        var x = mouse.x + 16
        if x + width > area.maxX { x = mouse.x - 16 - width }
        x = min(max(x, area.minX), area.maxX - width)
        above = mouse.y - 16 - area.minY < room && area.maxY - (mouse.y + 16) > mouse.y - 16 - area.minY
        let y = above ? min(mouse.y + 16, area.maxY - height) : max(mouse.y - 16 - height, area.minY)
        panel.setFrame(NSRect(x: x, y: y, width: width, height: height), display: false)
        shown += 1
        panel.alphaValue = 1
        panel.orderFrontRegardless()
        panel.makeKey()
        panel.makeFirstResponder(web)
    }

    /// Grows or shrinks the card away from the pointer (from its top edge below it, its bottom edge above it),
    /// sliding it along only when it would run off the screen.
    private func resize(to height: CGFloat) {
        let area = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let h = min(max(height, 40), area.height - 20)
        var frame = panel.frame
        let edge = above ? frame.minY : frame.maxY
        frame.size = NSSize(width: Self.width, height: h)
        frame.origin.y = above ? min(edge, area.maxY - 10 - h) : max(edge - h, area.minY + 10)
        panel.setFrame(frame, display: true)
        panel.invalidateShadow()
    }

    /// Moves the card with the mouse until the button is released. `grip` is where it was pressed, from the card's
    /// top-left corner (the page reports it a moment after the press, so the pointer's position then isn't used).
    /// A card that has been moved grows downward from its top edge, wherever it was put.
    private func drag(from grip: NSPoint) {
        guard NSEvent.pressedMouseButtons & 1 != 0, dragMonitor == nil else { return }
        above = false
        let follow = { [weak self] in
            guard let self else { return }
            let mouse = NSEvent.mouseLocation
            self.panel.setFrameOrigin(NSPoint(x: mouse.x - grip.x, y: mouse.y + grip.y - self.panel.frame.height))
        }
        follow()
        dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { [weak self] event in
            follow()
            if event.type == .leftMouseUp, let self, let monitor = self.dragMonitor {
                NSEvent.removeMonitor(monitor)
                self.dragMonitor = nil
            }
            return event
        }
    }

    private func hide() {
        let generation = shown
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.18
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            guard let self, self.shown == generation else { return }
            self.panel.orderOut(nil)
            self.panel.alphaValue = 1
        })
    }

    // Clicking back into what you were reading: the page closes an untouched card and keeps one you're typing in.
    func windowDidResignKey(_ notification: Notification) {
        if ready { web.evaluateJavaScript("window.marginBlur()") }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true
            queued.forEach { web.evaluateJavaScript($0) }
            queued = []
        case "close":
            hide()
        case "resize":
            if let h = body["height"] as? Double { resize(to: CGFloat(h)) }
        case "drag":
            if let x = body["x"] as? Double, let y = body["y"] as? Double { drag(from: NSPoint(x: x, y: y)) }
        case "open":
            if let s = body["url"] as? String, let url = URL(string: s), ["http", "https"].contains(url.scheme) { NSWorkspace.shared.open(url) }
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { ready = false }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if !queued.isEmpty { fail(Server.notRunning) }
    }

    // Links in answers open in the browser, never inside the card.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated, let url = action.request.url {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }
}
