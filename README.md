# dsh-rea-reverse-preset

**English** · [简体中文](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Troubleshooting](docs/troubleshooting.md) · [Changelog](CHANGELOG.md)

[![verify][badge-verify]][ci] [![license][badge-license]][license-file] [![node][badge-node]][pkg-json] [![dsh][badge-dsh]][arch-doc] [![REA tools][badge-tools]][rea-repo]

> The documents under `docs/` are written in Chinese; this README and the code comments are bilingual.

A **reverse-engineering mode** for **DeepSeek Harness (dsh)**.

It adds one entry to the dsh preset picker. Select it and the agent carries the reverse-engineering
tooling of [REA](https://github.com/morluto/rea) (~139 tools over Ghidra / Hopper / IDA, binaries and
Electron artifacts), a reverse-engineer persona, and an evidence-first analysis workflow skill — ready
to work on a sample straight away.

## What it does

- **Disassembly / decompilation** — Ghidra, Hopper and IDA through their headless or CLI entry points:
  pseudocode, cross references, call graphs, function boundaries.
- **Binary reconnaissance** — strings, symbols, sections, import/export tables, entropy, compiler fingerprints.
- **Packaged artifacts** — Electron `.app` and asar, APK / IPA, JS bundles: unpack, then analyse.
- **Cross-checking** — the same function compared across engines, so one decompiler cannot mislead you.
- **Written findings** — notes written as evidence then conclusion, not as guesses.

A missing engine only removes its own group of tools; everything else keeps working.

## Why use it

| Advantage | Detail |
|---|---|
| One command | `npm run setup` installs into every surface, probes engines, verifies, then tells you what to restart. |
| One bundle, four surfaces | Desktop app, `dsh web`, dsh-tui and headless share the same bundle — no per-surface config. |
| Leaves the host alone | It only adds a subtree to a preset; permissions, model routing, sandbox and persistence stay yours. |
| Portable | No machine-specific paths; engine locations come from environment variables. |
| Never resident | No engine at host boot: the tool list comes from a local manifest, REA starts on the first real tool call and stops itself after 10 idle minutes. |
| Fails softly | If REA cannot start, the mode is still selectable — just without its tools. |
| Clean uninstall | Remove the bundle and you are back to stock; the shipped composition is untouched. |
| Self-checking | `npm run verify` checks structure and portability offline; `verify:profiles` replays the real host loading path. |

## Install

### One command (recommended)

```sh
npx -y dsh-rea-reverse-preset setup   # from the published package
npm run setup                         # from a checkout
```

It checks node / dsh versions and local profiles, installs into each surface, probes Hopper / Ghidra /
Java / IDA, runs the checks, and prints a restart list. No questions, and re-running is idempotent.

```sh
npx -y dsh-rea-reverse-preset --check         # report only
npm run setup -- --write-env                  # write probed engine paths into ~/.zshrc
npm run setup -- --warm                       # fetch REA now and build the tool manifest
npm run setup -- --uninstall                  # remove from every surface
```

### Per surface, manually

| You use | profile | Command | Takes effect |
|---|---|---|---|
| Desktop app | `desktop` | `dsh plugin --profile desktop add github:Verisw/rea-dsh` | Quit the app fully (Cmd+Q), reopen |
| `dsh web` in a browser | `web` | `dsh plugin --profile web add github:Verisw/rea-dsh` | Restart `dsh web` |
| dsh-tui in a terminal | `dsh-tui` | `dsh plugin --profile dsh-tui add github:Verisw/rea-dsh` | Restart the TUI |
| `dsh -p` (scripts, headless) | `headless` | `dsh plugin --profile headless add github:Verisw/rea-dsh` | Next run picks it up |

The desktop app and `dsh web` are separate profiles — installing into one affects only that surface.
The desktop profile must exist first (the app creates it), so quit the app before installing.

`dsh plugin` itself needs Node >= 22.18 / >= 24: earlier Node versions lack
`import.meta.main`, so the command exits 0 without doing anything. `npm run setup`
probes this; see [docs/troubleshooting.md](docs/troubleshooting.md) §10 (zh).

Check what is installed:

```sh
node scripts/install.mjs
```

A local checkout install also shows up in the plugin store (dsh-plugin-hub) under **your own plugins**, where its publish button can push it to GitHub/npm. Being visible in the *public* store list is a separate matter — see [docs/market.md](docs/market.md) (zh).

## Use

1. Restart that surface.
2. `/preset` → **逆向工程模式** (reverse engineering), or `/preset reverse` directly.
3. `/mcp` lists the `mcp__rea__*` tools; the engine itself starts on the first real call.
4. Point it at a sample and say what you want to know — behaviour, protocol, validation logic, version diffs.

