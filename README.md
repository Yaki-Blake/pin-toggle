# Pin Toggle (Alt+E style)

一个极简 Obsidian 桌面插件：**一次全局热键把窗口唤出并置顶，再按一次收起**。行为对标 WorkBuddy 的 `Alt+E`。

## 功能

- 系统级全局热键（Obsidian 无焦点时也能触发）。
- 按一次：窗口置顶 + 拉到最前；再按一次：取消置顶 + 收起。
- 热键、是否真·置顶、收起方式均为可配置项。
- 桌面端专用（Windows / macOS / Linux）。

## 安装（手动）

1. 关闭 Obsidian（或确保目标 vault 已打开）。
2. 在本目录找到三个文件：`manifest.json`、`main.js`、`styles.css`。
3. 在你的 vault 内创建目录：`<你的vault>/.obsidian/plugins/pin-toggle/`
   - 注意文件夹名必须与 `manifest.json` 里的 `id`（即 `pin-toggle`）一致。
4. 把上述三个文件复制进去。
5. 打开 Obsidian → `设置` → `社区插件` → 关闭"安全模式" → 在"已安装插件"列表里启用 **Pin Toggle (Alt+E style)**。

## 配置（快捷键走 Obsidian 标准入口）

本插件完全适配 Obsidian：**快捷键就在 Obsidian 自己的"设置 → 快捷键"里改**，不需要去插件设置页手敲按键。

1. 打开 Obsidian → `设置` → `快捷键`。
2. 搜索 **Pin Toggle**，找到命令 **"Pin Toggle：唤出 / 收起 Obsidian 窗口"**。
3. 点它右侧的录制按钮，按下你想要的组合键（例如 `Ctrl+Alt+Space`）绑定即可。
4. 绑定后插件会在数秒内自动把该键注册为**系统级全局热键**（即使 Obsidian 在后台/最小化也能唤起）。
   - 若未立即生效，打开本插件的设置页点一下"立即同步全局热键"。
5. 若你从不在"快捷键"页绑定，插件会默认使用 `Ctrl+Alt+Space` 作为全局键，开箱即用。

插件设置页仅保留两项行为开关：

| 选项 | 说明 | 默认 |
|------|------|------|
| 置顶 (Always on top) | 唤出时是否真正浮在最上层挡住其他软件；关掉则只"带到前台"。 | 开 |
| 收起方式 | 关闭时隐藏窗口（不占任务栏，像 Alt+E 收起）或最小化到任务栏。 | 隐藏 |

## 使用

在任意软件按下你设定的热键 → Obsidian 立即置顶唤出；用完再按 → 收起，回到原工作。左侧边栏也有一个 📌 图标可点按切换；命令面板里也能搜到该命令手动执行。

## 注意事项

- 若控制台出现 `[Pin Toggle] 无法获取 Electron remote`：确认 Obsidian ≥ 1.4.0；个别环境需在主进程启用 `@electron/remote`，此时插件会自动尝试回退到该模块。
- 全局热键若与系统/其他软件冲突，去设置页改一个即可。
- 该插件仅控制 Obsidian 主窗口，不会退出应用，收起后可随时再次唤出。

## 重新构建（开发用）

```bash
npm install -D esbuild obsidian
./node_modules/.bin/esbuild src/main.ts --bundle --external:obsidian --external:electron --format=cjs --platform=node --outfile=main.js
```

## 发布到 Obsidian 社区市场（供他人安装）

仓库根目录需含：`manifest.json`、`main.js`、`styles.css`、`README.md`、`LICENSE`、`versions.json`。本目录已齐备。

1. 在 GitHub 新建**公开**仓库（如 `pin-toggle`），把本目录全部内容推上去（不要含 `node_modules/`）。
2. 打一个 Release：
   - Tag 必须与 `manifest.json` 的 `version` 完全一致（如 `0.1.0`，**不要**加 `v` 前缀）。
   - 把 `main.js`、`manifest.json`、`styles.css` 作为**二进制附件**上传到该 Release。
3. 提交到市场（二选一）：
   - **方式 A（官方推荐）**：登录 [community.obsidian.md](https://community.obsidian.md)，关联 GitHub 账号，添加你的插件，目录会自动读取仓库默认分支的 `manifest.json` 与对应 Tag 的 Release 资源。
   - **方式 B（传统 PR）**：Fork [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)，在 `.community-plugins.json` 末尾追加：
     ```json
     { "id": "pin-toggle", "name": "Pin Toggle (Alt+E style)", "author": "阿威 (黄义威 / yiwei668)", "description": "全局热键一键把 Obsidian 唤出并置顶，再按一次收起。", "repo": "你的用户名/pin-toggle" }
     ```
     然后提 PR，按模板完成自检，等待审核合并。
4. 上架后用户即可在 Obsidian `设置 → 社区插件 → 浏览` 中直接搜索安装。后续更新只需递增 `version` 并打新 Release。

> 提示：`manifest.json` 的 `description` 上限 250 字符且以句号结尾；`id` 不能含 `obsidian` 字样、须全局唯一；本插件 `isDesktopOnly: true`（依赖 Electron），仅桌面端可用。
