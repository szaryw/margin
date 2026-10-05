# Margin

**Highlight text in any Mac app, press ⌃⌥M, and keep a note or ask a question about it.**

Margin is a small menu-bar app for reading on a Mac. Select a passage in a browser, Apple Books, Preview or most other apps. Press **⌃⌥M** and a card opens beside it. Write a note, or ask a question and get an answer that knows what you were reading. Everything is saved as plain Markdown, one file per book or page, in a folder you choose. Pointing that folder at your Obsidian vault works well.

![The Margin card next to a passage selected in a Nieman Lab story in Chrome](docs/screenshots/01-card.png)

There's no reader app or library to learn. Your notes are Markdown files, so open them in any editor.

---

## What you need

- macOS 14 or later
- [Node.js](https://nodejs.org) 20 or later (`node -v`)
- Xcode Command Line Tools, for `swiftc` (`xcode-select --install`)
- An OpenAI API key **or** a ChatGPT Plus/Pro plan. Notes work without either.

Margin has no npm dependencies, so there's no `npm install` step.

## Setup

### 1. Get the code

```sh
git clone https://github.com/<you>/margin.git
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

Select some text and press **⌃⌥M**. The card opens next to your selection and shows where the text is from. Nothing is saved yet.

| You press | What happens |
|---|---|
| **↩** on the empty box | Saves just the highlight |
| Type a note, **↩** | Saves the highlight with your note |
| Type a question, **⌘↩** | Saves it and asks the model; the card becomes a conversation |
| **Esc**, or click back into the page | Closes the card and discards the highlight |

### Walkthrough

These screenshots were taken with Margin running for real: real selections, typed questions and live answers from the model.

**1. A web page.** In a [Nieman Lab story](https://www.niemanlab.org/2026/05/sam-altman-backs-micropayment-model-for-ai-agents-to-compensate-publishers/) about agents paying publishers per read, select the sentence about matching an $80 subscription, then press ⌃⌥M (the screenshot at the top). Ask *"Could agent micropayments ever add up to an $80 subscription?"* with ⌘↩. Margin sends the passage along with the page around it, so the answer works from the article's own figures. Web results appear as links under the answer.

![A conversation about the highlighted passage](docs/screenshots/02-ask.png)

**2. A book.** In Apple Books, reading Tim Wu's *The Age of Extraction*, select a passage and ask *"What would neutrality rules look like for AI platforms?"* Margin gets the title and author from Books' own copy citation. Keep asking follow-ups in the same card.

![Asking about a passage in The Age of Extraction in Apple Books](docs/screenshots/03-books.png)

**3. A PDF.** In Preview, on O'Reilly, Strauss & Mazzucato's paper [*Algorithmic attention rents*](https://doi.org/10.1017/dap.2024.1), select the sentence on disclosure and type a note to yourself instead. **↩** saves it, with no question asked.

![Writing a note on a sentence in a PDF open in Preview](docs/screenshots/04-pdf.png)

### Your notes

Each book or page gets one Markdown file in `~/Documents/Margin` (or the folder in `MARGIN_DIR`). The file holds every highlight, note and conversation for that source, oldest first:

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

## Privacy

- The server only listens on `127.0.0.1:4319`. It rejects requests from other sites and other host names.
- Nothing leaves your Mac until you ask a question. At that point the passage, its source and the nearby text go to OpenAI with `store: false`. Conversations don't appear in your ChatGPT history.
- Notes stay in your folder. Margin has no account or sync of its own.

## Troubleshooting

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