Two things worth knowing:

- **A session with conversation history cannot switch presets** — start a new session.
- **The engine is not resident.** Mounting the mode starts a small supervisor only; the tool list is read
  from a local manifest (`~/.dsh/cache/dsh-rea-reverse-preset/`) so all 139 tools are still registered.
  REA itself starts on the first real `mcp__rea__*` call (1–2 s warm) and stops after 10 idle minutes,
  then starts again on the next call.
  A fresh machine has no manifest yet, so the first startup launches REA once to build it — or run
  `npm run setup -- --warm` to do that up front, which also downloads the npx package.

### Engine locations (optional)

Nothing to configure: REA discovers engines itself. Use these when you have several versions or a
non-default location.

| Variable | Purpose |
|---|---|
| `HOPPER_LAUNCHER_PATH` | Hopper CLI launcher. On macOS the default location is used automatically when present. |
| `GHIDRA_INSTALL_DIR` | Ghidra install directory. The version must match what REA expects (12.1.4 today). |
| `JAVA_HOME` | JVM used by Ghidra; only needed when the `java` on PATH is too old. |
| `REA_IDA_MCP_CONFIG` | IDA MCP config file — the switch for IDA 9.x. |
| `REA_MCP_SPEC` | Override the REA version, e.g. `REA_MCP_SPEC=rea-agents@6.7.0`, without editing this package. |
| `REA_LAZY_IDLE_MS` | Idle milliseconds before the engine stops itself; default `600000` (10 minutes), `0` keeps it running. |
| `REA_LAZY_MODE` | `eager` restores the old behaviour (start at host boot); default `lazy`. |

dsh reads these at startup, so **restart after changing them**. An empty string counts as unset and is dropped.

## Uninstall

```sh
dsh plugin --profile <desktop|web|headless|dsh-tui> remove dsh-rea-reverse-preset
npm run unlink:all        # when installed through local symlinks
```

## Troubleshooting

| Symptom | Check first |
|---|---|
| No reverse-engineering entry in the preset list | Installed into a different profile, or not restarted; a dsh version outside the supported range skips the whole bundle. |
| Mode present, zero REA tools | Cold npx start timed out, an empty env value, a wrong engine path, or a proxy. |
| Fewer tools than expected | That engine was not found (IDA, typically) — expected behaviour. |
| Skills not mounted | The package was moved, or two copies are installed in one profile. |
| Config changes ignored | dsh reads this at startup only; restart the process. |
| A `rea mcp` process with no reverse session open | An older build that connected directly, or `REA_LAZY_MODE=eager`. |
| Not listed in the plugin store | The store builds its list from GitHub repos matching `topic:dsh-plugin` — see [docs/market.md](docs/market.md). |

Step-by-step diagnosis: [docs/troubleshooting.md](docs/troubleshooting.md).

## Notes

- The package declares exactly one preset (`id: reverse`) containing 21 top-level rows / 34 plugin rows,
  packaged as a dsh **bundle**, so `dsh plugin add` is all it takes.
- Host requirement: `@deepseek-ai/dsh >=0.2.0-rc.2 <0.3.0-0`. Outside that range the bundle is skipped with a
  notice instead of breaking your composition.
- How it loads, why it is built this way, the `!!js` evaluation environment and the compatibility gate:
  [docs/architecture.md](docs/architecture.md).
- Store metadata (title, categories, README screenshots) and how the listing is discovered:
  [docs/market.md](docs/market.md). `npm run market:check` prints a readiness report.

## License

MIT — see [LICENSE](LICENSE). This package calls [REA](https://github.com/morluto/rea) (MIT) without bundling
its code. Ghidra, Hopper and IDA keep their own licenses; none is shipped or managed here.

<!-- Badge sources. Reference-style on purpose: the plugin store turns every inline
     markdown image in a README into a "screenshot", and five shields would fill that tab. -->

[ci]: https://github.com/Verisw/rea-dsh/actions/workflows/verify.yml
[badge-verify]: https://github.com/Verisw/rea-dsh/actions/workflows/verify.yml/badge.svg
[license-file]: LICENSE
[badge-license]: https://img.shields.io/badge/license-MIT-blue.svg
[pkg-json]: package.json
[badge-node]: https://img.shields.io/badge/node-%E2%89%A520.16-brightgreen.svg
[arch-doc]: docs/architecture.md
[badge-dsh]: https://img.shields.io/badge/dsh-0.2.0--rc.2%20%E2%80%A6%200.3-blueviolet.svg
[rea-repo]: https://github.com/morluto/rea
[badge-tools]: https://img.shields.io/badge/REA%20tools-139-informational.svg
