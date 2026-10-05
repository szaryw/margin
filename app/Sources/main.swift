import AppKit
import Carbon.HIToolbox

// Margin: select text in any app (Books, a browser, a PDF reader…) and press ⌃⌥M. A card opens beside the selection
// to keep a note or ask about it. The app starts the Node server from the repo it was built in (see build.sh).

/// The local Node server (server/index.js), which stores highlights and talks to the model.
enum Server {
    static let base = URL(string: "http://127.0.0.1:4319")!
    static let root = Bundle.main.object(forInfoDictionaryKey: "MarginRoot") as? String
    static let node = Bundle.main.object(forInfoDictionaryKey: "MarginNode") as? String
    static let log = NSHomeDirectory() + "/Library/Logs/Margin.log"
    static let notRunning = "Margin’s server isn’t running. See \(log), or run “npm start” in the Margin folder."
    static var process: Process?

    static func isUp() async -> Bool {
        var r = URLRequest(url: base.appendingPathComponent("api/status"))
        r.timeoutInterval = 1
        return ((try? await URLSession.shared.data(for: r))?.1 as? HTTPURLResponse)?.statusCode == 200
    }

    /// Starts the server unless one is already running (e.g. `npm start` in a terminal), and waits for it.
    static func start() async {
        if await isUp() { return }
        guard let root, let node, FileManager.default.isExecutableFile(atPath: node) else { return }
        FileManager.default.createFile(atPath: log, contents: nil)
        let out = FileHandle(forWritingAtPath: log)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [root + "/server/index.js"]
        p.currentDirectoryURL = URL(fileURLWithPath: root)
        p.standardOutput = out
        p.standardError = out
        do { try p.run(); process = p } catch { return }
        for _ in 0..<50 where !(await isUp()) { try? await Task.sleep(nanoseconds: 100_000_000) }
    }

    static func request(_ method: String, _ path: String, body: Data?) async throws -> Data {
        var r = URLRequest(url: URL(string: base.absoluteString + "/api" + path)!)
        r.httpMethod = method
        r.setValue("1", forHTTPHeaderField: "X-Margin")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = body
        r.timeoutInterval = 15
        let data: Data, response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: r) }
        catch let error as URLError where [.cannotConnectToHost, .networkConnectionLost, .timedOut].contains(error.code) { throw CaptureError(notRunning) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw CaptureError((try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String ?? "Margin couldn’t save this highlight.")
        }
        return data
    }

    static func create(_ c: Capture) async throws -> String {
        let json = try JSONSerialization.jsonObject(with: try await request("POST", "/highlights", body: try JSONEncoder().encode(c))) as? [String: Any]
        guard let id = json?["id"] as? String else { throw CaptureError("Unexpected reply from Margin’s server.") }
        return id
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var panel: PanelController!
    var busy = false

    func applicationDidFinishLaunching(_ note: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "M"
        let menu = NSMenu()
        menu.addItem(withTitle: "Select text, then press ⌃⌥M", action: nil, keyEquivalent: "").isEnabled = false
        menu.addItem(.separator())
        menu.addItem(withTitle: "Show Highlights in Finder", action: #selector(revealFolder), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Open Server Log", action: #selector(openLog), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Margin", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
        NSApp.mainMenu = editMenu()

        let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(prompt)
        registerHotKey()
        // Lets scripts and launchers (Shortcuts, Raycast…) capture without the hotkey; see README.
        DistributedNotificationCenter.default().addObserver(forName: Notification.Name("dev.margin.capture"), object: nil, queue: .main) { _ in
            delegate.capture()
        }
        Task { @MainActor in
            await Server.start()
            panel = PanelController()
        }
    }

    func applicationWillTerminate(_ note: Notification) { Server.process?.terminate() }

    func capture() {
        guard !busy, let panel else { return }
        busy = true
        statusItem.button?.title = "M…"
        Task { @MainActor in
            defer { busy = false; statusItem.button?.title = "M" }
            do {
                // The selection is read (and copied, if need be) while the app being read is still in front.
                var (c, webArea) = try await Capturer.grab()
                panel.show()
                panel.open(nil)
                if let webArea { c.pageText = await Task.detached { Capturer.pageText(webArea) }.value }
                Capturer.tidy(&c)
                panel.open(try await Server.create(c))
            } catch {
                NSSound(named: "Basso")?.play()
                panel.show()
                panel.fail(error.localizedDescription)
            }
        }
    }

    @objc func revealFolder() { Task { _ = try? await Server.request("POST", "/reveal", body: nil) } }
    @objc func openLog() { NSWorkspace.shared.open(URL(fileURLWithPath: Server.log)) }

    /// Never shown (the app has no menu bar), but its shortcuts make copy, paste and undo work in the card.
    func editMenu() -> NSMenu {
        let main = NSMenu(), item = NSMenuItem(), edit = NSMenu(title: "Edit")
        item.submenu = edit
        main.addItem(item)
        for (title, action, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
                                     ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        return main
    }
}

func registerHotKey() {
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
        DispatchQueue.main.async { delegate.capture() }
        return noErr
    }, 1, &spec, nil, nil)
    var ref: EventHotKeyRef?
    let status = RegisterEventHotKey(UInt32(kVK_ANSI_M), UInt32(controlKey | optionKey), EventHotKeyID(signature: 0x4D52_474E, id: 1),
                                     GetApplicationEventTarget(), 0, &ref)
    if status != noErr {
        let alert = NSAlert()
        alert.messageText = "⌃⌥M is taken"
        alert.informativeText = "Another app already uses ⌃⌥M. Quit it and reopen Margin."
        alert.runModal()
    }
}

let delegate = AppDelegate()
let app = NSApplication.shared
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
