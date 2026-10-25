# 上架插件市场

DSH 的「插件商店」是第三方包 **dsh-plugin-hub** 提供的界面。它没有一个人工审核后台：
列表是把三个数据源拼起来渲染的，所以「发布到市场」不是点一个提交按钮，而是让其中任何一条
命中本仓库。

| 数据源 | 从哪来 | 影响哪块界面 | 命中条件 |
|---|---|---|---|
| **mirror** | GitHub 搜索 `topic:dsh-plugin`（以及 `"dsh-plugin" in:name,description`），只取前 3 页 × 100 = **300 条**（`dsh-plugin-hub/lib/host/github.js` 的 `DISCOVERY_QUERIES` + `searchRepos`） | 商店主列表 | 仓库被搜索命中，且排在前 300 |
| **catalog** | 社区总目录 [leenkcool/Blue-Whale-Harness](https://github.com/leenkcool/Blue-Whale-Harness) 的 `repos.txt`（2000+ 行），由 hub 的 `catalog-sync` 拉进本地库 | 目录 / 百科视图 | 文件里有一行 `owner/repo` |
| **seed** | hub 包内自带的离线预置目录（`seed-catalog.ts`） | 商店主列表（带 seed 标记） | 内置名单，外部写不进去 |

分类（工具 / Agent / 界面美化 / 数据处理 …）由 `deriveCategories()` 从
**package.json 的 keywords + 仓库 topics** 推断；商店标题取 `pkg.displayName ?? pkg.name`。
两者都在本仓库里改，改完推送即可，不需要发版。

## 商店的「发布」页做了什么

`dsh-plugin-hub/lib/host/publish.ts` 的顺序是：校验 GitHub/npm token → 检查仓库是否存在、
不存在则创建 → `git init -b main` + add/commit/push → 设置 topics（**总是追加 `dsh-plugin`**）
→ 打 `v{version}` release →（可选）`npm publish`。

因为本仓库早已存在并推送，这一步等价于「补 topic + 补 release + 发 npm」，没有额外的注册动作。
换句话说：**商店里能不能看到你，取决于上面那张表，而不是取决于你有没有点过发布按钮。**

## 本仓库的现状

| 项 | 状态 |
|---|---|
| `dsh.bundle.patch` 声明 | ✅ 根目录 `cordis.patch.yml` |
| 仓库 topics（含 `dsh-plugin`） | ✅ 13 个 |
| `displayName` / keywords → 分类 | ✅ 标题「逆向工程模式 · Reverse Engineering」，分类 工具 / Agent / 开发 |
| `v1.0.0` release | ✅ 与 package.json 版本对齐 |
| mirror（前 300） | ⚠️ 未进入：`topic:dsh-plugin` 命中上万个仓库，新仓库排不进去 |
| catalog（Blue-Whale 总目录） | ⚠️ 已提交 [issue #185](https://github.com/leenkcool/Blue-Whale-Harness/issues/185)，等维护者写入 `repos.txt` |
| npm | ⚠️ 未发布：发布后商店改从 registry 安装（`hasNpm: true`），比 git clone 快 |

随时复查：

```bash
npm run market:check
```

它走的是商店自己的代码路径（装了 dsh-plugin-hub 时直接调用它的 `GitHubClient` 与
`scanPlugin`），打印七节体检：包形状 / 商店里长什么样 / 安全扫描 / GitHub 侧 /
市场发现 / 社区总目录 / npm，最后给 `RESULT`。阻塞项（缺 `dsh.bundle.patch`、缺 topic、
仓库私有…）返回退出码 1。

## README 与商店详情页

- 详情页正文取仓库的 `README.md`，「截图」取 README 里**所有内联图片**（最多 8 张）。
  五个 shields 徽章会被当成五张截图，所以两个 README 的徽章都写成**引用式**
  （`[![verify][badge-verify]][ci]` + 文末定义），GitHub 上照常显示，商店里不会污染截图页。
- 列表摘要取仓库 description 的前 120 字符。

## 安全扫描

`scanPlugin()` 给出 `clean` / `warning` / `malicious` 三档，只有 `malicious` 会拒绝发布。
本仓库当前是 `warning`：规则命中的是「子进程 / 动态执行 / 疑似密钥文件」这类正则，而本包的
`scripts/` 里确实有 `child_process` 与 `new Function` 的 `!!js` 校验逻辑，属于误报；
详情页会带一条风险提示，不影响安装。

## 想更快被看到

1. 等 catalog 收录（最确定的一条路），或直接给 `repos.txt` 提 PR 加一行 `Verisw/rea-dsh`。
2. 发 npm：`hasNpm: true` 后商店安装走 registry，且 npm 搜索 `keywords:dsh-plugin` 也能搜到。
3. 攒 star / 在 README 首屏放一张真实界面图，会被社区目录的 star 排序推到前面。
