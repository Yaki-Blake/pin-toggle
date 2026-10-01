# Pin Toggle

Summon the Obsidian window and pin it on top with a single system-wide hotkey — press the same key again to hide it. Behavior mirrors WorkBuddy's `Alt+E`.

Desktop only (Windows / macOS / Linux).

## Features

- System-wide global hotkey that fires even when the window is unfocused.
- First press: pin on top and bring to front. Second press: unpin and collapse.
- Configurable: hotkey source, true always-on-top, and how the window collapses.
- Desktop only — the plugin controls the native window, so mobile is not supported.

## Install (manual)

1. Close Obsidian, or make sure the target vault is open.
2. Copy these three files: `manifest.json`, `main.js`, `styles.css`.
3. Create the folder `<your-vault>/.obsidian/plugins/pin-toggle/`.
   The folder name must match the `id` field in `manifest.json` (`pin-toggle`).
4. Put the three files into that folder.
5. In Obsidian open `Settings → Community plugins`, turn off Restricted mode, then enable **Pin Toggle**.

## Configure the hotkey

Hotkeys are bound in Obsidian's own hotkey UI — not inside the plugin settings page.

1. Open `Settings → Hotkeys`.
2. Search for **Pin Toggle** and find the command **"唤出 / 收起窗口"** (summon / collapse window).
3. Click the record button and press the combination you want, for example `Ctrl+Alt+Space`.
4. The plugin registers it as a system-wide global hotkey within a couple of seconds, so it works even while the window is hidden or minimized.
   - If it does not take effect immediately, open the plugin settings and click **立即同步全局热键** (sync the global hotkey now).
5. If you never bind a hotkey, the plugin falls back to `Ctrl+Alt+Space`, so it works out of the box.

## Settings

| Option | Description | Default |
| --- | --- | --- |
| 置顶 (always on top) | Whether the summoned window really floats above other applications. Turn it off to merely bring it to the front. | On |
| 收起方式 | Collapse behavior: hide the window (no taskbar entry, like `Alt+E`) or minimize it to the taskbar. | Hide |

## Usage

Press your hotkey in any application: the window is summoned and pinned on top. Press it again to collapse and return to what you were doing. You can also use the 📌 ribbon icon in the left sidebar, or run the command from the command palette.

## Notes

- If the developer console shows `[Pin Toggle] 无法获取 Electron 窗口`, the Electron remote API is unavailable in your environment; pinning and the global hotkey are disabled.
- If the hotkey collides with the system or another application, bind a different combination in `Settings → Hotkeys`.
- The plugin only controls the Obsidian window. It never quits the app, so you can summon it again at any time.

## Build from source

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src/ package.json
npm run build       # bundles src/main.ts into main.js
```

## Releasing

The repository root must contain `manifest.json`, `main.js`, `styles.css`, `README.md`, `LICENSE`, and `versions.json`.

1. Increase `version` in `manifest.json` and add the matching entry to `versions.json`.
2. Build, then commit.
3. Create a GitHub release whose tag equals the `version` exactly (for example `0.1.1`, without a `v` prefix) and attach `main.js`, `manifest.json`, and `styles.css` as release assets.
4. Publish the new version from [community.obsidian.md](https://community.obsidian.md).

> `manifest.json`: `description` must be under 250 characters and end with a period; `id` must not contain "obsidian" and must be globally unique. This plugin sets `isDesktopOnly: true` because it uses Electron APIs.

---

## 中文说明

一个极简 Obsidian 桌面插件：**一次全局热键把窗口唤出并置顶，再按一次收起**。行为对标 WorkBuddy 的 `Alt+E`。

### 功能

- 系统级全局热键（窗口无焦点时也能触发）。
- 按一次：窗口置顶 + 拉到最前；再按一次：取消置顶 + 收起。
- 热键来源、是否真·置顶、收起方式均可配置。
- 桌面端专用（Windows / macOS / Linux）。

### 安装（手动）

1. 关闭 Obsidian（或确保目标 vault 已打开）。
2. 找到三个文件：`manifest.json`、`main.js`、`styles.css`。
3. 在 vault 内创建目录 `<你的vault>/.obsidian/plugins/pin-toggle/`
   - 文件夹名必须与 `manifest.json` 里的 `id`（即 `pin-toggle`）一致。
4. 把上述三个文件复制进去。
5. 打开 Obsidian → `设置` → `社区插件` → 关闭「安全模式」→ 在「已安装插件」列表里启用 **Pin Toggle**。

### 配置（快捷键走 Obsidian 标准入口）

快捷键在 Obsidian 自己的「设置 → 快捷键」里改，不需要去插件设置页手敲按键。

1. 打开 Obsidian → `设置` → `快捷键`。
2. 搜索 **Pin Toggle**，找到命令 **「唤出 / 收起窗口」**。
3. 点它右侧的录制按钮，按下你想要的组合键（例如 `Ctrl+Alt+Space`）绑定即可。
4. 绑定后插件会在数秒内自动把该键注册为**系统级全局热键**（即使窗口在后台/最小化也能唤起）。
   - 若未立即生效，打开本插件的设置页点一下「立即同步全局热键」。
5. 若你从不在「快捷键」页绑定，插件会默认使用 `Ctrl+Alt+Space`，开箱即用。

设置页只有两组：`快捷键`（绑定位置说明 + 立即同步按钮）与`行为`（两个开关）。

### 使用

在任意软件按下你设定的热键 → 窗口立即置顶唤出；用完再按 → 收起，回到原工作。左侧边栏也有一个 📌 图标可点按切换；命令面板里也能搜到该命令手动执行。

### 注意事项

- 若控制台出现 `[Pin Toggle] 无法获取 Electron 窗口`：说明当前环境拿不到 Electron remote，置顶与全局热键会停用。
- 全局热键若与系统/其他软件冲突，去「设置 → 快捷键」换一个即可。
- 该插件仅控制窗口，不会退出应用，收起后可随时再次唤出。

### 重新构建（开发用）

```bash
npm ci
npm run typecheck
npm run lint
npm run build
```

### 发布到 Obsidian 社区市场

仓库根目录需含：`manifest.json`、`main.js`、`styles.css`、`README.md`、`LICENSE`、`versions.json`。

1. 递增 `manifest.json` 的 `version`，并在 `versions.json` 里补上对应条目。
2. 构建并提交。
3. 打一个 Release：**Tag 必须与 `version` 完全一致**（如 `0.1.1`，不要加 `v` 前缀），并把 `main.js`、`manifest.json`、`styles.css` 作为二进制附件上传。
4. 登录 [community.obsidian.md](https://community.obsidian.md) 发布新版本。

> 提示：`manifest.json` 的 `description` 上限 250 字符且须以句号结尾；`id` 不能含 `obsidian` 字样且须全局唯一。本插件因使用 Electron API 而设置 `isDesktopOnly: true`。
