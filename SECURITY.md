# 安全说明

本包是**配置**：一份 `cordis.patch.yml` 加一个随包技能，没有入口模块，也不会执行来自网络的代码。
但它会做两件与安全边界相关的事，装之前应该知道。

## 1. 它会启动一个子进程

`mcp-rea` 行通过 `npx` 拉起 `rea-agents@6.3.0 mcp`：

- 子进程以当前用户的权限运行，工作目录与 dsh 进程相同；
- 环境变量来自 dsh 进程，宿主会剥掉 `DSH_*` 与敏感命名变量，代理变量会被继承；
- `npx` 首次运行会从 npm registry 下载包（之后走缓存，我们传了 `--prefer-offline`）。

固定版本是刻意的：`rea-agents@6.3.0` 是写死的 spec，不是 `latest`。
想升级就显式设 `REA_MCP_SPEC`，或改 `cordis.patch.yml` 里的 pin。

## 2. 它给 agent 一套逆向工具

REA 能反编译、读写分析工程、启动调试器。这些能力**只在选了逆向工程模式的会话里**存在，
但一旦存在，agent 就能对它有权限访问的任何文件使用它们。

permission 面由宿主决定（`sandbox-policy` / `approval`），本 preset 不参与、也不放宽它。
装之前请确认：你接受「逆向模式会话里的 agent 能读它能读到的二进制并驱动分析引擎」。

## 报告问题

- 组合/装载/兼容性问题 → 开 issue，附 `dsh --version` 与 `npm run verify` 的完整输出。
- 上游 REA 的问题 → [morluto/rea](https://github.com/morluto/rea)。
- 本包配置里的安全问题（例如某处把权限面意外放宽） → 请走私密渠道，别开公开 issue：
  在仓库 Security 页用 "Report a vulnerability"。
