# Changelog

所有值得注意的改动都记在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/)，
版本号遵循 [SemVer](https://semver.org/)。

## [1.0.0] - 2026-10-24

首个公开版本。

### 文档

- README 改为双语入口：两个文件顶部互链（当前语言加粗），并补上 verify / license /
  node / dsh / 工具数徽章；`docs/` 仍是中文，英文页明确标注这一点。
- `npm run verify` 新增 `docs` 段：两个 README 必须互相链接、所有相对链接必须能落地、
  都必须出现包名——防止开关或改名之后留下死链。

### 发布自动化

- 新增 `.github/workflows/release.yml`：推 `v*` tag 时先跑 `verify` /
  `sync-tui --check` / `publish-check`，再 `npm publish --provenance`，最后回查
  registry 并自动建 Release。凭证两段走：首次发布用 `NPM_TOKEN` secret，
  之后改为 OIDC Trusted Publishing，仓库里不留长期密钥。
- 新增 `scripts/publish-check.mjs`（`npm run publish:check`）：tag 与
  `package.json` 版本对齐、CHANGELOG 有对应小节、包名是否已被占、发布后
  `--verify-registry` 回查。发错版本号在 npm 上是不可逆的，这一步放在 CI 里做。
- `package.json` 增加 `publishConfig.access = public`。

### 发布形态

- 仓库根目录**就是** npm 包：`package.json` 带 `dsh.bundle.patch`，
  `dsh plugin --profile desktop add github:Verisw/rea-dsh` 直接可用。
- 组合正文集中到根 `cordis.patch.yml`；`tui/agent.cordis.yml` 改为由
  `npm run sync:tui` 生成的投影，不再手抄两份。
- 新增 `skills/reverse-workflow/`（随包技能），删除对 `bundles/` 旧路径与
  `tui/skills` 符号链接的引用。

### 可移植性

- 移除全部机器相关绝对路径：
  - `bundledSkillDir` 改为 `!!js` 自解析（`createRequire(ctx.baseUrl)` 找包，退到
    `../skills/`，全落空则丢弃该键）；
  - 删除 `customSkillDirs`（`~/.agents/skills` 已是默认 `user-agents` 根）；
  - `GHIDRA_INSTALL_DIR` / `JAVA_HOME` / `HOPPER_LAUNCHER_PATH` / `REA_IDA_MCP_CONFIG`
    全部改为读环境变量，空串被过滤；Hopper 的 macOS 默认路径仅在文件存在时采用。
- REA 版本仍 pin `rea-agents@6.3.0`，可用 `REA_MCP_SPEC` 覆盖，无需改包。

### 生命周期

- 新增 `scripts/rea-lazy.mjs`：夹在宿主与 REA 之间的 stdio MCP 转接层。
  宿主启动时它只回答 `initialize` / `tools/list`（清单来自
  `<dsh home>/cache/dsh-rea-reverse-preset/manifest-<spec>.json`），139 个工具照常注册；
  第一次真实 `tools/call` 才拉起 REA，静默 `REA_LAZY_IDLE_MS`（默认 10 分钟）后自动停止。
  实测：冷缓存握手 52 ms / 22 ms，零 REA 进程；首次调用 1.6 s 拉起；idle 停止后无残留进程。
- `mcp-rea` 行改为 `command: !!js process.execPath` + 自解析 `scripts/rea-lazy.mjs`，
  桌面 App 下自动带 `ELECTRON_RUN_AS_NODE=1`；REA 以独立进程组启动，
  停止时对整组发信号，避免 `npx` 包装进程被杀而 `rea mcp` 变孤儿。
- 新增 `REA_LAZY_IDLE_MS` / `REA_LAZY_MODE` / `REA_LAZY_CACHE` 三个环境变量；
  `REA_LAZY_MODE=eager` 可退回旧行为。
- `npm run setup -- --warm` 改为走转接层跑一遍握手：既下好 npx 包，也把工具清单缓存生成好，
  之后每次宿主启动都是零引擎。

### 新增

- `npm run setup`（`scripts/setup.mjs`，也注册为 `dsh-rea-setup` bin）：一键流程——
  环境自检 → 装进全部 profile → 探分析引擎（Hopper / Ghidra / Java 21 / IDA）→
  `verify` + 每个 profile 的真实装载校验 → 打印重启指引。参数：`--check` / `--write-env` /
  `--warm` / `--uninstall` / `--dry-run`。在 checkout 里软链安装，从 npm 包里跑则走
  `dsh plugin --profile <p> add`。
- `npm run verify`：结构、可移植性、tui 同构、宿主 `standard` 基座与实时 Schemastery 校验。
- `npm run sync:tui` / `sync:tui:check`：生成并守护 tui 侧组合。
- `npm run link:desktop|link:web|link:headless|link:tui|link:all` 与 `unlink:all`：
  本地软链进 profile（幂等）。`scripts/install.mjs` 支持 `--profile` 重复传、`--all`、`--uninstall`。
- `npm run verify:profiles`（`scripts/check-profiles.mjs`）：从宿主加载
  `@deepseek-ai/dsh-app-boot`，对每个已装本包的 profile 调 `loadProfileDirectory`，
  断言 `preset-reverse` 行真的进了组合——这是离线 `verify` 查不到的那一层。
- 文档：`docs/architecture.md`（装载链路、realm、`!!js` 求值、兼容性门槛）、
  `docs/troubleshooting.md`（静默失败路径与实测数据）、`README.en.md`。
- 包图标 `icon.png`。

### 变更

- **一套机制覆盖四个 profile**：`desktop`（桌面 App / 本机 Web GUI）、`web`（`dsh web`）、
  `headless`（`dsh -p`）、`dsh-tui` 都直接读 `dsh.profile.bundles`，不再需要 TUI 专用的
  profile patch。`tui/` 与 `sync:tui` 降级为「宿主不读 bundle 时」的回退形态。
- preset 声明与 34 个插件行的组合保持不变：相对宿主 `standard` 仍是
  + `mcp-rea`、+ `tool-presentation`，改 `persona` 与 `skill-filesystem`。
- `package.json` 声明 `peerDependencies`：`@deepseek-ai/dsh >=0.2.0-rc.2 <0.3.0-0`
  （`optional`，避免 npm 自动装宿主）。宿主升级到 0.3.x 时本包会被 `skippedBundles` 跳过，
  而不是破坏 profile。

- `package.json` 增加同名 bin 别名 `dsh-rea-reverse-preset`（原先只有 `dsh-rea-setup`），
  `npx -y dsh-rea-reverse-preset --check` 可直接跑；两个 bin 都指向 `scripts/setup.mjs`。

### 修复

- `bundledSkillDir` 去掉 `process.cwd()` 候选：从 npm 安装后的包里跑校验时，这个兜底会
  猜出一个真实路径，与「落空就丢弃该键」的设计相反。现在只看组合锚点
  （`ctx.baseUrl`：已装包 → 邻近 `../skills/`），启动目录不再决定技能是否加载。
- `scripts/setup.mjs` 的 CLI 探测改为看行为（`dsh --version` 有没有输出）：`dsh` 的入口是
  `if (import.meta.main) await runCli()`，Node 23.x / 24.2 之前没有该属性，`dsh plugin` 会
  静默 exit 0 而什么都没做；它跑在 PATH 上的 node 里，与本脚本自身的 node 未必同一个。
  另外 `dsh plugin add` 返回 0 之后会复核 profile 里是否真有这个包，没装上就报错——
  空转和「包还没发布」都能当场看见，而不是被写成「安装成功」。

### 验证（发布前实测）

- `npm pack` → 22 个文件 / 66 KB：`cordis.patch.yml`、`skills/`、`scripts/`（含转接层）、
  `tui/`、`docs/`、`icon.png` 全在包内，无 `.git` 残留路径。
- 把 tarball 用 `dsh plugin --profile web add file:…tgz` 装进全新 `DSH_HOME`：profile 自动
  初始化、`dsh.profile.bundles` 自动追加、`loadProfileDirectory` 组合出
  `preset reverse / 21 plugin rows`、`skippedBundles: []`。
- 从安装副本（不是 checkout）跑 `scripts/verify.mjs`：RESULT PASS，39 项全过。
- `dsh plugin --profile web remove` 与「装完再复核」两条路径实测：无输出 CLI → 安装前就被拦；
  假装有版本、add 空转的 CLI → `add 返回 0，但 profile 里没有 …`；把包名换成 tarball 模拟已发布
  → pnpm 装好、`dsh.profile.bundles` 自动追加、`verify` 与 `verify:profiles` 全 PASS。
- 从安装副本跑转接层（`process.execPath` + 相对锚点解析）：冷启动拉起 REA 1.4 s、
  139 个工具入清单；热启动 `initialize` 61 ms / `tools/list` 80 ms，零 REA 进程。

### 已知问题

- 全新机器首次启动仍会拉起一次 REA：没有清单就不知道有哪些工具。跑一次
  `npm run setup -- --warm` 可把这一步前置，之后不再出现。
- 已有对话历史的会话不能切换 preset（宿主约束）。

## [0.x] - 2026-10 之前（未公开）

内部迭代：desktop bundle 与 dsh-tui 双形态、REA 6.3.0 pin、`--prefer-offline` 的必要性
（裸 `npx -y` 在 registry 不可达时会撞上 MCP SDK 的 60 s 超时并静默丢掉全部工具）、
realm/isolate 修正、`persona` 与 `skill-filesystem` 的 delta 固定。
