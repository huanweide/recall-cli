**中文** · [README.md](./README.md)

<p align="center">
  <img src="assets/banner.svg" alt="recall-cli">
</p>

<p align="center">
  <a href="#what-it-actually-does">30-second overview</a> · <a href="#install">Install</a> · <a href="#quick-start">Quick start</a> · <a href="#shell-integration">Shell integration</a> · <a href="#how-it-works">How it works</a>
</p>

# recall-cli

> Terminal command-history ghost completion — **zero-dependency · pure-local · deterministic · offline**.

Turn the commands you have typed in your own shell into a grey "ghost completion" that appears behind your cursor. Like the grey hint in an IDE as you type code — but you memorize no shortcuts, it touches no network, uploads nothing, and calls no AI.

```
$ git pu█                                    (you just typed git pu)
$ git pu git pull origin main               (grey ghost appears automatically)
          └─ accept with Ctrl-F ─┘
```

## What it actually does

- **Auto-detect shell**: supports `zsh` / `bash` / `fish`, auto-finds the history file (also supports `--history` to set it manually).
- **Smart ranking**: scores by "prefix match + frequency + recency"; the more often you use a command, the higher it ranks.
- **Real ghost text (zsh)**: a live grey completion behind the cursor; accept with `Ctrl-F` or `→`.
- **Deterministic**: same history + same prefix = always the same result. Unit-testable, CI-able, offline.
- **Zero-dependency**: a single Node file, installs no npm packages, reads no network, never touches your command content.

Subcommands:

| Command | Purpose |
| --- | --- |
| `recall <prefix>` | Ghost-completion candidates (default subcommand) |
| `recall stats` | History stats: total / unique commands / top commands |
| `recall paths` | Print detected shell and history paths |
| `recall help` | Help |

Options: `--top N` (top N), `--plain` (output command only, for shell integration), `--shell`, `--history`.

## Who should use this

- You live in a terminal and want lightweight, offline, privacy-preserving command recall without sending your history to the cloud.
- You want a deterministic completion that can be unit-tested and wired into CI, unlike random AI completions.

## Who should NOT use this

- You want a cloud/AI completion that learns across machines — recall-cli is strictly local and deterministic; it will not call any service.
- You are on a shell other than zsh / bash / fish — history parsing only covers those three.

## Install

Requires Node.js >= 18 (no `npm install` needed).

> The original docs said "Node >= 16" — that is wrong: the built-in `node --test` runner only landed in Node 18, and `npm test` depends on it. **Running recall-cli itself** only needs Node 16+; only running the tests needs 18+.

```bash
# Option 1: clone and run (recommended)
git clone https://github.com/huanweide/recall-cli.git
node recall-cli/index.js --history ~/.bash_history git

# Option 2: register a global `recall` command
#   Note: this project is NOT published to npm. There IS a third-party `recall` on npm
#   (fouad/recall, a Node.js tracing library), and also `recall-cli` (maintained by srcspider).
#   So do not `npm install -g` under either name — you would install someone else's package
#   and hijack the command. `npm link` only registers this repo's bin; it touches no registry package:
git clone https://github.com/huanweide/recall-cli.git
cd recall-cli && npm link     # registers the recall command, sourced from this local repo

# Option 3: grab the single file and use it (note the branch is master, not main)
curl -fsSL https://raw.githubusercontent.com/huanweide/recall-cli/master/index.js -o recall
chmod +x recall && mv recall /usr/local/bin/recall
```

> To confirm where a command actually comes from: both `which recall` and `recall paths` tell you the history file being read.

## Exit-code contract

| Exit code | Meaning |
|-----------|---------|
| `0` | Success (including "no matching candidate" — that is a normal result, not an error) |
| `1` | Runtime error: history file missing / unreadable |
| `2` | **Usage error**: unknown option, option missing a value, `--top` non-positive-integer, invalid `--shell` value |

A misspelled option reports clearly instead of being treated as a search keyword:

```bash
recall --topp git      # -> exit 2 + "unknown option: --topp"
recall --top abc git   # -> exit 2 + "--top requires a positive integer"
```

