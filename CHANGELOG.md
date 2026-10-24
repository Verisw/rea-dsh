# Changelog

所有值得注意的改动都记在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/)，
版本号遵循 [SemVer](https://semver.org/)。

## [1.0.0] - 2026-10-24

首个公开版本。

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

### 已知问题

- preset 声明 eager 挂载，启动即拉起 REA（热 ~1.4 s、冷 ~3.7 s）。
- 已有对话历史的会话不能切换 preset（宿主约束）。

## [0.x] - 2026-10 之前（未公开）

内部迭代：desktop bundle 与 dsh-tui 双形态、REA 6.3.0 pin、`--prefer-offline` 的必要性
（裸 `npx -y` 在 registry 不可达时会撞上 MCP SDK 的 60 s 超时并静默丢掉全部工具）、
realm/isolate 修正、`persona` 与 `skill-filesystem` 的 delta 固定。
