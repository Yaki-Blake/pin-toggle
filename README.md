# Pin Toggle

Summon the Obsidian window and keep it on top with a single system-wide hotkey — press the same key again to hide it.

Desktop only (Windows / macOS / Linux).

## Features

- System-wide global hotkey that fires even when the window is unfocused.
- Three-state toggle driven by the real window state, not by an internal flag: invisible → summon, visible-but-not-on-top → re-pin, visible-and-on-top → collapse.
- **Topmost keeper**: re-asserts the window's z-order on focus/blur/show/restore and every 1.5 s, so it survives being pushed behind another window — including a fullscreen browser.
- Uses the `screen-saver` z-order level, which avoids Electron's Windows-only "place the window behind the taskbar" path.
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
4. The plugin registers it as a system-wide global hotkey within a few seconds, so it works even while the window is hidden or minimized.
   - If it does not take effect immediately, open the plugin settings and click **立即同步全局热键** (sync the global hotkey now).
   - If the combination is already taken by another app, a notice will tell you to pick a different one.
5. If you never bind a hotkey, the plugin falls back to `Ctrl+Alt+Space`, so it works out of the box.

> **Note**: the bound combination is registered **system-wide**, so it is captured from every application while the plugin is enabled. Prefer combinations that no other app relies on. `Alt+<letter>` is a poor choice on Windows — it also drives menu mnemonics.

## Settings

| Option | Description | Default |
| --- | --- | --- |
| 置顶 (always on top) | Whether the summoned window really floats above other applications. Turn it off to merely bring it to the front. | On |
| 置顶守护 (topmost keeper) | Keep re-asserting the z-order so the window cannot be pushed behind other windows. Turn it off to save power, at the cost of only pinning at summon time. | On |
| 收起方式 | Collapse behavior: hide the window (no taskbar entry, like `Alt+E`) or minimize it to the taskbar. | Hide |

## Usage

Press your hotkey in any application: the window is summoned and pinned on top. Press it again to collapse and return to what you were doing. You can also use the 📌 ribbon icon in the left sidebar, or run the command from the command palette.

## How the pinning actually works

Two details decide whether "always on top" survives contact with other applications.

**1. The z-order level matters on Windows.** `setAlwaysOnTop(flag)` defaults to the `floating` level. On Windows, Electron does not use the level to pick a z-order band — it uses it to decide whether the window should be placed *behind the taskbar* (`Shell_TrayWnd`). The levels `floating`, `torn-off-menu`, `modal-panel`, `main-menu` and `status` all trigger that behaviour. Windows documents that repositioning a topmost window after any non-topmost window **removes its topmost status**, so a window pinned at the default level can silently stop being topmost. This plugin pins at `screen-saver`, which is not in that set.

**2. A single `setAlwaysOnTop` call is not enough.** Fullscreen windows (browser `F11`, video fullscreen, PDF/PPT presentation) are raised above topmost windows by the OS. The only compensation is to re-assert the z-order periodically, which the keeper does — with `moveTop()` only, never `focus()`, so the focus stays wherever the user put it.

## Known limitations

