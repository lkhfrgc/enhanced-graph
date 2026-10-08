# 上架 Obsidian 社区插件

依据 Obsidian 官方文档整理：[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)、[Submission requirements for plugins](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)、[Developer policies](https://docs.obsidian.md/Developer+policies)、[obsidian-releases README](https://github.com/obsidianmd/obsidian-releases)。

> 最后核对：2026-10-07。Obsidian 的条款与政策可能变更，上架前请重新过一遍上面的链接。

---

## 一、仓库侧：已经就绪的

| 要求 | 状态 |
|---|---|
| `README.md` 说明用途与用法 | ✅ |
| `LICENSE` | ✅ GPL-3.0-only |
| `manifest.json` 六个必需字段 | ✅ id / name / version / minAppVersion / description / author / isDesktopOnly |
| 描述 ≤ 250 字符、以句号结尾、无 emoji | ✅ 96 字符 |
| `id` 不含 `obsidian` | ✅ `enhanced-graph` |
| 未使用 `fundingUrl`（无捐赠时须移除） | ✅ 未声明 |
| 无网络请求 / 遥测 / 广告 / 自更新 | ✅ 源码里零网络调用 |
| 遵守所用代码的许可并署名 | ✅ `NOTICE` + `THIRD-PARTY-NOTICES.md` + README |
| 尊重 Obsidian 商标 | ✅ 名称、id、描述均未把本插件说成官方出品 |
| `versions.json` | ✅ `{"1.0.0": "1.9.10"}` |
| 发布工作流 `.github/workflows/release.yml` | ✅ |
| `npm run build:ci`（产出到仓库根目录，CI 用） | ✅ |

## 二、只有你能做的：GitHub 仓库

仓库目前**没有 remote**，所以这一步必须你来。

1. 在 GitHub 建一个**公开**仓库（审核需要能读到源码）。建议名字：`enhanced-graph`。
2. 关联并推送：

```bash
git remote add origin https://github.com/lkhfrgc/enhanced-graph.git
git push -u origin main
```

3. 到仓库 **Settings → Actions → General → Workflow permissions**，选 **Read and write permissions**，保存。
   不选的话工作流无法创建 release。

## 三、发布第一个版本

1. 确认 `manifest.json` 的 `version` 与 `versions.json` 的键一致（当前都是 `1.0.0`）。
2. 打 tag —— **tag 必须与 `manifest.json` 的 version 完全相同**：

```bash
git tag -a 1.0.0 -m "1.0.0"
git push origin 1.0.0
```

3. 工作流会依次：跑类型检查与单测 → 校验 tag 与 version 一致 → 校验 `versions.json` 有对应条目 → 构建 → 创建草稿 release 并附上四个文件 → **读回附件列表，确认它们真的上传成功** → 自动发布。

   第 3 步里那句"读回确认"不是多余的：`gh release create` 在附件静默丢失时**仍然返回 0**，而 Obsidian 恰恰是从 release 附件抓取 `main.js` / `manifest.json` / `styles.css` 的。没有这道校验，一个装不上的 release 会安安静静地发出去。校验不通过时工作流失败，草稿留着，不会发布。

4. 发布说明放在 [`docs/releases/<tag>.md`](releases/)（例如 `docs/releases/1.0.0.md`），随代码一起版本化。**发新版本前先建好这个文件**，否则该版本会退回到 GitHub 自动生成的说明。

> 重新推送同一个 tag 会**重建**该 release（工作流先删除同名 release 再创建），所以改完代码重发同一个版本是可行的。

## 四、提交审核

> **流程已于 2026 年变更。** 过去是给 `obsidianmd/obsidian-releases` 的 `community-plugins.json` 提 PR；现在改为在**社区目录网站上填表单**。`community-plugins.json` 仍存在，但由目录系统维护，提交者不再手改它。
>
> 依据：[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)、[Set up and claim](https://docs.obsidian.md/community-directory/set-up-and-claim)。

### 前置条件

- GitHub 账号 ✅（已有）
- **Obsidian 账号** —— 提交必须用它登录，没有就先去 [obsidian.md/account](https://obsidian.md/account/) 注册

### 步骤

1. 打开 [community.obsidian.md](https://community.obsidian.md)，右上角 **Sign in**，用 Obsidian 账号登录。没有账号就按提示创建。
2. 在 **GitHub** 一栏点 **Connect**，授权关联你的 GitHub 账号。这会跳转到 GitHub 让你确认；授权是**只读的公开资料权限**，用途是核实你确实拥有所提交的仓库。**不完成这一步无法提交。**
3. 授权后页面会列出你名下仓库里可用于登记的条目（**Available to claim**）。如果 `enhanced-graph` 出现在列表里，勾选并 **Claim**；没有的话走下一步手动添加。
4. 左侧 **Plugins** → **New plugin**，填表：
   - **GitHub repository URL**：`https://github.com/lkhfrgc/enhanced-graph`
   - **Owner**：选 Myself
   - 阅读并同意开发者政策，确认会持续维护（或无法维护时下架/转让）
   - **Submit**
5. 提交后**自动审核**开始跑。目录页面会直接列出需要修正的问题。

### 关于 id 与描述

- `id` 在全目录内必须唯一，且**不能含有 `obsidian`** —— `enhanced-graph` ✅
- 目录读取的是你**默认分支 HEAD 上的 `manifest.json`**，所以提交前它必须是已提交的准确内容 ✅
- 条目页会拉取你仓库的 `README.md` 作为简介，**相对链接和图片会被自动重写**为指向仓库 ✅

## 五、审核之后

- **被要求修改时：改完代码后要发布一个 version 递增的新 release。** 只更新现有 release 是不够的——目录按版本号识别新提交。
- 通过后可以到论坛 [Share & showcase](https://forum.obsidian.md/c/share-showcase/9) 和 Discord 的 `#updates` 频道公告（后者需要 `developer` 角色）

## 六、后续发版

改 `manifest.json` 的 `version` → 在 `versions.json` 加一条映射 → 打同名 tag → 推送。工作流会自动创建、校验并发布 release。**不需要再走一次目录提交。**

---

## 已知的两个风险（不是流程问题）

1. **官方图谱增强与 Obsidian 版本绑定。** 该功能需要在运行中的图谱上叠加，不同版本之间可用的能力不同，因此 Obsidian 更新后可能失效。这不是审核的硬性禁止项，但审核者可能会问。代码里已全部做能力探测 + try/catch，缺失时只关掉对应功能，不影响官方图谱本身。

   `npm run verify:obsidian` 会在**真实 Obsidian** 里跑 5 项断言并打印被验证的版本号。目前实测：**1.9.10 与 1.14.4 均通过**。

2. **`minAppVersion: 1.9.10` 意味着低于此版本的用户装不上。** `versions.json` 目前只有一条映射，所以老版本用户没有可回退的版本 —— 这在只有一个版本时是正常的。

## 上架前建议再跑一遍

```bash
npm run verify              # 类型检查 + 单测 + 仓库级 + 浏览器 + 产物冒烟
npm run verify:obsidian     # 真实 Obsidian（需要本机装有 Obsidian）
npm run archive:terms       # 确认 Obsidian 条款没有变化
```
