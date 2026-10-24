# dsh-rea-reverse-preset

给 **DeepSeek Harness（dsh）** 装一个「逆向工程模式」：在 dsh 的 preset 选择器里多出一项
**逆向工程模式**，选中后 agent 挂着 [REA](https://github.com/morluto/rea) 的 MCP 工具
（约 139 个，覆盖 Ghidra / Hopper / IDA / 二进制与 Electron 制品分析）、一套逆向分析师人设，
以及一个强调「证据落点」的逆向工作流技能。

- 一个 npm 包 = 一个 dsh **bundle**（`dsh.bundle.patch`），`dsh plugin add` 即可装。
- 里面只声明一个 **preset**（`id: reverse`），组合正文是 21 个顶层行 / 34 个插件行。
- 不碰宿主的权限面、模型路由、沙箱与持久化——那些是部署的事，preset 不参与。

## 先搞清楚三层关系（这是最常见的误解）

| 层 | 是什么 | 在「插件」页里能开关吗 |
|---|---|---|
| npm 包 `dsh-rea-reverse-preset` | **bundle**：一份 `cordis.patch.yml`，加一个 `dsh.bundle.patch` 字段 | 能（组合包这一行） |
| `reverse` 这个 preset 声明 | 一行 `@deepseek-ai/dsh-agent-preset` 配置 | 不能，**Agent 预设条目是只读的** |
| preset 里的 34 个行 | 真正的 Cordis **插件**（`mcp-rea`、`tool-bash`…） | 能，凡是能被唯一定位的行 |

所以：**preset 不是插件**。它没有入口模块、不导出东西、自身不跑代码；它是一个「名字 + 一串插件」
的声明，被 registry 挂成一棵独立子树，子树里的行才是插件。

---

## 安装

### A. 桌面版 / Web 版（bundle 形态，推荐）

```sh
dsh plugin --profile desktop add github:Verisw/rea-dsh
# 本地开发时直接链进去：
npm run link:desktop          # 把本仓库软链进 ~/.dsh/profiles/desktop/node_modules
```

装完**重启 dsh**。启动时 bundle 的 patch 插一行 preset 声明，选择器里就多出「逆向工程模式」。

从别的目录 clone 也行：本包不含机器相关的绝对路径，技能目录按包位置自解析，分析引擎位置全部来自环境变量。

### B. dsh-tui

dsh-tui 走 profile patch，不是 bundle 清单。把 `tui/profile.patch.yml` 那一段并进
`~/.dsh/profiles/dsh-tui/cordis.patch.yml`，并把 `path` 改成本机仓库位置：

```yaml
- insert:
    - id: preset-reverse
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: reverse
        name: 逆向工程模式
        description: 面向已发布软件的逆向模式。
        order: 5
        plugins:
          - id: reverse-composition
            name: '@deepseek-ai/cordis-plugin-include'
            config:
              path: 'file:///绝对路径/rea-dsh/tui/agent.cordis.yml'
```

`tui/agent.cordis.yml` 由 `npm run sync:tui` 从 `cordis.patch.yml` 生成，不要手改（`npm run verify` 会拦住漂移）。
细节见 [tui/README.md](tui/README.md)。

---

## 分析引擎

REA 自己探测引擎；本 preset 只负责把显式位置透传过去。**不配就用默认探测，不会坏。**

| 环境变量 | 作用 | 说明 |
|---|---|---|
| `HOPPER_LAUNCHER_PATH` | Hopper 的 CLI 入口 | macOS 未设时自动试 `~/Applications/Hopper Disassembler.app/Contents/MacOS/hopper`（仅当文件真存在） |
| `GHIDRA_INSTALL_DIR` | Ghidra 解压目录 | 必须是 REA 认版本的 release（当前 pin 的 rea-agents 校验 **12.1.4**） |
| `JAVA_HOME` | Ghidra 用的 JVM | 只在 PATH 上的 `java` 版本不够新时需要 |
| `REA_IDA_MCP_CONFIG` | IDA MCP 配置文件 | IDA 9.x 走这个开关 |
| `REA_MCP_SPEC` | 覆盖 REA 版本 pin | 例如 `REA_MCP_SPEC=rea-agents@6.7.0`，不用改本包 |

这些变量在 dsh 进程的环境里读，**改完重启 dsh**。空字符串会被过滤——REA 把空串当配置错误
（症状与修法见 [docs/troubleshooting.md](docs/troubleshooting.md)）。

---

## 使用

1. 重启 dsh → `/preset` → 逆向工程模式（或 `/preset reverse`）。
2. **已产生过对话的会话不能切 preset**（历史里的工具调用必须与当前工具集一致）；空白会话可原地切，否则 `/new`。
3. 确认 REA 起来了：`/mcp`，或让 agent 列一次工具。工具名形如 `mcp__rea__*`。

### 启动代价

preset 声明是 **eager** 的：注册即挂载。所以每次启动都会拉起一次 REA——热 npx 缓存约 **1.4 s**，
冷缓存约 **3.7 s**。这是设计代价，不是故障；`failOnStartupError: false` 保证 REA 起不来时
模式仍然可选（只是没有 REA 工具）。

---

## 校验

```sh
npm install        # 只为拿 js-yaml
npm run verify     # 结构 + 可移植性 + tui 同构 + 宿主真身校验
```

本机实测输出（dsh 0.2.0-rc.2）：

```text
PASS  package name — dsh-rea-reverse-preset
PASS  dsh.bundle.patch resolves — ./cordis.patch.yml
PASS  patch is one pure insert layer
PASS  top-level rows — 21
PASS  rows including group children — 34
PASS  every group carries an isolate realm — planning, compaction, delegation
PASS  npx keeps --prefer-offline
PASS  exactly one positional reaches REA — rea-agents@6.3.0 mcp
PASS  every env value is a non-empty string
PASS  bundledSkillDir resolves from an installed profile
PASS  bundledSkillDir resolves from the tui include
PASS  an unresolvable skill dir is omitted, not guessed — undefined
PASS  no machine-specific path in cordis.patch.yml
PASS  tui composition equals the patch composition — 21 rows
PASS  only the two REA rows are added over standard — mcp-rea, tool-presentation
PASS  mcp-client config passes the live schema
PASS  skill-filesystem config passes the live schema
RESULT: PASS
```

没装 dsh 的机器上，需要宿主的那几项显示 `SKIP`，结构性检查照跑，退出码仍为 0。

---

## 卸载

```sh
dsh plugin --profile desktop remove dsh-rea-reverse-preset
# 本地软链装的：
npm run unlink:desktop
```

TUI 侧：删掉 profile patch 里那段 `preset-reverse`，重启即可。
旧目录名册（`~/.dsh/.agent-presets/reverse`）在新宿主上本来就不被读取，可留可删。

---

## 目录结构

```text
.
├── cordis.patch.yml              唯一真相：preset 声明 + 组合正文
├── package.json                  npm 包 / dsh bundle 元数据
├── skills/reverse-workflow/      随包技能（bundledSkillDir 指这里）
├── tui/
│   ├── agent.cordis.yml          生成物：由上面那份 patch 投影出的 entry list
│   ├── profile.patch.yml         dsh-tui 侧的装载片段
│   ├── preset.yml                仅 name/description/order 的备忘（旧目录名册用）
│   └── README.md
├── scripts/
│   ├── verify.mjs                全部校验
│   ├── sync-tui.mjs              生成 / 校验 tui/agent.cordis.yml
│   └── install-desktop.mjs       本地软链进 desktop profile
└── docs/
    ├── architecture.md           装载链路、realm、!!js 求值、可移植性策略
    └── troubleshooting.md        静默失败路径与实测数据
```

---

## 已知限制

- **宿主版本门槛**：`peerDependencies` 声明 `@deepseek-ai/dsh >=0.2.0-rc.2 <0.3.0-0`。
  dsh 升到 0.3.x 后本包会被跳过（列入 `skippedBundles`，stderr 有提示），而不是把你的组合搞坏。
  届时按 [docs/architecture.md](docs/architecture.md) 重新对齐 `standard` 基座。
- preset 声明是 eager 挂载，没有「不选就不花钱」这回事。
- REA 不能挂到全局共享：`mcp-client` 的工具属于 preset 的子树。
- Windows 上 `tool-pwsh` 生效、`tool-bash` 关闭（沿用 shipped standard 的写法）。

---

## 许可

本包 MIT。它调用 [REA](https://github.com/morluto/rea)（MIT），不打包其代码；
分析引擎（Ghidra / Hopper / IDA）各自独立授权，本包不附带也不代管。
