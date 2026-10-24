# 装载链路与设计约束

这份文档解释「这一行配置为什么这么写」。改动 `cordis.patch.yml` 之前先读完它，
否则很容易写出「能解析、但永远不会生效」的组合。

---

## 1. 三层：bundle、preset 声明、插件行

```text
~/.dsh/profiles/<profile>/package.json
  dsh.profile.bundles: [ ..., "dsh-rea-reverse-preset", ... ]
              │
              │  resolveBundleDir：先按 dsh 安装位置找，再按 profile 目录找
              ▼
  <bundle>/package.json  →  dsh.bundle.patch: "./cordis.patch.yml"
              │
              │  bundlePatchPaths → 把多份 patch 叠成一层
              ▼
  applyEntryPatches([], layers)
              │   insert: [...]  ← 本包唯一的动作
              ▼
  profile 的 entry list 多出一行：@deepseek-ai/dsh-agent-preset（id: preset-reverse）
              │
              │  agentPresetRegistry.register(config)  —— 注册即挂载（eager）
              ▼
  preset "reverse" 的独立 scope + 内存 Loader 树
              │
              ▼
  21 个顶层行 / 34 个插件行真正被实例化
```

关键点：

- **patch 不深合并**。非 `insert` 的 patch 项必须给 `id`，可选的 `name` 必须与已有行一致，
  然后**顶层键整体赋值**。所以要改一个已有行的 `config`，你得把整个 `config` 重写一遍。
  本包只做 `insert`，不覆盖宿主的任何行。
- **注册即挂载**。`@deepseek-ai/dsh-agent-preset` 的 README 写的是 "Definitions load eagerly"；
  registry 为每条声明建一个自有 scope，并把子树挂起来。所以「选了才花钱」不成立。
- **profile 的 patchReload 不重读这份 patch**。改完要重启。

---

## 2. preset 不是插件

`@deepseek-ai/dsh-agent-preset` 的全部内容就是一份配置：

```js
static Config = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  order: z.number(),
  plugins: z.array(z.any()).required(),
})
static inject = ["agentPresets"]
// 注册：this.ctx.agentPresets.register(this.config)
```

没有入口模块、没有 `apply`，它不跑自己的代码。后果：

| 结论 | 依据 |
|---|---|
| 插件页能把「组合包」整行开关 | bundle 是 profile 的一个依赖 |
| 插件页**不能**开关 preset 条目 | 插件页对 agent 预设条目保持只读 |
| preset 里的每个行能被单独开关 | 它们是真正被加载的插件，且 id 唯一 |
| 目录式 preset（`~/.dsh/.agent-presets/<id>/`）在 registry 宿主上无效 | registry "neither scans directories nor accepts preset paths" |

最后一条是历史坑：本仓库早期版本依赖过 `~/.dsh/.agent-presets/reverse/agent.cordis.yml`，
在 dsh 0.2.x 上**根本不会被读到**。现在的落地点是 bundle patch（桌面）或 profile patch（TUI）。

---

## 3. realm：为什么每个 group 都带 `isolate`

一个服务行不在 realm 里，就发布到**根 realm**，也就是进程级。两个后果：

1. 另一个 preset 发布同名服务 → 第二次 `provide()` 抛错（同 realm symbol 下重复注册）。
2. 宿主侧的读取者会解析到「某一个 preset 的实例」给所有会话用。

所以本 preset 里凡是提供服务、且有外部读取者的地方都套一层 group（`cordis:group`）并给
`isolate`：

| group | isolate | 理由 |
|---|---|---|
| `planning` | `planMode: true` | planMode 服务只在本子树内有意义 |
| `compaction` | `compaction: true`, `toolResultPruner: true` | `compaction-basic` 用 `ctx.get` 读 `toolResultPrune`；不同 realm 就读不到，pruner 形同虚设 |
| `delegation` | `workflowEngine: true` | `workflows` 只在 agent 内部被读；但 `subagents` 注册表**故意不隔离**——provider 名全局唯一，且浏览器要跨会话查它 |

`true` 表示 entry-local realm（本挂载私有实例）。**注意：共享 label 不等于共享实例**——
`provide()` 在同一 realm symbol 下第二次注册直接抛错，label 的作用是「加入已有 realm」。

---

## 4. 一处落点，四个 profile

一个 bundle 就能覆盖本机全部四种界面。宿主侧的证据链（`scripts/check-profiles.mjs` 每次跑都在复核）：

