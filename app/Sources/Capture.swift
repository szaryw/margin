import AppKit
import ApplicationServices
import Carbon.HIToolbox

struct CaptureError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

struct Book: Codable { var title: String; var author: String? }

/// What Margin sends the server about a selection.
struct Capture: Codable {
    var app: String
    var bundleID: String
    var windowTitle: String?
    var document: String?    // a file URL, in document apps like Preview
    var url: String?         // browsers: the page's address
    var pageTitle: String?
    var pageText: String?    // browsers: the page's text, so the model sees what the passage is part of
    var context: String?     // other apps: the text around the selection, when the app exposes it
    var book: Book?          // Apple Books: from the citation it adds to copied text
    var quote: String?
}

/// Reads the selection through Accessibility. Apps that don't expose it (Apple Books, some PDF viewers) are asked to
/// copy it with their own Edit ▸ Copy, and the clipboard is put back afterwards.
enum Capturer {
    static let booksBundleID = "com.apple.iBooksX"
    static let browsers: Set<String> = ["com.apple.Safari", "com.apple.SafariTechnologyPreview", "org.mozilla.firefox", "com.google.Chrome",
                                        "company.thebrowser.Browser", "com.brave.Browser", "com.microsoft.edgemac", "com.vivaldi.Vivaldi",
                                        "com.operasoftware.Opera", "com.google.chrome.for.testing"]
    // Chromium browsers only build their accessibility tree when asked to.
    static let chromium: Set<String> = ["com.google.Chrome", "company.thebrowser.Browser", "com.brave.Browser", "com.microsoft.edgemac",
                                        "com.vivaldi.Vivaldi", "com.operasoftware.Opera", "com.google.chrome.for.testing"]

    /// The selection and where it's from. Runs before the card appears, so the app being read is still in front.
    /// Also returns the browser's web area, whose full text is read afterwards (it can take a moment).
    static func grab() async throws -> (Capture, AXUIElement?) {
        guard AXIsProcessTrusted() else {
            throw CaptureError("Margin needs Accessibility access to read your selection. Turn it on in System Settings ▸ Privacy & Security ▸ Accessibility, then quit and reopen Margin.")
        }
        guard let front = NSWorkspace.shared.frontmostApplication else { throw CaptureError("No app is in front.") }
        var c = Capture(app: front.localizedName ?? "App", bundleID: front.bundleIdentifier ?? "")
        let app = AXUIElementCreateApplication(front.processIdentifier)
        if chromium.contains(c.bundleID) { AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue) }

        var window: AXUIElement?, focused: AXUIElement?, selected: String?
        if let w = attr(app, kAXFocusedWindowAttribute) {
            window = (w as! AXUIElement)
            c.windowTitle = attr(window!, kAXTitleAttribute) as? String
            // A file URL in document apps; browsers put the page's address here too.
            let document = attr(window!, kAXDocumentAttribute) as? String
            c.document = document.flatMap { $0.hasPrefix("file://") ? $0 : nil }
            c.url = document.flatMap { $0.hasPrefix("http") ? $0 : nil }
        }
        if let f = attr(app, kAXFocusedUIElementAttribute) {
            focused = (f as! AXUIElement)
            selected = nonEmpty(attr(focused!, kAXSelectedTextAttribute) as? String)
            c.context = surroundingText(focused!)
        }
        let area = webArea(focused: focused, window: browsers.contains(c.bundleID) ? window : nil)
        if let area {
            // Browsers keep the page's selection on the web area, not on the focused element.
            if selected == nil { selected = selectedText(inWebArea: area) }
            c.url = pageURL(area) ?? c.url
            if c.url != nil {
                c.pageTitle = [attr(area, kAXTitleAttribute), attr(area, kAXDescriptionAttribute)].compactMap { nonEmpty($0 as? String) }.first
            }
        }

