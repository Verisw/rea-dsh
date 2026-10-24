# 排障：这些故障都不会报错

本 preset 的失败模式几乎全是**静默**的：模式能选、会话能开、工具面少一块。
所以诊断方式不是「找报错」，而是「逐个确认某一步真的发生了」。

| 症状 | 大概率原因 | 跳到 |
|---|---|---|
| 选择器里没有「逆向工程模式」 | bundle 没装上 / 没重启 / 被 peer 门槛跳过 | §1 |
| 模式在，但一个 `mcp__rea__*` 工具都没有 | npx 起不来 / env 里有空串 / 引擎路径错 | §2 |
| 工具只有十来个别名的，没有 Ghidra / Hopper 那批 | 引擎没被探测到（工具按引擎能力注册） | §3 |
| 技能列表里没有 `reverse-workflow` | `bundledSkillDir` 解析失败 | §4 |
| 改动没生效 | 没重启 / `patchReload` 不重读 bundle patch | §5 |
| 切 preset 被拒绝 | 会话已有历史 | §6 |
| 把 preset 目录放进 `~/.dsh/.agent-presets/` 没用 | registry 不扫描目录 | §7 |
| 某一整行被禁用 | peer 冲突，`prepareProfileEntries` 主动 disabled | §8 |
| 没开逆向模式，却有个 `rea mcp` 进程常驻 | 老版本直连 REA，或设了 `REA_LAZY_MODE=eager` | §9 |
| 工具都在，但第一次调用要等一两秒 | lazy 层按需拉起引擎，正常；想提前做完跑 `setup -- --warm` | §9 |

---

## 1. 模式没出现

先确认你在看哪个 profile——桌面 App 用 `desktop`，`dsh web` 用 `web`，`dsh -p` 用
`headless`，TUI 用 `dsh-tui`。它们各自的 `node_modules` 与 `package.json` 是分开的，
装到 `web` 不会让桌面 App 出现这个模式。

```sh
node scripts/install.mjs          # 列出每个 profile 装没装
npm run verify:profiles           # 直接看宿主装载出的组合（最快）
node -e "console.log(require(process.env.HOME+'/.dsh/profiles/web/package.json').dsh.profile.bundles)"
node -e "console.log(require.resolve('dsh-rea-reverse-preset/package.json'))"
```

- `dsh.profile.bundles` 里没有它 → `dsh plugin --profile <name> add github:Verisw/rea-dsh`，
  或本地开发用 `npm run link:all`。
- 有但 `require.resolve` 失败 → `node_modules` 里是断链（clone 目录被移动/删除过）。
- 都在，但启动 stderr 里出现 `skippedBundles` 且带本包名 → 宿主版本超出 peer 范围（§8）。
- `verify:profiles` 报两条 `preset-reverse` → bundle 与 profile patch 同时在插（回退形态没删）。

## 2. REA 一个工具都没起来

先分清层级：bash / read 这些在、只是没有 `mcp__rea__*`，那是 REA 进程的问题；连 preset 都没有，回 §1。

按这个顺序查（都是踩过的坑）：

1. **npx 冷启动**。第一次要下包，慢的时候会顶到 MCP 客户端超时。我们保留了 `--prefer-offline`：
   命中缓存就秒开，没缓存才联网。热缓存 **约 1.4 s**，冷缓存 **约 3.7 s**；
   如果这台机器要几十秒，先手动跑一次焐热：
   ```sh
   npx --prefer-offline -y rea-agents@6.3.0 mcp --help
   ```
2. **env 里有空串**。REA 把空串当成显式配置，会走进错误分支（表现为启动卡顿甚至挂住）。
   本包的 `!!js` 已经把非「非空字符串」的值全过滤掉，手改配置时别写成 `HOPPER_LAUNCHER_PATH: ''`。
3. **引擎路径错**。`GHIDRA_INSTALL_DIR` 指错目录时 REA 回退到自动探测（约 1.8 s），不是致命错——
   所以「少了一批工具」往往才是路径错的症状（§3）。
4. **网络 / 代理**。npx 需要 registry；宿主的 MCP 子进程会继承代理变量，但剥掉 `DSH_*` 与敏感变量。

确认方式：让 agent 列一次工具，或看 `/mcp` 面板。工具名形如
`mcp__rea__ghidra_decompile`、`mcp__rea__hopper_list_procedures`。

## 3. 工具少了一大半

REA 的工具集**按引擎能力注册**：没探测到的引擎，对应工具不会出现。逐个确认：

```sh
ls -d "$GHIDRA_INSTALL_DIR" && echo ghidra-dir-ok    # 版本必须是 REA 认的 release（12.1.4）
"$JAVA_HOME/bin/java" -version 2>&1 | head -1
ls -l ~/Applications/"Hopper Disassembler.app"/Contents/MacOS/hopper
echo "$REA_IDA_MCP_CONFIG"
```

- Ghidra 版本不对 → 换成 REA 支持的那个 release，或用 `REA_MCP_SPEC` 升级 pin。
- `JAVA_HOME` 落在旧 JVM 上 → Ghidra headless 分析起不来，工具会少。
- Hopper：本包只在**文件真的存在**时才采用 macOS 默认路径，所以配置里出现的一定是真路径。

## 4. 技能挂不上

