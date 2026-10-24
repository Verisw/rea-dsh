# 回退形态：profile patch（默认用不到）

> **先读这段。** 1.0.0 起 bundle 本身就覆盖四个 profile（`desktop` / `web` / `headless` /
> `dsh-tui`），装法是 `npm run link:all` 或 `dsh plugin --profile <name> add github:Verisw/rea-dsh`，
> 不需要本目录。实测：`npm run verify:profiles` 在四个 profile 上都能从 bundle 层装载出
> `preset-reverse`（21 行插件）。
>
> 只有当你的 dsh 版本**不从 `dsh.profile.bundles` 读 bundle** 时，才走下面的 patch 形态。
> 两者同时生效会得到两条 `preset-reverse`，assembly 里会看到重复行。

同一个逆向工程模式，在 **dsh-tui** 上的补丁式落地形态。内容与 bundle 一致：REA 的 MCP 工具 +
逆向工程人设 + 逆向工作流技能；差异只在**怎么装**。

```text
rea-dsh/
├── cordis.patch.yml        ← 唯一真相（preset 声明 + 组合正文）
├── skills/reverse-workflow ← 随包技能
└── tui/
    ├── agent.cordis.yml    ← 生成物：npm run sync:tui 从上面那份 patch 投影而来
    ├── profile.patch.yml   ← 装载点片段（并进 profile patch）
    └── preset.yml          ← 仅 name/description/order 的备忘，不被任何组件读取

~/.dsh/profiles/dsh-tui/cordis.patch.yml   ← 真正生效的地方：一行 preset-reverse 声明，
                                             config.plugins 是一条 include 指向 tui/agent.cordis.yml
```

## 为什么是「声明」而不是目录

dsh-tui 的组合里两套名册是二选一的：

| patch 行 | 包 | 何时生效 |
|---|---|---|
| `dsh-tui-agent-presets` | `@deepseek-ai/dsh-agent-presets`（目录式，扫 `$DSH_HOME/.agent-presets`） | 仅当 registry **解析不到**时 |
| `dsh-tui-agent-preset-registry` | `@deepseek-ai/dsh-agent-preset-registry`（声明式） | registry 能解析时 |

启动时 `host-dsh.js` 会做 "resolution hijack"，把 **PATH 上的 `dsh`** 的安装作用域接进 Node 解析。
本机 PATH 上的 `dsh` 是 `/opt/homebrew/bin/dsh` → `@deepseek-ai/dsh@0.2.0-rc.2`，自带
`dsh-agent-preset-registry`，**所以走 registry**。registry 的 README 写得很直白：
*"the registry neither scans directories nor accepts preset paths"*——
`~/.dsh/.agent-presets/reverse/` 这种目录预设在这条线上根本不会被读到。

> 目录与旧名册：TUI 自己仍会把随包 preset（`liangshen`）物化到 `$DSH_HOME/.agent-presets/`，
> 那是给老宿主用的；新宿主下 liangshen 也是启动时用 registry 声明的。

## 相对 standard 的四处 delta

基座 = 宿主自带的 `dsh-web-app/presets/standard.patch.yml`（本机对应 dsh 0.2.0-rc.2）。

```text
added:          mcp-rea, tool-presentation
removed:        (none)
config-changed: persona, skill-filesystem
```

| # | 位置 | 改动 |
|---|---|---|
| 1 | `persona.config.prefix` | 逆向工程分析师人设（与桌面 bundle 逐字一致） |
| 2 | 新增 `mcp-rea` | 指向本包 `scripts/rea-lazy.mjs`（lazy 转接层，见 `docs/architecture.md` §11）→ 工具名 `mcp__rea__<name>`，只在本 preset 作用域可见 |
| 3 | `skill-filesystem.config.bundledSkillDir` | `!!js` 自解析到仓库根的 `skills/`（必须是绝对路径：相对的 `config` 路径没有任何组件会解析，会落到 `process.cwd()`） |
| 4 | 末尾 `tool-presentation` | `mode: native`：REA 的 139 个工具在 `ptc` 下会折叠成代码调用面 |

REA 自己的技能 `reverse-engineer-anything` **不需要** `customSkillDirs`：
`~/.agents/skills` 是 `skill-filesystem` 默认的 `user-agents` 根，本来就扫到。