        // Copy when Accessibility found nothing, and always in Books, whose copy carries the title and author.
        // A greyed-out Copy means nothing is selected.
        var copied: String?
        if c.bundleID == booksBundleID || selected == nil {
            let item = copyMenuItem(app)
            if let item, (attr(item, kAXEnabledAttribute) as? Bool) == false {
                throw CaptureError("Select some text first, then press ⌃⌥M.")
            }
            copied = await copySelection(menuItem: item)
        }
        if let copied, let parsed = parseBooksCitation(copied) {
            c.book = parsed.book
            c.quote = parsed.quote
        } else {
            c.quote = selected ?? nonEmpty(copied)
        }
        if c.book == nil, c.bundleID == booksBundleID, let title = c.windowTitle { c.book = Book(title: title, author: nil) }
        guard c.quote != nil else { throw CaptureError("Margin couldn’t read a selection in \(c.app). Select some text first, then press ⌃⌥M.") }
        return (c, c.url == nil ? nil : area)
    }

    /// Tidies the quote: invisible characters, hard line breaks from PDF layouts, half words at the edges. Books marks a
    /// shortened copy with "[…]", which is dropped.
    static func tidy(_ c: inout Capture) {
        guard var q = c.quote else { return }
        if let r = q.range(of: #"\s*\[(…|\.\.\.)\]$"#, options: .regularExpression) { q.removeSubrange(r) }
        let pdf = c.url.flatMap(URL.init(string:))?.pathExtension.lowercased() == "pdf"
        c.quote = Quote.clean(q, reference: c.pageText ?? c.context, unwrap: c.url == nil || pdf || q.contains("\r"))
    }

    static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return s
    }

    // MARK: Accessibility

    static func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
    }

    static func children(_ el: AXUIElement) -> [AXUIElement] {
        (attr(el, kAXChildrenAttribute) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
    }

    /// The browser's web area holding the page: an ancestor of the focused element, or else (in browsers) the largest
    /// one in the window, since pages can sit beside hidden, preloaded ones.
    static func webArea(focused: AXUIElement?, window: AXUIElement?) -> AXUIElement? {
        var el = focused
        for _ in 0..<60 {
            guard let e = el else { break }
            if (attr(e, kAXRoleAttribute) as? String) == "AXWebArea" { return e }
            el = attr(e, kAXParentAttribute).map { $0 as! AXUIElement }
        }
        guard let window else { return nil }
        var queue = [window], i = 0, areas: [AXUIElement] = []
        while i < queue.count && i < 3000 {
            let e = queue[i]
            i += 1
            if (attr(e, kAXRoleAttribute) as? String) == "AXWebArea" { areas.append(e); continue }
            queue.append(contentsOf: children(e))
        }
        func size(_ e: AXUIElement) -> CGFloat {
            guard let v = attr(e, kAXSizeAttribute), CFGetTypeID(v) == AXValueGetTypeID() else { return 0 }
            var s = CGSize.zero
            return AXValueGetValue(v as! AXValue, .cgSize, &s) ? s.width * s.height : 0
        }
        return areas.max { size($0) < size($1) }
    }

    static func selectedText(inWebArea area: AXUIElement) -> String? {
        guard let range = attr(area, "AXSelectedTextMarkerRange") else { return nil }
        var string: AnyObject?
        guard AXUIElementCopyParameterizedAttributeValue(area, "AXStringForTextMarkerRange" as CFString, range, &string) == .success else { return nil }
        return nonEmpty(string as? String)
    }

    static func pageURL(_ area: AXUIElement) -> String? {
        guard let u = attr(area, kAXURLAttribute) else { return nil }
        let s = (u as? URL)?.absoluteString ?? (u as? String)
        return s?.hasPrefix("http") == true ? s : nil
    }

    /// The page's text as the browser has it (pages you're logged into included), paragraphs on their own lines.
    static func pageText(_ area: AXUIElement) -> String? {
        let names = [kAXRoleAttribute, kAXValueAttribute, kAXChildrenAttribute] as CFArray
        let blocks: Set<String> = ["AXGroup", "AXHeading", "AXParagraph", "AXList", "AXListItem", "AXTable", "AXRow", "AXCell",
                                   "AXArticle", "AXSection", "AXLandmarkMain", "AXBlockquote", "AXDocument"]
        var lines: [String] = [], line = "", visited = 0
        let deadline = Date().addingTimeInterval(2)
        func flush() {
            let t = line.replacingOccurrences(of: "\u{FFFC}", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { lines.append(t) }
            line = ""
        }
        func walk(_ e: AXUIElement, _ depth: Int) {
            guard visited < 40000, depth < 200, Date() < deadline else { return }
            visited += 1
            var values: CFArray?
            guard AXUIElementCopyMultipleAttributeValues(e, names, [], &values) == .success, let v = values as? [AnyObject], v.count == 3 else { return }
            let role = v[0] as? String ?? ""
            if role == "AXStaticText" { if let text = v[1] as? String { line += text }; return }
            if ["AXImage", "AXButton", "AXPopUpButton", "AXTextField"].contains(role) { return }
            let block = blocks.contains(role)
            if block { flush() }
            for child in (v[2] as? [AnyObject] ?? []) { walk(child as! AXUIElement, depth + 1) }
            if block { flush() }
        }
        walk(area, 0)
        flush()
        return lines.isEmpty ? nil : lines.joined(separator: "\n")
    }

    /// Up to ~800 characters either side of the selection, for text views that expose their whole text.
    static func surroundingText(_ el: AXUIElement) -> String? {
        guard let text = attr(el, kAXValueAttribute) as? String, let rv = attr(el, kAXSelectedTextRangeAttribute),
              CFGetTypeID(rv) == AXValueGetTypeID() else { return nil }
        var range = CFRange()
        guard AXValueGetValue(rv as! AXValue, .cfRange, &range), range.length > 0 else { return nil }
        let ns = text as NSString
        guard ns.length > range.length else { return nil }
        let start = max(0, range.location - 800), end = min(ns.length, range.location + range.length + 800)
        return ns.substring(with: NSRange(location: start, length: end - start))
    }

    /// The app's own Edit ▸ Copy (⌘C) menu item.
    static func copyMenuItem(_ app: AXUIElement) -> AXUIElement? {
        guard let bar = attr(app, kAXMenuBarAttribute) else { return nil }
        for top in children(bar as! AXUIElement) {
            for menu in children(top) {
                for item in children(menu) where (attr(item, kAXMenuItemCmdCharAttribute) as? String) == "C"
                    && (attr(item, kAXMenuItemCmdModifiersAttribute) as? Int ?? -1) == 0 {
                    return item
                }
            }
        }
        return nil
    }

    // MARK: Clipboard

    /// Copies the frontmost app's selection, returns its text, and puts the previous clipboard back. Pressing the app's
    /// own Copy item is reliable; ⌘C is the fallback, sent once the hotkey's ⌃⌥ are released.
    static func copySelection(menuItem: AXUIElement?) async -> String? {
        let pb = NSPasteboard.general
        let saved: [[NSPasteboard.PasteboardType: Data]] = (pb.pasteboardItems ?? []).map { item in
            Dictionary(uniqueKeysWithValues: item.types.compactMap { t in item.data(forType: t).map { (t, $0) } })
        }
        let before = pb.changeCount
        func copied(within seconds: Double) async -> Bool {
            for _ in 0..<Int(seconds * 20) {
                if pb.changeCount != before { return true }
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
            return pb.changeCount != before
        }
        var ok = false
        if let menuItem, AXUIElementPerformAction(menuItem, kAXPressAction as CFString) == .success { ok = await copied(within: 0.6) }
        if !ok {
            for _ in 0..<40 {
                let flags = CGEventSource.flagsState(.combinedSessionState)
                if !flags.contains(.maskControl) && !flags.contains(.maskAlternate) { break }
                try? await Task.sleep(nanoseconds: 25_000_000)
            }
            let src = CGEventSource(stateID: .combinedSessionState)
            for down in [true, false] {
                let e = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: down)
                e?.flags = .maskCommand
                e?.post(tap: .cghidEventTap)
            }
            ok = await copied(within: 1)
        }
        guard ok else { return nil }
        let text = pb.string(forType: .string)
        pb.clearContents()
        let items = saved.map { types -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (t, d) in types { item.setData(d, forType: t) }
            return item
        }
        if !items.isEmpty { pb.writeObjects(items) }
        return text
    }

    /// Books copies as: “quote” \n\n Excerpt From \n Title \n Author \n [link] \n This material may be protected by copyright.
    static func parseBooksCitation(_ s: String) -> (quote: String, book: Book)? {
        guard let r = s.range(of: #"\n\s*Excerpt From\s*\n"#, options: .regularExpression) else { return nil }
        var quote = String(s[..<r.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        for (open, close) in [("“", "”"), ("\"", "\"")] where quote.hasPrefix(open) && quote.hasSuffix(close) && quote.count >= 2 {
            quote = String(quote.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
            break
        }
        if quote.hasPrefix("“") && !quote.contains("”") { quote.removeFirst() }
        let lines = s[r.upperBound...].split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("http") && !$0.localizedCaseInsensitiveContains("protected by copyright") }
        guard let title = lines.first else { return nil }
        return (quote, Book(title: title, author: lines.count > 1 ? lines[1] : nil))
    }
}
