# dsh-git-branch-status

> 在 DSH 会话输入框下方显示当前工作目录所在的 Git 分支。

`dsh-git-branch-status` 是一个轻量的 DeepSeek Harness（DSH）Web 插件 bundle：它在 composer（输入框）底部左侧渲染一个小巧的分支标签，让你随时知道当前会话的改动会落在哪个分支上。当前目录不在 Git 仓库中时，它完全不占位，输入框保持原样。

## 特性

- **一目了然**：分支图标 + 分支名，悬停可查看「分支 — 工作目录」。
- **分离 HEAD 友好**：detached HEAD 时显示 `@<short-sha>`，并改用警告色提示。
- **自动隐藏**：工作目录不在 Git 仓库内，或系统找不到 `git` 时，不渲染任何内容。
- **自动刷新**：窗口重新获得焦点、页面重新可见时立即刷新，此外每 20 秒轮询一次；Host 端对同一会话另有 2 秒结果缓存。
- **严格只读**：只执行 `git rev-parse` 与 `git symbolic-ref`，不会修改仓库，也不会获取可选锁（`GIT_OPTIONAL_LOCKS=0`）。
- **会话隔离**：按会话（Session）解析各自的工作目录，多会话、多仓库互不干扰。
- **中英双语**：界面文案跟随 DSH 客户端的语言设置。

## 工作原理

插件由 Host 与 Client 两半组成，通过一条同源、需认证的只读 JSON 路由通信：

```
┌──────────────────────────── 浏览器 ─────────────────────────────┐
│ client.js                                                       │
│   conversation.composer.dock 槽位 → <GitBranchStatus>            │
│   fetch('/git-branch/status?session=<id>')                       │
└───────────────────────────────┬─────────────────────────────────┘
                                │ 同源请求
┌───────────────────────────────▼─────────────────────────────────┐
│ index.js（Host 进程）                                            │
│   GET /git-branch/status → 会话 → 工作目录 → git 只读查询         │
│   返回 { ok, session, cwd, repo, branch, detached }              │
└─────────────────────────────────────────────────────────────────┘
```

**Host 端（`index.js`）**

1. 用 `connection.requestRejection()` 校验请求已通过 DSH 连接认证，只接受 `GET` / `HEAD`；
2. 按 `session` 参数找到会话，并通过 `workingDirectory` 服务取得其工作目录；
3. 在该目录执行 `git rev-parse --show-toplevel` 定位仓库根；
4. 执行 `git symbolic-ref --short -q HEAD` 取分支名；若处于 detached HEAD，则退回 `git rev-parse --short HEAD` 取短提交号；
5. 返回 JSON，并按会话缓存 2 秒。

每次 git 调用都有 4 秒超时和输出上限，并以 `LC_ALL=C`、`GIT_TERMINAL_PROMPT=0` 运行，避免交互提示或本地化输出影响解析。

**Client 端（`client.js`）**

1. 向 `conversation.composer.dock` 槽位注册一个 ambient 条目；
2. 拉取上述接口并渲染分支标签，分支为空时返回 `null`；
3. 用一个不可见的「平衡元素」占住行尾空白，使标签贴左的同时不挤动输入框原有的控件。

## 安装

### 前置条件

- 已安装可用的 DSH，并使用 Web profile（已在 `0.2.2-rc.1` 上验证）；
- `git` 可执行文件位于 `PATH` 中；
- 本包是本地开发的 bundle，尚未发布到 npm。

### 方式一：插件页（推荐）

1. 启动 `dsh web` 并打开页面；
2. 进入侧边栏的 **插件**（Plugins）页面；
3. 点击 **添加插件** → **安装第三方插件**，填入本仓库的绝对路径；
4. 安装完成后选择 **立即启用**。

### 方式二：命令行

```bash
dsh plugin --profile web add link:/path/to/dsh-git-branch-status
```

然后让 profile 加载该 bundle：在 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 末尾加入 `"@local/git-branch-status"`，或在 **插件** 页面把它打开。

```json
{
  "dependencies": {
    "@local/git-branch-status": "link:/path/to/dsh-git-branch-status"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@local/git-branch-status"
      ]
    }
  }
}
```

profile 若开启了 HMR（`"patchReload": "live"`）会自动生效；否则重启 `dsh web` 后生效。

## 使用

打开任意会话，只要它的工作目录位于某个 Git 仓库内，输入框卡片下方左侧就会出现分支标签：

- **普通分支**：显示分支名，悬停显示 `main，位于 /path/to/repo`；
- **detached HEAD**：显示 `@1a2b3c4`，颜色变为警告色，悬停显示 `分离头指针，提交 1a2b3c4`；
- **非 Git 目录 / 找不到 git**：不显示。

## HTTP 接口

```
GET /git-branch/status?session=<sessionId>
```

正常响应（`200`）：

```json
{
  "ok": true,
  "session": "c3f0…",
  "cwd": "/home/me/project",
  "repo": "/home/me/project",
  "branch": "main",
  "detached": false
}
```

| 场景 | 状态码 | 响应 |
| --- | --- | --- |
| 正常 | `200` | `{ "ok": true, ... }` |
| 缺少 `session` | `400` | `{ "ok": false, "error": "missing-session" }` |
| 未知会话 | `404` | `{ "ok": false, "error": "unknown-session" }` |
| 非 `GET` / `HEAD` | `405` | 空响应，带 `Allow: GET, HEAD` |

不在 Git 仓库中时，字段为 `repo: null, branch: null, detached: false`。响应带 `cache-control: no-store`。

## 项目结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：注册只读路由、解析会话工作目录、执行 git 查询 |
| `client.js` | Client 半：注册 composer dock 槽位并渲染分支标签 |
| `cordis.patch.yml` | bundle 补丁，向组合中插入 `git-branch-status` 条目 |
| `package.json` | 包元数据，以及 `dsh.bundle` / `dsh.client` 清单 |
| `locale/en.json`、`locale/zh.json` | 插件在插件管理页中的标题与描述 |
| `icon.svg` | 插件图标 |
| `LICENSE` | Apache-2.0 |

## 开发

无需构建步骤：Host 端是原生 ESM，Client 端是浏览器 `__ModuleLoader__` 工厂。

- 修改 `client.js` 后刷新页面即可；profile 开启 HMR 时会自动重载。
- 修改 `index.js` 后需要重启 DSH 进程（Host 代码不会热替换）。
- 调试时可查看浏览器开发者工具中 `GET /git-branch/status?session=...` 的响应；该路由要求同源登录态，直接 `curl` 通常会被拒绝。

### 可调参数（`index.js` 顶部）

| 常量 | 默认值 | 说明 |
| --- | --- | --- |
| `ROUTE` | `/git-branch/status` | 必须与 Client 端一致，且在 Host 上唯一 |
| `CACHE_MS` | `2000` | 同一会话结果的缓存时长 |
| `GIT_TIMEOUT_MS` | `4000` | 单次 git 调用的超时时间 |
| `OUTPUT_MAX_BYTES` | `8192` | 每个输出流保留的字节上限 |

## 已知限制

- 仅支持 Web 平台（`dsh.client.platform: "web"`）。
- 分支名取自 `symbolic-ref`；在裸仓库、`git` 缺失或调用超时的情况下，标签会隐藏。
- 客户端每 20 秒轮询一次，从外部切换分支后最迟约 20 秒（或窗口重新聚焦时）更新。
- 不读取远端信息，因此不显示 ahead/behind 状态。

## 许可证

[Apache-2.0](LICENSE)
