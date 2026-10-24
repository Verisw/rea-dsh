# 贡献指南

## 先读这两份

- [docs/architecture.md](docs/architecture.md)：装载链路、realm 规则、`!!js` 求值环境、
  可移植性策略。**改 `cordis.patch.yml` 之前必须读**，否则很容易写出「能解析但永不生效」的组合。
- [docs/troubleshooting.md](docs/troubleshooting.md)：这个包的失败模式几乎都是静默的，
  排障方式不是找报错，而是逐个确认某一步真的发生了。

## 改动的唯一入口

`cordis.patch.yml` 是唯一真相。`tui/agent.cordis.yml` 是 `npm run sync:tui` 生成的投影——
**不要手改**，改了会在下次生成时被覆盖，`npm run verify` 也会报漂移。`tui/` 整体只是回退形态，
改动不要往那边加东西。

```sh
npm install          # js-yaml
npm run setup        # 一键：装进本机所有 profile 并校验（= 下面三条的组合）
npm run sync:tui     # 改完 patch 之后
npm run verify       # 必须 PASS（离线、与机器无关）
npm run verify:profiles   # 本机装了 dsh 的话：四个 profile 的真实装载结果
node scripts/setup.mjs --warm   # 改了 scripts/rea-lazy.mjs 之后：真跑一遍握手与 idle 停止
```

`scripts/rea-lazy.mjs` 是唯一有运行期状态的脚本（子进程、计时器、清单缓存）。
它的约定写在文件头：`REA_LAZY_MODE` / `REA_LAZY_IDLE_MS` / `REA_LAZY_CACHE` / `REA_MCP_SPEC`。
改它之后至少验证三件事——冷缓存握手不 spawn、首次调用能拉起、idle 之后进程组里没有残留。

## 提交前自查

- [ ] `npm run verify` 全绿（没装 dsh 的机器上，宿主相关项应为 `SKIP` 而不是 FAIL）。
- [ ] 装过本包的 profile 上 `npm run verify:profiles` 全绿（这条查的是宿主真的装载出了
      `preset-reverse`，离线 `verify` 覆盖不到）。
- [ ] 没有引入机器相关绝对路径（`/Users/...`、`/home/<user>/...`、`C:\Users\...`）。
- [ ] 新增 `!!js` 表达式只写纯量；需要多行就用 `>-` 折叠块，别用以反引号开头的模板字符串。
- [ ] `mcp-client` 的 `env` 值都是非空字符串（`undefined` 会让整个 config 校验抛错，
      `''` 会被 REA 当成显式配置）。
- [ ] 服务行放在带 `isolate` 的 group 里；新增 group 时想清楚「谁在 realm 外读这个服务」。
- [ ] 相对当前 `standard` 基座的 diff 仍然只有预期的几处（`verify` 会打印 added/missing 的 WARN）。
- [ ] 动过 `scripts/rea-lazy.mjs` 的话：`node --check` 通过，且上面的 warm 跑完能打印出
      `拿到 139 个工具`；子进程仍然用 `detached: true` + 进程组信号停止（否则会留孤儿引擎）。

## 关于 `standard` 基座

本 preset 的正文是宿主自带 `dsh-web-app/presets/standard.patch.yml` 的副本加若干 delta。
宿主升级会带来行集变化（历史上：`workflow-worker-thread` → `workflow-ptc`、新增
`tool-plugin-manager`、`tool-ralph` 转 disabled）。这类变化不报错，只会静默少功能，
所以升级 PR 请附上 `npm run verify` 的完整输出。

## 提交信息

用祈使句，一行说清改了什么，例如：

```text
fix: keep REA alive when the engine probe fails
docs: explain why bundledSkillDir must be absolute
feat: expose REA_MCP_SPEC override
```
