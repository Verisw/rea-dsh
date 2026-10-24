# dsh-rea-reverse-preset

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
npx -y dsh-rea-reverse-preset setup --check   # report only
npm run setup -- --write-env                  # write probed engine paths into ~/.zshrc
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

Check what is installed:

```sh
node scripts/install.mjs
```

## Use

1. Restart that surface.
2. `/preset` → **逆向工程模式** (reverse engineering), or `/preset reverse` directly.
3. `/mcp` to confirm REA came up; its tools are named `mcp__rea__*`.
4. Point it at a sample and say what you want to know — behaviour, protocol, validation logic, version diffs.

Two things worth knowing:

- **A session with conversation history cannot switch presets** — start a new session.
- The mode mounts with the host, so every startup launches REA once (about 1.4 s warm, 3.7 s cold).
  Run `npm run setup -- --warm` once to pre-warm the npx cache; the first launch can otherwise take a minute.

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

Step-by-step diagnosis: [docs/troubleshooting.md](docs/troubleshooting.md).

## Notes

- The package declares exactly one preset (`id: reverse`) containing 21 top-level rows / 34 plugin rows,
  packaged as a dsh **bundle**, so `dsh plugin add` is all it takes.
- Host requirement: `@deepseek-ai/dsh >=0.2.0-rc.2 <0.3.0-0`. Outside that range the bundle is skipped with a
  notice instead of breaking your composition.
- How it loads, why it is built this way, the `!!js` evaluation environment and the compatibility gate:
  [docs/architecture.md](docs/architecture.md).

## License

MIT — see [LICENSE](LICENSE). This package calls [REA](https://github.com/morluto/rea) (MIT) without bundling
its code. Ghidra, Hopper and IDA keep their own licenses; none is shipped or managed here.