```text
host 0.2.0-rc.2 (/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json)
PASS  desktop — preset reverse / 21 plugin rows, layer 5/11
PASS  dsh-tui — preset reverse / 21 plugin rows, layer 3/3
PASS  headless — preset reverse / 21 plugin rows, layer 3/3
PASS  web — preset reverse / 21 plugin rows, layer 6/6
```

| 界面 | profile | 谁提供 preset 管道 | bundle 层序 |
|---|---|---|---|
| 桌面 App（Electron，本机 Web GUI 也是它） | `desktop` | `@deepseek-ai/dsh-web-app` | 5/11 |
| `dsh web`（浏览器访问） | `web` | `@deepseek-ai/dsh-web-app` | 6/6 |
| `dsh -p`（headless） | `headless` | `@deepseek-ai/dsh-base` | 3/3 |
| dsh-tui | `dsh-tui` | `@deepseek-harness-tui/dsh-tui` | 3/3 |

- 四个 profile 的 `package.json` 都有 `dsh.profile.bundles`，boot 走同一个
  `loadProfileDirectory` → `bundlePatchPaths` → `applyEntryPatches`。preset 声明只是被塞进同一张
  清单，与「谁写的」无关，所以 bundle 形态在 TUI 上同样成立。
- 桌面与 web 是两个独立 profile（各自的 `node_modules`），但 preset 选择器都来自
  `dsh-web-app` 插入的 `agent-preset-registry` + `ui-agent-preset`，装到哪个只影响哪个界面。
- 曾被误认为「TUI 必须走 patch」的原因：TUI 文档里那句「registry 既不扫描目录也不接受 preset
  路径」说的是 `~/.dsh/.agent-presets/` 目录名册，与 `dsh.profile.bundles` 是两件事。

### 回退：patch 形态（`tui/`）

只有当宿主不从 `dsh.profile.bundles` 读 bundle 时才用，形态是「声明行 + `cordis-plugin-include`
指向 `tui/agent.cordis.yml`」，由 `npm run sync:tui` 从 `cordis.patch.yml` 生成；两者逐行一致由
`verify.mjs` 的深比较守住（`tui composition equals the patch composition`）。
早期做法是「两份手抄 + 靠自觉同步」，实测已经漂移过，所以改成生成。

patch 形态的两个隐藏差异，写下来免得再踩：

| | bundle 形态 | patch 形态 |
|---|---|---|
| 声明行 | 在 bundle 层，早于 profile patch | 在 profile patch 里，最后应用 |
| `ctx.baseUrl` | `file://<profile>/` | `file://<仓库>/tui/` |
| 与 bundle 共存 | — | 同一 id 出现两次，assembly 里两行 |

---

## 5. `!!js` 的求值环境

值是一个 `tag:yaml.org,2002:js` 标量，被 loader 在 `internal/config` 瀑布里替换：

```js
const evaluate = new Function("ctx", "expr", "with (ctx) { return eval(expr) }")
// ctx = entry 的上下文（原型链上挂着 loader 的 ctx）
```

可用（已实测）：

- `process`、`process.env`、`process.platform`、`process.getBuiltinModule('node:fs' | 'node:module' | 'node:path' | 'node:url')`
- `ctx.baseUrl`，以及**裸名** `baseUrl`（因为 `with (ctx)` 会沿原型链查找）
- `this.baseUrl` **不可用**（undefined）

写法约束：

- 超过一小段就用折叠块标量 `>-`。折叠会把换行变成空格，所以**表达式要写成一行**。
- 纯量里以反引号开头的模板字符串会被 YAML 当保留指示符，直接解析失败。用 `>-` 或字符串拼接。
- 返回值必须能过 Schemastery：`mcp-client` 要求 `env` 的**每个值都是字符串**，
  `{A: undefined}` 会让整个 config 校验抛错，所以用 `Object.fromEntries(Object.entries({...}).filter(...))` 过滤。
- `skill-filesystem.bundledSkillDir` 收到 `undefined` 时该键会被丢弃（安全）；收到 `''` 会被当成一个空路径（危险）。

---

## 6. `ctx.baseUrl` 的语义

- profile 根配置：`file://<profileDir>/`（boot 用 `pathToFileURL(dirname(configPath))`）。
- include 挂载进来的文件：变成**那个文件所在目录**（`cordis-plugin-include` 会改写 baseUrl）。
- preset 子树里的行：继承声明行所在 Loader 的 baseUrl，也就是 profile 目录。