## 安装

把 `profile.patch.yml` 的内容并进 `~/.dsh/profiles/dsh-tui/cordis.patch.yml`，把里面
`file:///.../tui/agent.cordis.yml` 换成本机这份仓库的绝对路径，然后重启 TUI。

## 用起来

```sh
dsh-tui           # 或 dst
```

- `/preset` 打开选择器 → 「逆向工程模式」；或 `/preset reverse`。
- 改完组合文件**要重启**：声明在启动组合时生效（profile 的 `patchReload` 不重读这份 patch）。
- 已产生对话的会话不能切 preset，空白会话可原地切，否则 `/new`。
- 验证连接与工具数：`/mcp`。

## 可用性与限制

- **挂载是 eager，引擎不是**：声明一注册，registry 就把子树 mount 起来，所以 `mcp-rea` 那一行的
  进程每次启动都在；但它连的是本包的转接层，只回答 `initialize` / `tools/list`（清单从缓存读），
  REA 要等第一次真实 `tools/call` 才拉起，静默 10 分钟后自行退出。
  旧 README 说的「dsh-tui 惰性挂载、不用就不花钱」只对目录名册那条线成立，而转接层把它也覆盖了。
- REA 的 139 个工具都会注册，但依赖具体引擎的工具要引擎在场才真能用。
- `failOnStartupError: false`：npx 慢/无网/REA 报错时 preset 不会变 broken，
  后果是「模式照常可选，但 REA 工具数为 0」。`/mcp` 是第一个能看出来的地方。
- 权限面沿用 TUI 的：`sandbox-policy` / `approval` 由部署与 `/permission` 决定，preset 不参与。

## 校验

```sh
npm run sync:tui:check    # 只检查 tui/agent.cordis.yml 是否与 patch 漂移
npm run verify            # 全量：结构、可移植性、twin 同构、宿主 schema
```

不要再手抄两份组合：`tui/agent.cordis.yml` 是生成物，手改会在下一次 `sync:tui` 被覆盖，
且 `verify` 会拦住漂移。

## 卸载

1. 删掉 `~/.dsh/profiles/dsh-tui/cordis.patch.yml` 里的 `preset-reverse` 行，重启。
2. 老目录 `~/.dsh/.agent-presets/reverse` 是死文件，可留可删（`rm -rf` 前先确认没有别的软链指着它）。

## 维护点

| 项 | 位置 | 说明 |
|---|---|---|
| 声明行 | `~/.dsh/profiles/dsh-tui/cordis.patch.yml` | id/name/description/order + include 路径 |
| 组合正文 | `cordis.patch.yml` | 改这里，然后 `npm run sync:tui` |
| REA 版本 | `cordis.patch.yml` 的 `mcp-rea.env.REA_MCP_SPEC` + `scripts/rea-lazy.mjs` 的默认值 | pin `rea-agents@6.3.0`（npx 缓存目录名是 spec 的哈希），可用 `REA_MCP_SPEC` 覆盖 |
| `--prefer-offline` | 同上 | 不要删：裸 `npx -y` 在热缓存 + registry 不可达时实测约 71 s，超过 MCP SDK 的 60 s 请求超时 → 静默丢掉全部工具 |
| Hopper 路径 | 同上 `mcp-rea.env` | 从环境变量读，**不要设成空串** |
| `mcp` 必须是唯一位置参数 | `scripts/rea-lazy.mjs` 的 `startChild()` | 传给 REA bin 多一个 flag 会掉进 CLI 分支 |
| YAML 表达式 | 全文 `!!js` | 纯量表达式；反引号开头的模板字符串会被 YAML 当保留指示符，解析直接失败 |
| `bundledSkillDir` | `skill-filesystem` 行 | `!!js` 自解析，移动仓库后无需改；解析失败时该键被丢弃（静默少一个技能） |
| 基座同步 | 整份组合 | 宿主升级后与 `standard.patch.yml` 重新 diff，见 `docs/architecture.md` §10 |
| `preset.yml` | `tui/preset.yml` | 不被任何组件读取，name/description/order 以声明行为准 |
