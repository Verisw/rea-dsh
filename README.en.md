# dsh-rea-reverse-preset

A reverse-engineering mode for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai).
It adds one preset — **Reverse Engineering Mode** — that mounts the
[REA](https://github.com/morluto/rea) MCP toolset (~139 tools across Ghidra, Hopper, IDA and
binary / Electron artifact analysis), a reverse-engineer persona, and a workflow skill built
around "what is the evidence and what is the next experiment".

- One npm package = one dsh **bundle** (`dsh.bundle.patch`); install with `dsh plugin add`.
- It declares exactly one **preset** (`id: reverse`) whose body is 21 top-level rows / 34 plugin rows.
- It never touches the host's permission surface, model routing, sandbox or persistence.

---

## Three layers, and why the preset is *not* a plugin

| Layer | What it is | Toggleable in the Plugins page |
|---|---|---|
| npm package `dsh-rea-reverse-preset` | a **bundle**: one `cordis.patch.yml` plus a `dsh.bundle.patch` field | yes (the bundle row) |
| The `reverse` preset declaration | one `@deepseek-ai/dsh-agent-preset` config row | no — agent preset entries are read-only there |
| The 34 rows inside the preset | real Cordis **plugins** (`mcp-rea`, `tool-bash`, …) | yes, when a row is uniquely addressable |

A preset has no entry module, exports nothing, runs no code of its own. It is a name plus a list
of plugins, mounted as its own scope by the registry. The rows inside that scope are the plugins.

---

## Install

One mechanism — a **bundle** — for all four profiles. Install once, restart that surface.

| You use | profile | Install | Takes effect |
|---|---|---|---|
| Desktop app (Electron) | `desktop` | `dsh plugin --profile desktop add github:Verisw/rea-dsh` | quit and reopen the app |
| `dsh web` (browser UI) | `web` | `dsh plugin --profile web add github:Verisw/rea-dsh` | restart `dsh web` |
| `dsh -p` (headless) | `headless` | `dsh plugin --profile headless add github:Verisw/rea-dsh` | next run |
| dsh-tui | `dsh-tui` | `dsh plugin --profile dsh-tui add github:Verisw/rea-dsh` | restart the TUI |

Desktop and web share the preset picker that `@deepseek-ai/dsh-web-app` inserts; each install just
adds one row to that profile's registry. They are separate profiles (own `package.json`, own
`node_modules`), so installing into one does not touch the other.

See what this machine has:

```sh
node scripts/install.mjs        # list only, changes nothing
```

For local development, link the checkout straight into the profile (idempotent):

```sh
npm run link:all        # desktop + web + headless + dsh-tui
npm run link:web        # just one
npm run unlink:all      # remove from all
```

`dsh plugin --profile <name>` initialises non-desktop profiles from their template; the desktop
profile must be created by the app first, and the app must be fully quit while you install.

After restarting, ask the host itself what it composed:

```sh
npm run verify:profiles
```

```text
host 0.2.0-rc.2 (/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json)
PASS  desktop — preset reverse / 21 plugin rows, layer 5/11, 4 unrelated skip(s)
PASS  dsh-tui — preset reverse / 21 plugin rows, layer 3/3, 0 unrelated skip(s)
PASS  headless — preset reverse / 21 plugin rows, layer 3/3, 0 unrelated skip(s)
PASS  web — preset reverse / 21 plugin rows, layer 6/6, 0 unrelated skip(s)

RESULT PASS — 4 profile(s) compose
```

Profiles without the bundle report `SKIP` and do not fail the run. The package contains no
machine-specific absolute paths: the skill directory resolves from the package location, and
analysis-engine locations come from environment variables only.

### Fallback: profile-patch form

Only for hosts whose dsh does not read bundles from `dsh.profile.bundles`. Merge
`tui/profile.patch.yml` into `<profile>/cordis.patch.yml` and point its `path` at this checkout;
`tui/agent.cordis.yml` is generated from `cordis.patch.yml` by `npm run sync:tui` — do not edit it
by hand (`npm run verify` fails on drift). Bundle **and** patch together produce two
`preset-reverse` rows; keep exactly one.

---

## Analysis engines

REA probes engines itself; the preset only forwards explicit locations. **Unset variables are fine.**