这就是 `bundledSkillDir` 自解析能同时适配两种落地点的原因（第 7 节）。

---

## 7. 可移植性策略

发布到 GitHub 后，仓库会被 clone 到任何路径，所以**配置里不能出现机器相关绝对路径**。
`verify.mjs` 用正则扫描 `cordis.patch.yml` 和 `tui/agent.cordis.yml`，命中 `/Users/`、
`/home/<user>/`、`C:\\Users\\` 就失败。

原先的四类硬编码与现在的做法：

| 原硬编码 | 现在 |
|---|---|
| `bundledSkillDir: ~/Desktop/Code/rea-dsh/bundles/...` | `!!js` 自解析：`createRequire(ctx.baseUrl).resolve('dsh-rea-reverse-preset/package.json')` → 同级 `skills/`；再退到 `../skills/`（TUI 形态）；全落空则丢弃该键 |
| `customSkillDirs: ~/.agents/skills/reverse-engineer-anything` | 删除。`~/.agents/skills` 是默认的 `user-agents` 根，重复声明只会多一条 duplicate-discovery 提示 |
| `GHIDRA_INSTALL_DIR` / `JAVA_HOME` / `HOPPER_LAUNCHER_PATH` 写死 | 全部从环境变量读；空串过滤；Hopper 的 macOS 默认路径仅在**文件真存在**时才用 |
| `rea-agents@6.3.0` 唯一入口 | 仍是默认 pin，但可用 `REA_MCP_SPEC` 覆盖 |

为什么 `bundledSkillDir` 必须是绝对路径：`config` 里的相对路径**没有任何组件会去解析**，
它会落到进程工作目录（`process.cwd()`），于是技能挂不挂上取决于你从哪个目录启动 dsh。

---

## 8. 兼容性门槛

`dsh-app-boot` 在装 / 启动时跑 `evaluatePluginCompatibility`：

- 只看名字是 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的 peer；
- semver 带 `{ includePrerelease: true }`；
- `workspace:^` / `~/*` 映射成运行时版本。

本包声明 `@deepseek-ai/dsh: ">=0.2.0-rc.2 <0.3.0-0"`（`peerDependenciesMeta.optional = true`，
避免 npm 自动去装一个宿主）。效果：

- 0.2.0-rc.2 / 0.2.1-rc.3 / 0.2.9 → 通过；
- 0.1.5-rc.3 / 0.3.0-rc.1 / 0.3.0 / 0.4.0 → 不满足。

不满足的 bundle 在启动时被**跳过**并列入 `skippedBundles`（stderr 有行），而不是让 profile 起不来。
单行级别的 peer 冲突则由 `prepareProfileEntries` 直接把那一行 `disabled`（stderr：
`disabling profile plugin ...`）。

---

## 9. 与 `standard` 的 delta

基座是宿主自带的 `dsh-web-app/presets/standard.patch.yml`。本 preset 相对它的实测差异：

| # | 位置 | 改动 |
|---|---|---|
| 1 | 新增 `mcp-rea` | 指向本包的 lazy 转接层 `scripts/rea-lazy.mjs`（见 §11），工具名 `mcp__rea__<name>`，仅本子树可见 |
| 2 | 新增 `tool-presentation` | `mode: native`。REA 约 139 个工具在 `ptc` 下会折叠成代码调用面；不少部署默认 `ptc`，所以显式钉住而不是继承 |
| 3 | `persona.config.prefix` | 逆向分析师人设 |
| 4 | `skill-filesystem.config.bundledSkillDir` | 自解析到本仓 `skills/`（默认的 `customSkillDirs` 已删） |

`mcp-rea` 单独带 `failOnStartupError: false`：npx 冷启动/离线时，代价应该是「这个模式没有 REA 工具」，
而不是「整个 preset 变 broken，一个逆向会话都开不了」。转接层自己的生命周期见 §11。

---

## 10. 宿主升级后的基座同步

```sh
# 1) 看新基座
cat <dsh 安装目录>/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml
# 2) 对比行集与关键 config
npm run verify      # 会打印 added-over-standard / missing-versus-standard 的 WARN
# 3) 把基座变化搬进 cordis.patch.yml 的 plugins，再重新应用第 9 节的四处 delta
# 4) npm run sync:tui && npm run verify
```