1. **Exclusive fullscreen cannot be covered.** Games and DirectX exclusive-fullscreen apps render outside the normal window stack; no user-mode always-on-top window can appear above them. This is a Windows/OS constraint, not a plugin bug — the Electron maintainers describe it as "by OS design" ([electron#10078](https://github.com/electron/electron/issues/10078)). Borderless fullscreen (browser `F11`, video fullscreen, PDF/PPT presentation) *can* be covered.
2. **Covering a fullscreen window requires re-assertion.** A very short interval is more reliable but costs more CPU; 1.5 s is the default. Turn the keeper off if you prefer the old "pin once" behaviour.
3. **The keeper never calls `focus()`.** Stealing focus would prevent you from typing into the fullscreen page underneath. It only calls `moveTop()`, which changes the z-order without changing activation.
4. **macOS fullscreen spaces** additionally need `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, which has no effect on Windows.

## Troubleshooting

If the window still gets covered, run the read-only diagnostic probe while reproducing:

```bash
python tools/win-zorder-probe.py          # one shot
python tools/win-zorder-probe.py --watch  # live, once per second
```

It prints every top-level window's z-order, `WS_EX_TOPMOST` flag, fullscreen state and the Obsidian window's position relative to the taskbar, then classifies the failure as A/B/C/D.

- If the console shows `[Pin Toggle] 无法获取 Electron 窗口`, the Electron remote API is unavailable in your environment; pinning and the global hotkey are disabled.
- The plugin only controls the Obsidian window. It never quits the app, so you can summon it again at any time.

## Build from source

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src/ package.json
npm run build       # bundles src/main.ts into main.js
npm test            # state-machine smoke test against the built main.js
```

`src/main.ts` is the source of truth. `main.js` at the repository root is the esbuild bundle that Obsidian actually loads — do not edit it by hand.

---

## 中文说明

一个极简 Obsidian 桌面插件：**一次全局热键把窗口唤出并置顶，再按一次收起**。

### 功能

- 系统级全局热键（窗口无焦点时也能触发）。
- 三态切换，依据**窗口真实状态**而非插件内部标志：看不见 → 唤出；看得见但没置顶 → 重新置顶；看得见且已置顶 → 收起。
- **置顶守护**：在 focus/blur/show/restore 以及每 1.5 秒重新断言一次 z 序，被其他窗口（含全屏浏览器）压下去后能自动抢回上层。
- 使用 `screen-saver` 置顶层级，绕开 Electron 在 Windows 上「把窗口压到任务栏之后」的路径。
- 桌面端专用（Windows / macOS / Linux）。

### 安装（手动）

1. 关闭 Obsidian（或确保目标 vault 已打开）。
2. 找到三个文件：`manifest.json`、`main.js`、`styles.css`。
3. 在 vault 内创建目录 `<你的vault>/.obsidian/plugins/pin-toggle/`
   - 文件夹名必须与 `manifest.json` 里的 `id`（即 `pin-toggle`）一致。
4. 把上述三个文件复制进去。
5. 打开 Obsidian → `设置` → `社区插件` → 关闭「安全模式」→ 在「已安装插件」列表里启用 **Pin Toggle**。

### 配置（快捷键走 Obsidian 标准入口）

1. 打开 Obsidian → `设置` → `快捷键`。
2. 搜索 **Pin Toggle**，找到命令 **「唤出 / 收起窗口」**。
3. 点它右侧的录制按钮，按下你想要的组合键（例如 `Ctrl+Alt+Space`）绑定即可。
4. 绑定后插件会在数秒内自动把该键注册为**系统级全局热键**（即使窗口在后台/最小化也能唤起）。
   - 若未立即生效，打开本插件的设置页点一下「立即同步全局热键」。
   - 若该组合键已被其他软件占用，会弹出提示要求换一个。
5. 若你从不在「快捷键」页绑定，插件会默认使用 `Ctrl+Alt+Space`，开箱即用。

> **注意**：绑定的组合键会被**全局注册**，插件启用期间会从所有软件那里截获该按键。请避免使用其他软件依赖的组合键；Windows 上 `Alt+字母` 尤其不合适（会与菜单助记符冲突）。

### 使用

在任意软件按下你设定的热键 → 窗口立即置顶唤出；用完再按 → 收起，回到原工作。左侧边栏也有一个 📌 图标可点按切换；命令面板里也能搜到该命令手动执行。

### 置顶为什么以前会失效

两个细节决定「置顶」能不能扛住其他软件。

**一、Windows 上置顶层级很关键。** `setAlwaysOnTop(flag)` 缺省级别是 `floating`。Electron 在 Windows 上并不用这个级别决定层级高低，而是用它决定窗口**要不要被压到任务栏之后**——`floating`、`torn-off-menu`、`modal-panel`、`main-menu`、`status` 这五个都会触发该行为。而 Windows 官方文档明确：把最顶层窗口重新定位到任何非最顶层窗口之后，**它就不再是最顶层窗口**。所以按默认级别置顶的窗口可能悄悄失去 topmost。本插件改用 `screen-saver`，不命中该集合。

**二、只调用一次 `setAlwaysOnTop` 不够。** 全屏窗口（浏览器 `F11`、视频全屏、PDF/PPT 放映）会被操作系统抬到 topmost 窗口之上。唯一的补偿办法是周期性重新断言 z 序——由「置顶守护」完成，且只用 `moveTop()`、绝不用 `focus()`，不会打断你的输入。

### 已知限制

1. **独占全屏无法覆盖**。游戏/DirectX 独占全屏应用不在普通窗口栈里渲染，任何用户态置顶窗口都盖不住它。这是 Windows 的语义限制，不是插件缺陷（Electron 维护者称之为 "by OS design"，见 [electron#10078](https://github.com/electron/electron/issues/10078)）。无边框全屏（浏览器 `F11`、视频全屏、PDF/PPT 放映）**可以**覆盖。
2. **覆盖全屏窗口依赖持续重新断言**。间隔越短越稳、开销越大，默认 1.5 秒。关掉「置顶守护」即可回到旧的「只在唤出那一刻置顶」行为。
3. **守护过程绝不调用 `focus()`**。否则会抢走焦点，你就无法在全屏页面里打字。只用 `moveTop()`，只改 z 序、不改激活状态。
4. **macOS 全屏 Space** 还需 `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`，该 API 在 Windows 上无效。

### 排障

若窗口仍被盖住，在复现问题时运行只读诊断探针：

```bash
python tools/win-zorder-probe.py          # 打印一次
python tools/win-zorder-probe.py --watch  # 每秒刷新，边操作边看
```

它会打印所有顶层窗口的 z 序、`WS_EX_TOPMOST` 标志、是否全屏、以及 Obsidian 相对任务栏的位置，并给出 A/B/C/D 判定。

- 若控制台出现 `[Pin Toggle] 无法获取 Electron 窗口`：说明当前环境拿不到 Electron remote，置顶与全局热键会停用。
- 该插件仅控制窗口，不会退出应用，收起后可随时再次唤出。

### 重新构建（开发用）

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm test
```

`src/main.ts` 是源码；根目录的 `main.js` 是 esbuild 产物，**不要手改**。