## Quick start

```bash
# See what you most often type starting with git
recall git

# Just the top result, command only (for shell integration)
recall "docker compose" --top 1 --plain

# A glance at history health
recall stats
```

Example output:

```
$ recall git
 1. git status        (score=0.8833, freq=42)
 2. git push origin main  (score=0.4417, freq=11)
 3. git pull --rebase  (score=0.31, freq=7)
```

## Shell integration

### zsh (recommended, real ghost text)

Add the following to the end of `~/.zshrc` (or `source shell/recall.zsh`):

```zsh
source /path/to/recall-cli/shell/recall.zsh
```

Effect: as you type each character, a grey completion appears behind the cursor; accept with `Ctrl-F` or `→`.

### bash (fzf-assisted)

bash has no native ghost text, so use fzf for "on-demand candidates" (install `fzf` first):

```bash
source /path/to/recall-cli/shell/recall.bash
```

Effect: `Ctrl-F` pops up a candidate list matching the current line prefix; press enter to accept.

## How it works (one-liner version)

Read the history file → parse into a command array by shell format → aggregate `{command, count, last position}` → score by `frequency×0.65 + recency×0.35` → take the top N prefix matches. Entirely synchronous, local, deterministic.

## CI gate usage

recall is not a "health score" checkup tool (that template line was copied from other family repos; recall has no health score). Its correct role in a pipeline is a **smoke test that the shell integration is still alive**:

```bash
# 1) Integration health check: confirm it can read history and produce candidates (exit 0)
recall --history "$HIST_FILE" git --plain | head -1 || exit $?

# 2) Assert candidates are non-empty: unreadable history should exit 1, so alert on it
[ -n "$(recall --history "$HIST_FILE" git --plain)" ] || { echo "recall produced no candidates"; exit 1; }

# 3) Tell "wrong argument" from "broken environment": the former exits 2, the latter exits 1
recall --history "$HIST_FILE" --top abc git || exit $?   # -> 2
```

This repo's own CI (`.github/workflows/verify.yml`) runs: unit tests + CLI smoke on Node 18/20/22 × ubuntu/windows, a zero-dependency self-proof, and a README link/option consistency check.

## Why recall-cli (not another lint toy)

- No network, no AI, no service — pure-local deterministic ranking.
- Single-file, zero npm dependencies — an order of magnitude lighter than "install a pile of packages" shell plugins.
- Real ghost text (zsh `POSTDISPLAY`) is a native terminal experience, not "a popup asking you to choose".
- Determinism makes it CI-able and unit-testable, a hard boundary against random AI completion.

## Why it stays maintainable

- Small surface (one ranking function + three history parsers), zero-risk to change.
- No external dependencies = no dependency rot, no supply-chain risk.
- The ranking algorithm is a pure function; unit tests cover zsh/bash/fish parsing and scoring, so regressions surface immediately.
- Naturally extensible: future "cross-machine history merge" or "alias priority" are just one more pure function each.

## License

MIT

---

Maintained by **huanweide** · [GitHub](https://github.com/huanweide)

## More open-source tools by huanweide

- 🎬 Subtitle / video: [bili-subtitle-universal](https://github.com/huanweide/bili-subtitle-universal) · [live-subtitle](https://github.com/huanweide/live-subtitle) · [zhihuishu-helper](https://github.com/huanweide/zhihuishu-helper) · [video-brief](https://github.com/huanweide/video-brief)
- 🩺 Code-health family (18 zero-dep CLI axes): [family-showcase](https://github.com/huanweide/family-showcase)
- 🔧 CLI utilities: [idiot-index](https://github.com/huanweide/idiot-index) · [recall-cli](https://github.com/huanweide/recall-cli) · [forge-safeguard](https://github.com/huanweide/forge-safeguard-20260812)
- 🖥️ Desktop / news: [floatsnip](https://github.com/huanweide/floatsnip) · [tech-news-hub](https://github.com/huanweide/tech-news-hub)
- 📦 All repos: <https://github.com/huanweide?tab=repositories>