历史跳版经验（0.1.5-rc.3 → 0.2.0-rc.2）：`workflow-worker-thread` 已换成 `workflow-ptc`；
新增 `tool-plugin-manager`（disabled）；`tool-ralph` 变为 disabled。这类变化不会报错，
只会让 preset 静默少功能——所以升级后务必跑一次 `verify`。

---

## 11. 引擎的生命周期：lazy 转接层

### 11.1 为什么不能直接连 REA

`@deepseek-ai/dsh-mcp-client` 是**挂载即连**的。宿主侧证据
（`node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js`，0.2.0-rc.2）：

```js
async function apply(ctx, config) {            // :809
  await startConnection(ctx, config, reconnect) // :822  ← 模块一装上就 spawn
  ctx.effect(() => dispose, "mcp-client.connection") // :830
}
```

没有 idle 计时器、没有「第一次调用再连」的开关，配置项只有
`transport / serverName / command / args / env / cwd / toolCallTimeoutMs / failOnStartupError / reconnect / maxInstructionBytes`。
所以只要 `command` 写的是 `npx`，代价就是：**开着 dsh 就有一个 REA 常驻**，哪怕一整天没开逆向会话。
实测那一对进程（`npm exec rea-agents@6.3.0 mcp` + `node …/.bin/rea mcp`）跑了 2 小时 58 分，父进程是桌面 App。

### 11.2 转接层做了什么

`scripts/rea-lazy.mjs` 自己在 stdin/stdout 上说 MCP（newline-delimited JSON-RPC 2.0），把宿主和 REA 隔开：

```text
宿主 ──stdin/stdout── 转接层 ──(首次真实请求才 spawn)── npx --prefer-offline -y rea-agents@6.3.0 mcp
                        │
                        └─ 缓存 <dsh home>/cache/dsh-rea-reverse-preset/manifest-<spec>.json
```

| 阶段 | 行为 |
|---|---|
| cold（有缓存） | `initialize` / `tools/list` / `prompts/list` / `resources*/list` 从缓存清单直接回答，139 个工具照常注册，REA 进程为 0 |
| 首次真实请求 | `tools/call` 等先入队 → spawn REA → 重放 `initialize`+`notifications/initialized` → 分页刷新清单并写缓存 → 队列打出去 |
| idle | `REA_LAZY_IDLE_MS`（默认 10 min）无流量 → 停 REA，回 cold；下一次调用重新拉起 |
| 启动失败 | `failOnStartupError: false` 兜底，模式仍可选 |

实测（本机，`ELECTRON_RUN_AS_NODE=1` 拉起同一份代码）：

```text
[rea-lazy] initialize answered from manifest (REA not started)
initialize 52 ms → 6.3.0        tools/list 22 ms → 139 个
new REA pids after manifest-only handshake: NONE (lazy confirmed)
[rea-lazy] starting REA … REA ready in 1.6s
first call answered ok          | new pids while hot: <npx>:…, <node>:…
[rea-lazy] idle for 6s — stopping REA
new REA pids after idle: NONE (auto-stop clean)
```

### 11.3 三个非显然的决定

- **`command: process.execPath`**，不是 `npx`、也不是 `node`。宿主自己的运行时就是最可靠的解释器：
  dsh-tui / headless 下是 node，桌面 App 下是 Electron 二进制——后者需要 `ELECTRON_RUN_AS_NODE=1`
  （已实测：`ELECTRON_RUN_AS_NODE=1 "<App>/Contents/MacOS/DeepSeek Harness" script.mjs` 正常执行）。
  这样不依赖 PATH 里有没有第二个 node。
- **`detached: true` + 进程组信号**。`npx` 是包装进程，真正的 `rea mcp` 是它的子进程；只对 `npx` 发
  SIGTERM 会留下孤儿引擎——正好是这层要消灭的现象。所以 spawn 时放进独立进程组，停止时
  `process.kill(-pid, signal)`，SIGTERM 之后 3 s 再补 SIGKILL。
- **清单缓存必须带 spec 指纹**。换 `REA_MCP_SPEC` 时旧清单会少/多工具，所以文件名是
  `manifest-<slug(spec)>.json`，读的时候再核一次文件里的 `spec` 字段，不匹配就重建。

### 11.4 首次启动仍会拉起一次

全新机器没有清单，缓存就是「怎么知道有 139 个工具」的唯一来源，所以第一次	extbf{必须}拉起一次 REA 来采样。
把这一步前置即可：`npm run setup -- --warm` 会自己跑一遍握手（顺便下好 npx 那份包），
之后每次宿主启动都是零引擎。