`bundledSkillDir` 是一个 `!!js` 表达式，两级探测：先按包自解析（`createRequire(ctx.baseUrl)`
找到 `dsh-rea-reverse-preset/package.json` 同级的 `skills/`），再退到 `../skills/`（TUI 形态）。
全落空时该键被**丢弃**而不是瞎猜——症状因此是「没有这个技能」，不是「加载报错」。

```sh
npm run verify     # 看 bundledSkillDir 那三行
```

顺带：`~/.agents/skills` 是宿主默认的 `user-agents` 根（rank 500），本包不需要 `customSkillDirs`；
早先版本留的那条只会在启动时多一条 duplicate-discovery 提示。

## 5. 改了配置不生效

- bundle patch 只在**启动时**应用一次；profile 的 `patchReload` 不重读它。改完重启。
- 本地软链开发时，确认 `~/.dsh/profiles/desktop/node_modules/dsh-rea-reverse-preset`
  指向的正是你在改的目录（`ls -l` 看箭头）。
- 桌面版与 TUI 是**两份**组合：改了 `cordis.patch.yml` 要 `npm run sync:tui` 再重启，
  否则 TUI 侧还是旧的（`npm run verify` 会报 twin 漂移）。

## 6. 不能切 preset

会话里发生过对话之后就不能换工具集：历史里的工具调用必须与当前工具集一致。
开新会话（`/new`，或重启后在空白会话里选）。这是宿主的约束，不是本 preset 的。

## 7. `~/.dsh/.agent-presets/<id>/` 不生效

这一版宿主的 `agent-preset-registry` 只接受注册，不扫描目录、不接受路径。
目录名册是死配置。落地方式只有一种：`dsh.profile.bundles` 里的 bundle patch，
四个 profile（desktop / web / headless / dsh-tui）共用；profile patch 只是回退形态。
仓库里的 `tui/preset.yml` 只是给人看的备忘，不参与装载。

## 8. 整行被禁用 / bundle 被跳过

两种不同的事，日志不同：

| 日志 | 含义 | 处理 |
|---|---|---|
| `skippedBundles` 里出现 `dsh-rea-reverse-preset` | bundle 级 peer 不满足，**整个包**没加载 | 对齐宿主版本，或改 `package.json` 的 peer 范围 |
| `disabling profile plugin <name>` | 单行级 peer 不满足，只有那一行 disabled | 宿主跳版后某个服务不存在了，按 architecture.md §10 重新对齐基座 |

兼容性检查只看 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 命名的 peer，按
`{ includePrerelease: true }` 比较——`0.2.0-rc.2` 这类预发布号能正常匹配。

## 9. 引擎的生命周期（lazy 层）

`mcp-rea` 那一行连的不是 REA，是本包的 `scripts/rea-lazy.mjs`。它在启动时只回答
`initialize` / `tools/list`，清单来自缓存；`tools/call` 这类真实请求才拉起引擎。

三种现象都是在说同一件事：

| 现象 | 含义 | 处理 |
|---|---|---|
| 一开 dsh 就有 `rea mcp` 进程 | 不是本版本的行为 | 确认装的包版本 ≥ 1.0.0，装完重启界面；再过 `ps -o pid,ppid,command -ax \| grep 'rea mcp'`，父进程应该是 dsh 主进程而不是 `npx` |
| 引擎一直不退 | `REA_LAZY_IDLE_MS=0`，或会话里确实一直有工具调用（每次调用都会重置计时） | 不设那就默认 10 分钟；想更短比如 `REA_LAZY_IDLE_MS=120000` |
| 第一次 `tools/call` 慢 1–2 s | cold → hot 的代价，仅此一次 | 正常。想消掉它跑 `npm run setup -- --warm` 预生成清单 |

想退回旧行为（启动即拉起）设 `REA_LAZY_MODE=eager`，其余照旧。

清单文件在 `${DSH_HOME:-~/.dsh}/cache/dsh-rea-reverse-preset/manifest-<spec>.json`，
1.8 MB 上下。删掉不会坏：下次启动会重新拉起一次 REA 采样。换了 `REA_MCP_SPEC` 时文件名跟着变，
不会读到旧清单。

手动看它一眼：

```sh
# 转接层自己的日志（每次启动、拉起、停止都会打一行）
# 在宿主 stderr 里，形如 [rea-lazy] starting REA (rea-agents@6.3.0)
ps -Ao pid,ppid,etime,command | grep -E 'rea mcp|rea-lazy' | grep -v grep
```

## 10. `dsh plugin add` 什么都不打印，也没装上

`dsh` 的入口是 `if (import.meta.main) await runCli()`。Node 23.x 和 24.2 之前的
版本没有 `import.meta.main`，CLI 于是**什么都不做却 exit 0**——看不出失败，profile
里也没有任何变化。

```sh
node --input-type=module -e 'console.log(process.version, import.meta.main)'
```

看到 `undefined` 就是它。换 Node ≥ 22.18 或 ≥ 24 再跑，或改用仓库软链方式
（`npm run link:all`），后者不经过 CLI。`npm run setup` 会先探这一步并给出警告。

---

## 收集证据

提 issue 时附上这些，比描述现象有用得多：

```sh
dsh --version
npm run verify           # 完整输出
node -p "process.version + ' ' + process.arch"
```

再加启动 stderr 里带 `skippedBundles` / `disabling profile plugin` 的行，以及 `/mcp` 面板里 rea 的状态。
