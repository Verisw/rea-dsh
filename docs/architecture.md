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

## 4. 两种落地点

| | 桌面 / Web | dsh-tui |
|---|---|---|
| 落地点 | bundle 的 `cordis.patch.yml` | profile patch 的 include 行 |
| 组合形态 | 声明行内联 `config.plugins` | 声明行 + `cordis-plugin-include` 指向 `tui/agent.cordis.yml` |
| 谁生成 | 手写（唯一真相） | `npm run sync:tui` |
| `ctx.baseUrl` | `file://<profile>/` | `file://<仓库>/tui/` |

两份组合必须逐行一致，靠 `verify.mjs` 的深比较守住（`tui composition equals the patch composition`）。
早期做法是「两份手抄 + 靠自觉同步」，实测已经漂移过，所以改成生成。

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
| 1 | 新增 `mcp-rea` | `npx --prefer-offline -y rea-agents@6.3.0 mcp`，工具名 `mcp__rea__<name>`，仅本子树可见 |
| 2 | 新增 `tool-presentation` | `mode: native`。REA 约 139 个工具在 `ptc` 下会折叠成代码调用面；不少部署默认 `ptc`，所以显式钉住而不是继承 |
| 3 | `persona.config.prefix` | 逆向分析师人设 |
| 4 | `skill-filesystem.config.bundledSkillDir` | 自解析到本仓 `skills/`（默认的 `customSkillDirs` 已删） |

`mcp-rea` 单独带 `failOnStartupError: false`：npx 冷启动/离线时，代价应该是「这个模式没有 REA 工具」，
而不是「整个 preset 变 broken，一个逆向会话都开不了」。

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
