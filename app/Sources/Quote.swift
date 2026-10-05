import Foundation

/// Tidies a selected passage before it's saved. Apps hand over selections with invisible characters (zero-width spaces
/// on news sites), Windows line endings and hard line breaks (PDF viewers), words run together (some PDFs in Preview)
/// and half words at the edges (a drag that stopped mid-word). The reference (the page's text, or what OCR saw) shows
/// how the words are really spaced and where they end. It's only used where it matches the quote exactly, so a
/// recognition slip elsewhere can't change the quote.
enum Quote {
    static let invisible: Set<Unicode.Scalar> = ["\u{200B}", "\u{200C}", "\u{200D}", "\u{2060}", "\u{FEFF}", "\u{00AD}", "\u{FFFC}"]

    static func clean(_ raw: String, reference: String?, unwrap: Bool) -> String {
        var s = String(String.UnicodeScalarView(raw.unicodeScalars.filter { !invisible.contains($0) }))
        s = s.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var words: [String] = [], startsLine: [Bool] = []
        for line in (reference ?? "").split(whereSeparator: \.isNewline) {
            for (k, w) in line.split(whereSeparator: \.isWhitespace).enumerated() { words.append(String(w)); startsLine.append(k == 0) }
        }
        let vocab = Set(words)
        var at: [String: [Int]] = [:]
        for (i, w) in words.enumerated() { at[w, default: []].append(i) }

        // Paragraphs are separated by a blank line, or (in a web page) by any line break. Inside one, a line break from
        // the page's layout becomes a space, and a word hyphenated across it is re-joined.
        let blocks = unwrap ? s.components(separatedBy: "\n\n") : s.components(separatedBy: "\n")
        let paragraphs = blocks.map { block -> String in
            var text = ""
            for line in block.split(separator: "\n", omittingEmptySubsequences: true).map({ $0.trimmingCharacters(in: .whitespaces) }) {
                if text.hasSuffix("-"), let next = line.first, next.isLowercase, text.dropLast().last?.isLetter == true {
                    let before = text.split(separator: " ").last.map(String.init) ?? "", after = line.split(separator: " ").first.map(String.init) ?? ""
                    if !vocab.contains(before + after) { text.removeLast() }   // keep "beefed-up" when the page has it that way
                } else if !text.isEmpty { text += " " }
                text += line
            }
            var tokens = text.split(whereSeparator: \.isWhitespace).map(String.init)
            tokens = tokens.flatMap { respace($0, words: words, startsLine: startsLine, vocab: vocab, at: at) }
            return tokens.joined(separator: " ")
        }.filter { !$0.isEmpty }

        // Half words at the edges, completed from the page.
        var tokens = paragraphs.joined(separator: "\n").split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        if !tokens.isEmpty {
            tokens[0] = complete(tokens[0], next: tokens.count > 1 ? tokens[1] : nil, words: words, vocab: vocab, atStart: true)
            let last = tokens.count - 1
            tokens[last] = complete(tokens[last], next: last > 0 ? tokens[last - 1] : nil, words: words, vocab: vocab, atStart: false)
        }
        var out = tokens.joined(separator: " ").replacingOccurrences(of: " \n", with: "\n").replacingOccurrences(of: "\n ", with: "\n")
        // A stray mark left over from the previous sentence: ". Investment-grade…"
        if let r = out.range(of: #"^[.,;:!?)\]]+\s+"#, options: .regularExpression) { out.removeSubrange(r) }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Splits words run together ("Thesestructuresexpand") into the words the page has in that order, on one line: a
    /// line ending in the page ("cattle—" / "vendors") isn't a space.
    static func respace(_ token: String, words: [String], startsLine: [Bool], vocab: Set<String>, at: [String: [Int]]) -> [String] {
        guard !vocab.isEmpty, token.count > 3, !vocab.contains(token) else { return [token] }
        for k in 1..<token.count {
            for start in at[String(token.prefix(k))] ?? [] {
                var joined = "", run: [String] = []
                for (j, w) in words[start..<min(words.count, start + 8)].enumerated() {
                    if j > 0 && startsLine[start + j] { break }
                    joined += w
                    run.append(w)
                    if joined == token { return run }
                    if !token.hasPrefix(joined) { break }
                }
            }
        }
        return [token]
    }

    /// Completes a word cut off at the start or end of the quote ("Łochó" → "Łochów"), when the page has exactly one
    /// such word next to the quote's neighbouring word. Only letters are added.
    static func complete(_ token: String, next: String?, words: [String], vocab: Set<String>, atStart: Bool) -> String {
        guard !vocab.isEmpty, !vocab.contains(token), !token.isEmpty,
              (atStart ? token.first : token.last)?.isLetter == true else { return token }
        var found = Set<String>()
        for (i, w) in words.enumerated() where w.count > token.count && (atStart ? w.hasSuffix(token) : w.hasPrefix(token)) {
            if let next {
                let neighbour = atStart ? (i + 1 < words.count ? words[i + 1] : nil) : (i > 0 ? words[i - 1] : nil)
                guard neighbour == next else { continue }
            }
            let extra = atStart ? String(w.dropLast(token.count).reversed().prefix { $0.isLetter }.reversed())
                                : String(w.dropFirst(token.count).prefix { $0.isLetter })
            if !extra.isEmpty { found.insert(atStart ? extra + token : token + extra) }
        }
        return found.count == 1 ? found.first! : token
    }
}