| Variable | Purpose | Notes |
|---|---|---|
| `HOPPER_LAUNCHER_PATH` | Hopper CLI entry point | on macOS the default `~/Applications/Hopper Disassembler.app/Contents/MacOS/hopper` is used only if the file exists |
| `GHIDRA_INSTALL_DIR` | Ghidra install | must be a release REA recognises (the pinned rea-agents checks **12.1.4**) |
| `JAVA_HOME` | JVM for Ghidra | only needed when the `java` on PATH is too old |
| `REA_IDA_MCP_CONFIG` | IDA MCP config | the switch for IDA 9.x |
| `REA_MCP_SPEC` | override the REA pin | e.g. `REA_MCP_SPEC=rea-agents@6.7.0` without editing this package |

Variables are read from the dsh process environment — restart after changing them. Empty strings
are filtered out, because REA treats an empty string as an explicit (broken) setting.

---

## Usage

1. Restart dsh, then `/preset` → Reverse Engineering Mode (or `/preset reverse`).
2. A session that already has history cannot switch presets (tool calls in history must match the
   live toolset). Switch in a fresh session, or `/new`.
3. Confirm REA is up via `/mcp`, or ask the agent to list tools. Names look like `mcp__rea__*`.

**Startup cost**: preset declarations mount eagerly, so every boot spawns REA once — about **1.4 s**
warm (npx cache) and **3.7 s** cold. That is the design cost of this mode, not a failure.
`failOnStartupError: false` keeps the mode selectable when REA cannot start (it just has no REA tools).

---

## Verify

```sh
npm install      # js-yaml only
npm run verify            # structure, portability, dsh-tui twin, live-host schemas
npm run verify:profiles   # what each real profile on this machine composes
```

`verify` checks: the package declares a bundle patch; the patch is a pure insert layer; 21 top-level
rows / 34 rows total with unique ids; every group carries an isolate realm; `--prefer-offline` is
kept; exactly one positional reaches REA; every env value is a non-empty string; `bundledSkillDir`
resolves from both an installed profile and the tui include and degrades to `undefined`; no
machine-specific path appears in either YAML; the tui composition equals the patch composition;
rows are cross-checked against the host's shipped `standard` preset; and `mcp-client` /
`skill-filesystem` configs pass the live Schemastery schemas. Without a dsh install, host-only
checks report `SKIP` and the structural checks still run.

---

## Uninstall

```sh
dsh plugin --profile <desktop|web|headless|dsh-tui> remove dsh-rea-reverse-preset
npm run unlink:all                # for a linked local checkout
```

If you installed the fallback form, delete the `preset-reverse` block from the profile patch and
restart.

---

## Layout

```text
cordis.patch.yml      single source of truth: preset declaration + composition body
skills/reverse-workflow/   bundled skill (target of bundledSkillDir)
tui/                        fallback form only (unused by default)
tui/agent.cordis.yml        generated twin (entry list) consumed by cordis-plugin-include
tui/profile.patch.yml       loader snippet for the patch form
scripts/verify.mjs          offline checks: structure, portability, twin, host schemas
scripts/check-profiles.mjs  per-profile end-to-end composition on this machine
scripts/sync-tui.mjs        generate / check the twin
scripts/install.mjs         link this checkout into profiles (--profile / --all / --uninstall)
docs/architecture.md  load path, realms, !!js evaluation, portability rules
docs/troubleshooting.md  silent failure modes and measured numbers
```

---

## Known limits

- **Host gate**: `peerDependencies` says `@deepseek-ai/dsh >=0.2.0-rc.2 <0.3.0-0`. On dsh 0.3.x the
  bundle is skipped (listed in `skippedBundles`) instead of breaking your composition; realign the
  `standard` base as described in `docs/architecture.md`.
- Preset declarations mount eagerly — there is no "pay only when selected".
- REA cannot be shared globally: `mcp-client` tools belong to the preset scope.
- On Windows `tool-pwsh` is active and `tool-bash` is disabled, mirroring the shipped `standard`.

---

## License

MIT for this package. It calls [REA](https://github.com/morluto/rea) (MIT) without vendoring it.
Ghidra, Hopper and IDA keep their own licenses; this package neither bundles nor redistributes them.
