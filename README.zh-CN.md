# dsh-rea-reverse-preset

**简体中文** · [English](README.md) · [架构说明](docs/architecture.md) · [排障手册](docs/troubleshooting.md) · [更新日志](CHANGELOG.md)

[![verify](https://github.com/Verisw/rea-dsh/actions/workflows/verify.yml/badge.svg)](https://github.com/Verisw/rea-dsh/actions/workflows/verify.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520.16-brightgreen.svg)](package.json)
[![dsh](https://img.shields.io/badge/dsh-0.2.0--rc.2%20%E2%80%A6%200.3-blueviolet.svg)](docs/architecture.md)
[![tools](https://img.shields.io/badge/REA%20tools-139-informational.svg)](https://github.com/morluto/rea)

给 **DeepSeek Harness（dsh）** 加一个「逆向工程模式」。

在 dsh 的 preset 选择器里会多出一项 **逆向工程模式**，选中后 agent 就带着 [REA](https://github.com/morluto/rea)
的逆向工具（约 139 个，覆盖 Ghidra / Hopper / IDA 与二进制、Electron 制品分析）、一套逆向分析师
人设，以及一个强调「证据落点」的逆向工作流技能，可以直接对着样本开始干活。

## 这个模式能做什么

- **反编译 / 反汇编**：调 Ghidra、Hopper、IDA 的 headless 或 CLI，拿伪代码、交叉引用、调用图、函数边界。
- **二进制侦察**：字符串、符号、节区、导入导出表、熵与编译器指纹，先摸清结构再动手。
- **打包制品**：Electron 的 `.app` 与 asar、APK / IPA、JS bundle，解开再分析。
- **交叉验证**：同一个函数在多个引擎里对照，减少单一反编译器的误判。
- **落文档**：按「证据 → 结论」写分析记录，而不是「看起来像」。

引擎缺哪个，就少哪一组工具，其余照常可用——不会因为没装 IDA 就整个模式起不来。

## 为什么用它

| 优势 | 说明 |
|---|---|
| 一条命令装好 | `npm run setup` 装进所有界面，顺手探引擎、自检，最后告诉你重启哪一个。 |
| 一套覆盖四个界面 | 桌面 App、`dsh web`、dsh-tui、headless 共用同一份 bundle，不用各写一份配置。 |
| 不动宿主 | 只在 preset 里加一棵子树；权限、模型路由、沙箱、持久化仍由你的部署决定。 |
| 不常驻 | 宿主启动时不拉引擎：工具清单来自本地缓存，第一次真正调用工具才起 REA，静默 10 分钟自动退出。 |
| 换机器不用改文件 | 包里没有任何机器相关路径，引擎位置全走环境变量。 |
| 坏了不影响主流程 | REA 起不来时模式仍可选，只是少一组工具，不会把 dsh 拖崩。 |
| 卸载干净 | 摘掉 bundle 就回到原状，宿主自带组合一行未改。 |
| 自带自检 | `npm run verify` 离线校验结构与可移植性，`verify:profiles` 用宿主真实装载链路再验一遍。 |

## 安装

### 一条命令（推荐）

```sh
npx -y dsh-rea-reverse-preset setup   # 从 npm 包跑
npm run setup                         # 从 checkout 跑
```

它会依次：检查 node / dsh 版本与本机 profile → 装进每一个界面 → 探测 Hopper / Ghidra / Java / IDA →
跑校验 → 打印重启清单。中途不需要回答任何问题，重复执行是幂等的。

```sh
npx -y dsh-rea-reverse-preset --check         # 只看状态，不动文件
npm run setup -- --write-env                  # 把探到的引擎路径写进 ~/.zshrc
npm run setup -- --warm                       # 预热：把 REA 下好，并生成工具清单缓存
npm run setup -- --uninstall                  # 从所有界面卸掉
```

### 分界面手动装

| 你在用 | profile | 装法 | 生效方式 |
|---|---|---|---|
| 桌面 App | `desktop` | `dsh plugin --profile desktop add github:Verisw/rea-dsh` | 完全退出 App 再打开（Cmd+Q，不是关窗口） |
| 浏览器里的 `dsh web` | `web` | `dsh plugin --profile web add github:Verisw/rea-dsh` | 重启 `dsh web` |
| 终端里的 dsh-tui | `dsh-tui` | `dsh plugin --profile dsh-tui add github:Verisw/rea-dsh` | 重启 TUI |
| `dsh -p`（脚本 / headless） | `headless` | `dsh plugin --profile headless add github:Verisw/rea-dsh` | 下次运行自动带上 |

桌面 App 与 `dsh web` 是两个独立 profile，各装各的，装哪个只影响哪个界面。
桌面 profile 需要 App 自己先创建过一次——装之前先完全退出 App。

`dsh plugin` 本身要求 Node ≥ 22.18 / ≥ 24（更早的 Node 缺少 `import.meta.main`，
命令会静默退出、exit 0 但什么都没装）。`npm run setup` 会先探这一步；症状与处理见
[docs/troubleshooting.md](docs/troubleshooting.md) §10。

看本机装没装：

```sh
node scripts/install.mjs
```

```text
profiles under /Users/you/.dsh/profiles:
  desktop   installed
  dsh-tui   not installed
```

## 使用

1. 重启对应界面。
2. `/preset` → **逆向工程模式**（或直接 `/preset reverse`）。
3. `/mcp` 看一眼 REA 是否起来；起来后工具名形如 `mcp__rea__*`。
4. 开始分析：给它一个样本路径，说清楚要查什么（功能、协议、校验逻辑、版本差异…）。

有两点需要知道：

- **已经产生过对话的会话不能切 preset**，新开一个会话再切。
- **引擎不常驻**。模式挂载时 dsh 只启动一个很轻的转接进程，工具清单直接从本地缓存
  （`~/.dsh/cache/dsh-rea-reverse-preset/`）读出来给宿主，139 个工具照样在列；
  第一次真正调用 `mcp__rea__*` 才把 REA 拉起来（热缓存约 1–2 s），之后静默 10 分钟自动退出，
  下次调用再起。已经开着逆向会话也不会闲着占内存。
  缓存还没生成时（全新机器）第一次启动会拉起一次 REA 来填清单，跑
  `npm run setup -- --warm` 可以提前把这步做完，也顺带把 npx 的那份包下好。

### 引擎位置（可选）

不配也能用：REA 会自己找引擎。装了多个版本、或不在默认位置时，用这些变量指定。

| 环境变量 | 作用 |
|---|---|
| `HOPPER_LAUNCHER_PATH` | Hopper 的 CLI 入口。macOS 默认位置存在时会自动用上。 |
| `GHIDRA_INSTALL_DIR` | Ghidra 解压目录。版本要对得上 REA 的要求（当前 12.1.4）。 |
| `JAVA_HOME` | Ghidra 用的 JVM；PATH 上的 `java` 版本不够新时才需要。 |
| `REA_IDA_MCP_CONFIG` | IDA MCP 配置文件，IDA 9.x 走这个开关。 |
| `REA_MCP_SPEC` | 换 REA 版本，例如 `REA_MCP_SPEC=rea-agents@6.7.0`，不用改本包。 |
| `REA_LAZY_IDLE_MS` | 引擎静默多久自动退出，毫秒，默认 `600000`（10 分钟）；`0` 表示不退出。 |
| `REA_LAZY_MODE` | 填 `eager` 退回旧行为（宿主启动就拉起 REA），默认 `lazy`。 |

这些变量由 dsh 进程读取，**改完要重启界面**。写成空字符串等于没配，会被自动忽略。

## 卸载

```sh
dsh plugin --profile <desktop|web|headless|dsh-tui> remove dsh-rea-reverse-preset
npm run unlink:all        # 本地软链安装的用这个
```

## 常见问题

| 现象 | 先去查 |
|---|---|
| preset 列表里没有「逆向工程模式」 | 装到了别的 profile，或者没重启；dsh 版本不在支持区间时会被整包跳过。 |
| 模式在，但 REA 工具是 0 个 | npx 冷启动超时、环境变量传了空串、引擎路径不对、走了代理。 |
| 工具少了几十个 | 对应引擎没找到（例如没配 IDA），这是预期行为。 |
| 技能没挂上 | 包路径被移动过，或 profile 里同时装了两份。 |
| 改了配置不生效 | dsh 只在启动时读取这些设置，必须重启进程。 |
| 没开逆向模式却有个 `rea mcp` 进程 | 老版本装的是直连版（启动即拉起），或设了 `REA_LAZY_MODE=eager`。 |

逐条排查步骤见 [docs/troubleshooting.md](docs/troubleshooting.md)。

## 说明

- 本包只声明一个 preset（`id: reverse`），正文是 21 个顶层行 / 34 个插件行；打包形态是一个
  dsh **bundle**，因此 `dsh plugin add` 就能装。
- 宿主版本要求 `@deepseek-ai/dsh >=0.2.0-rc.2 <0.3.0-0`。超出区间时本包会被跳过并给出提示，
  而不是把你的组合改坏。
- 装了什么、为什么这么装、`!!js` 求值环境与兼容性门槛，见 [docs/architecture.md](docs/architecture.md)。

## 许可

MIT（见 [LICENSE](LICENSE)）。本包调用 [REA](https://github.com/morluto/rea)（MIT），不打包其代码；
Ghidra / Hopper / IDA 各自独立授权，本包不附带也不代管。
