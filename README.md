# Margin

**Ask about what you're reading, right where you're reading it.**

A question pops into your head halfway through a paragraph. Select the passage, press **⌃⌥M**, and a small card opens right beside it, in Chrome, Apple Books, Preview or almost any other Mac app. Jot a note, or ask a question and get an answer that already knows what you're reading. No copying into a chat window, no switching apps, and you never lose your place.

![Margin answering a question about a highlighted passage in a Nieman Lab story, right beside the text](docs/screenshots/02-ask.png)

- **Works where you already read.** Browsers, Apple Books, PDFs, Notes: if you can select the text, Margin can pick it up.
- **Answers in context.** The model sees the passage, the page around it, and the book or article it came from. When that isn't enough, it can search the web.
- **Notes you own.** Everything you keep lands in plain Markdown, one file per book or article. Point the folder at your Obsidian vault and your highlights show up there.

---

## What you need

- macOS 14 or later
- [Node.js](https://nodejs.org) 20 or later (`node -v`)
- Xcode Command Line Tools, for `swiftc` (`xcode-select --install`)
- An OpenAI API key **or** a ChatGPT Plus/Pro plan. Notes work without either.

Margin has no npm dependencies, so there's no `npm install` step.

## Setup

Setup takes about five minutes.

### 1. Get the code

```sh
git clone https://github.com/szaryw/margin.git
cd margin
cp .env.example .env
```

### 2. Connect a model (pick one)

**Option A: an OpenAI API key.** Put it in `.env`:

```sh
OPENAI_API_KEY=sk-...
```

**Option B: your ChatGPT plan.** Leave the key empty and sign in once:

```sh
npm run login
```

Your browser opens ChatGPT's consent page. Sign in and allow Margin to use your plan. The terminal then confirms it:

```
Opening ChatGPT in your browser. Sign in and allow Margin to use your plan.

Signed in as you@example.com. Margin will use your ChatGPT plan.
```

The sign-in is saved in `.auth/chatgpt.json`, which is git-ignored and readable only by you. `npm run logout` signs out.

If both are set, the API key is used.

### 3. Build and open the app

```sh
sh app/build.sh
open app/build/Margin.app
```

An **M** appears in the menu bar. macOS asks for **Accessibility** access, which Margin needs to read what you've selected. Turn it on in **System Settings ▸ Privacy & Security ▸ Accessibility**, then quit Margin from its menu and open it again.

The app starts Margin's local server for you, using this folder and your `.env`. Server output goes to `~/Library/Logs/Margin.log`.

> **Rebuilding?** macOS links the Accessibility permission to the app's signature. Ad-hoc builds lose it on every rebuild. For a signature that stays the same between builds, create a self-signed certificate once: open Keychain Access, choose **Certificate Assistant ▸ Create a Certificate…**, name it `Margin Local Signing`, and set Identity Type to *Self Signed Root* and Certificate Type to *Code Signing*. `build.sh` uses it automatically.

To start Margin when you log in, add `Margin.app` in **System Settings ▸ General ▸ Login Items**.

## Using it

### Select, then ⌃⌥M

Select some text and press **⌃⌥M**. The card opens next to your selection and already knows where the text is from. Nothing is saved until you say so:

| You press | What happens |
|---|---|
| **↩** on the empty box | Saves just the highlight |
| Type a note, **↩** | Saves the highlight with your note |
| Type a question, **⌘↩** | Saves it and asks the model; the card becomes a conversation |
| **Esc**, or click back into the page | Closes the card and discards the highlight |

### Walkthrough

Every screenshot here is real: real selections, real typed questions, live answers.

**1. A news story.** You're reading a [Nieman Lab piece](https://www.niemanlab.org/2026/05/sam-altman-backs-micropayment-model-for-ai-agents-to-compensate-publishers/) about AI agents paying publishers per read, and you wonder whether those pennies could ever add up. Select the sentence and press ⌃⌥M:

![The Margin card opening next to the selected sentence](docs/screenshots/01-card.png)

Ask *"Could agent micropayments ever add up to an $80 subscription?"* with ⌘↩, and the card turns into the conversation at the top of this page. The answer works from the article's own numbers, because Margin sent the page around the passage along with your question ([what gets sent](#what-the-model-sees-when-you-ask)). Sources it looked up appear as links underneath.

**2. A book.** In Tim Wu's *The Age of Extraction* in Apple Books, a line about "neutrality rules for platforms" begs the obvious next question: *"What would neutrality rules look like for AI platforms?"* Margin already knows the book and its author, so you don't have to explain where the quote came from. Keep the conversation going with follow-ups in the same card.

![Asking about a passage in The Age of Extraction in Apple Books](docs/screenshots/03-books.png)

**3. A PDF.** Not every thought needs an answer. Reading O'Reilly, Strauss & Mazzucato's paper [*Algorithmic attention rents*](https://doi.org/10.1017/dap.2024.1) in Preview, select the sentence on disclosure, type a quick note linking it back to Wu, and press **↩**. Saved, and you're back to reading.

![Writing a note on a sentence in a PDF open in Preview](docs/screenshots/04-pdf.png)

### Your notes

Everything you keep ends up in one Markdown file per book or article, in `~/Documents/Margin` (or the folder in `MARGIN_DIR`). Each file collects every highlight, note and conversation for that source, oldest first. You get a reading log that writes itself:

![The Markdown file Margin wrote for the Nieman Lab story, open in iA Writer](docs/screenshots/05-notes.png)

```markdown
# Algorithmic attention rents a theory of digital platform market power

*/Users/you/Downloads/algorithmic-attention-rents-a-theory-of-digital-platform-market-power.pdf*

## 5 Oct 2026, 20:44

> We argue that regulations should mandate the disclosure of the operating metrics that platforms use to allocate user attention and shape the "free" side of their marketplace, as well as details on how that attention is monetized.

*Note:* Disclosure as the remedy: compare Wu's neutrality rules. Which metrics exactly?
```

Margin also keeps a JSON copy of each highlight in a hidden `.margin/` subfolder, for itself. You can edit or move the Markdown files, but Margin rewrites a source's file whenever you add to that source.

Choose **Show Highlights in Finder** from the menu-bar **M** to open the folder.

## Where it reads text from

| App | How the selection is read | Source shown as |
|---|---|---|
| Safari, Chrome, Arc, Brave, Edge | Accessibility (no clipboard) | Page title + URL |
| Apple Books | Books' own Copy, after which your clipboard is put back | Book title + author |
| Preview and other PDF apps | Accessibility, or the app's Copy | File name, tidied |
| Notes, TextEdit, most other apps | Accessibility, or the app's Copy | Window title |

## Settings

Set these in `.env`. Restart Margin after changing them.

| Setting | Default | |
|---|---|---|
| `OPENAI_API_KEY` | empty | Use an API key instead of the ChatGPT sign-in |
| `MARGIN_MODEL` | first model your plan lists, or `gpt-5.5` with a key | Which model answers |
| `MARGIN_WEB_SEARCH` | `on` | Let answers search the web |
| `MARGIN_DIR` | `~/Documents/Margin` | Where the Markdown notes go |

## What the model sees when you ask

Nothing leaves your Mac when you save a highlight or a note. When you ask a question, Margin sends OpenAI:

- **The passage you selected**, tidied up (stray line breaks and hyphens from PDFs removed).
- **Where it's from:** the kind of source, its title, the author for books, the URL for web pages, and the app's name. For a PDF, only the tidied file name is sent, never the path on your Mac.
- **Your note**, if you wrote one.
- **The conversation so far** in that card, so follow-ups make sense.
- **Text around the passage**, when the app makes it available:

| Reading in | Text around the passage |
|---|---|
| Safari, Chrome, Arc, Brave, Edge | About 6,000 characters of the page around your selection, read from the page your browser has open (pages you're logged into included) |
| Notes, TextEdit and other apps that expose their text | Up to about 800 characters either side of the selection |
| Apple Books, Preview and most PDF apps | None: just the passage, plus the title and author or the file name |

The model can also search the web when your question goes beyond the source (turn this off with `MARGIN_WEB_SEARCH=off`). It decides what to search for, and the pages it used show as links under the answer.

Nothing else is sent: no screenshots, other tabs, clipboard contents, the rest of the book or document, or your other highlights. Each question is sent with `store: false`, so OpenAI doesn't save the response for later retrieval, and the conversation won't appear in your ChatGPT history.

## Privacy

- The server only listens on `127.0.0.1:4319`. It rejects requests from other sites and other host names.
- Nothing leaves your Mac until you ask a question; [what the model sees](#what-the-model-sees-when-you-ask) lists exactly what's sent then.
- Notes stay in your folder. Margin has no account or sync of its own.

## Troubleshooting

- **`build.sh` fails with "this SDK is not supported by the compiler" or "redefinition of module 'SwiftBridging'"**: the Xcode Command Line Tools on that Mac are half-updated, and no Swift app will build until they're fixed. Reinstall them with `sudo rm -rf /Library/Developer/CommandLineTools`, then `xcode-select --install`, and build again. If you have Xcode, `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` works too.
- **"Margin needs Accessibility access"**: turn it on as described in step 3, then quit and reopen Margin. If it's already on but still fails after a rebuild, remove Margin from the list, add it again, and see the signing note above.
- **"⌃⌥M is taken"**: another app has the shortcut. Quit that app and reopen Margin.
- **"Margin's server isn't running"**: open **Open Server Log** from the menu-bar **M**. Running `npm start` in a terminal shows the same output. When a server is already running, the app uses it instead of starting its own.
- **"Margin isn't connected to a model"**: add `OPENAI_API_KEY` to `.env` or run `npm run login`, then restart Margin. Saving notes still works.
- **Nothing happens in Books**: make sure some text is actually selected. Books lets Margin copy only a selection.

## How it works

```
app/       Swift menu-bar app: hotkey, reading the selection, the floating card window
server/    Node server with no npm dependencies: saves highlights, calls the model, serves the card
  card/    The card itself (plain HTML, CSS and JS) shown in the app's window
```

1. On ⌃⌥M, the app reads the selection from the app in front through Accessibility. Where that doesn't work (Books, some PDF apps), it presses the app's own **Edit ▸ Copy** and then puts your clipboard back. For browsers it also reads the page's URL, title and text.
2. The app sends this to the server, which keeps a *pending* highlight in memory. The card then appears beside the pointer, in a window that never takes focus away from what you're reading.
3. A note, a question or ↩ keeps the highlight, and it's written to disk. Questions stream from OpenAI's Responses API.

To trigger a capture from Shortcuts, Raycast or a script instead of the hotkey:

```sh
osascript -l JavaScript -e '$.NSDistributedNotificationCenter.defaultCenter.postNotificationNameObjectUserInfoDeliverImmediately("dev.margin.capture", $(), $(), true)'
```

Run the server's tests with `npm test`.

## License

MIT
