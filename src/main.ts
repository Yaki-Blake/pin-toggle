import { App, Hotkey, Notice, Plugin, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import { remote, type ElectronWindow, type ElectronWindowListener } from 'electron';

/**
 * 把 Obsidian 记录的按键（空格、Escape、ArrowUp 等）规范化成
 * Electron accelerator 能识别的写法。
 */
function normalizeKey(key: string): string {
	const map: Record<string, string> = {
		' ': 'Space',
		Escape: 'Esc',
		ArrowUp: 'Up',
		ArrowDown: 'Down',
		ArrowLeft: 'Left',
		ArrowRight: 'Right',
	};
	return map[key] ?? key;
}

/** 把 Obsidian 的 Hotkey 转成 Electron accelerator 字符串，例如 "Ctrl+Shift+A" */
function hotkeyToAccelerator(hotkey: Hotkey): string {
	const modMap: Record<string, string> = {
		Mod: 'CmdOrCtrl',
		Meta: 'Meta',
		Ctrl: 'Ctrl',
		Shift: 'Shift',
		Alt: 'Alt',
	};
	const mods = (hotkey.modifiers ?? []).map((mod) => modMap[mod] ?? mod);
	const key = normalizeKey(hotkey.key ?? '');
	if (!key) return '';
	return [...mods, key].join('+');
}

/** 未在「设置 → 快捷键」中绑定任何按键时，使用的开箱即用默认全局键 */
const DEFAULT_ACCELERATOR = 'Ctrl+Alt+Space';

/**
 * 置顶层级。
 *
 * Electron 在 Windows 上并不用 level 决定层级高低，只用它判断要不要把窗口压到
 * 任务栏（Shell_TrayWnd）之后：命中 {"floating","torn-off-menu","modal-panel",
 * "main-menu","status"} 就会被压下去，而 "floating" 正是缺省值。窗口一旦被插到
 * 非 topmost 的任务栏之后，按 SetWindowPos 的语义就会失去 WS_EX_TOPMOST，
 * 随后任何全屏窗口都能盖住它。用 "screen-saver" 可以绕开这条路径。
 *
 * 参考：electron/shell/browser/native_window_views.cc
 *       SetAlwaysOnTop / MoveBehindTaskBarIfNeeded
 */
const PIN_LEVEL = 'screen-saver';

/**
 * 置顶守护的轮询间隔（毫秒）。
 * Windows 上全屏窗口天然高于 topmost 窗口（electron#10078，by OS design），
 * 唯一可行的补偿是周期性重新断言 z 序。
 */
const GUARD_INTERVAL_MS = 1500;

/** 同一次按键可能被标准快捷键与全局热键各触发一次，用时间窗去重 */
const TOGGLE_GUARD_MS = 250;

/** 全局热键同步间隔：用户可能随时在「设置 → 快捷键」里改绑定 */
const HOTKEY_SYNC_MS = 5000;

interface PinSettings {
	/** 唤出时是否让窗口真正浮在最上层（挡住其他软件） */
	alwaysOnTop: boolean;
	/** 收起方式：true=隐藏窗口（不占任务栏）/ false=最小化到任务栏 */
	hideInsteadOfMinimize: boolean;
	/** 是否持续维持置顶（被压下去后自动抢回上层） */
	keepOnTop: boolean;
}

const DEFAULT_SETTINGS: PinSettings = {
	alwaysOnTop: true,
	hideInsteadOfMinimize: true,
	keepOnTop: true,
};

/** 窗口的真实状态，全部从 Electron 读取，不用插件内部的布尔值自记账 */
type WinState = 'unavailable' | 'collapsed' | 'front' | 'pinned';

export default class PinTogglePlugin extends Plugin {
	settings: PinSettings = { ...DEFAULT_SETTINGS };

	private win: ElectronWindow | null = null;
	private currentAccelerator = '';
	private warnedAccelerator = '';
	private lastToggleTs = 0;
	private keeperHandlers: Record<string, ElectronWindowListener> = {};

	async onload() {
		await this.loadSettings();

		// 注册标准命令：会出现在命令面板，以及「设置 → 快捷键」里供绑定
		this.addCommand({
			id: 'toggle',
			name: '唤出 / 收起窗口',
			callback: () => this.toggleWindow(),
		});

		this.addSettingTab(new PinSettingTab(this.app, this));

		this.addRibbonIcon('pin', '唤出 / 收起窗口', () => this.toggleWindow());

		// 一次性拿到主窗口引用；拿不到就说明当前环境没有 Electron remote
		try {
			this.win = remote.getCurrentWindow();
		} catch (error) {
			this.win = null;
			console.error('[Pin Toggle] 无法获取 Electron 窗口，置顶与全局热键不可用。', error);
			return;
		}

		this.attachKeeper();
		this.syncGlobalHotkey();
		this.registerInterval(window.setInterval(() => this.syncGlobalHotkey(), HOTKEY_SYNC_MS));
	}

	onunload() {
		this.unregisterGlobalHotkey();
		this.detachKeeper();
	}

	/** 窗口的真实状态：唯一真相源 */
	private get realState(): WinState {
		const win = this.win;
		if (!win || win.isDestroyed()) return 'unavailable';
		if (!win.isVisible() || win.isMinimized()) return 'collapsed';
		return win.isAlwaysOnTop() ? 'pinned' : 'front';
	}

	toggleWindow() {
		const win = this.win;
		if (!win || win.isDestroyed()) return;

		// 去重：避免「标准快捷键触发」与「全局热键触发」被重复执行
		const now = Date.now();
		if (now - this.lastToggleTs < TOGGLE_GUARD_MS) return;
		this.lastToggleTs = now;

		const state = this.realState;
		// 看不见          -> 唤出
		// 看得见但没置顶  -> 说明被压下去过，重新置顶（不能误判成「收起」）
		// 看得见且已置顶  -> 收起
		if (state === 'collapsed' || state === 'unavailable') {
			this.summon();
			return;
		}
		if (this.settings.alwaysOnTop && state === 'front') {
			this.summon();
			return;
		}
		this.collapse();
	}

	private summon() {
		const win = this.win;
		if (!win || win.isDestroyed()) return;

		// 先定层级再显示，保证窗口一出现就带正确的 z 序
		if (this.settings.alwaysOnTop) {
			win.setAlwaysOnTop(true, PIN_LEVEL);
		}
		if (!win.isVisible()) win.show();
		win.focus();
		// focus() 会触发 Electron 内部的 OnWidgetActivationChanged ->
		// MoveBehindTaskBarIfNeeded()，在同一个 tick 内提 z 序会被它覆盖，
		// 必须等激活落地后再提一次。
		window.setTimeout(() => this.reassertTop(), 0);
	}

	private collapse() {
		const win = this.win;
		if (!win || win.isDestroyed()) return;

		// 先摘掉 topmost，避免窗口隐藏后残留置顶状态
		win.setAlwaysOnTop(false);
		if (this.settings.hideInsteadOfMinimize) {
			win.hide();
		} else {
			win.minimize();
		}
	}

	/** 立即取消窗口置顶（关闭「置顶」设置项时调用） */
	releaseTop() {
		const win = this.win;
		if (!win || win.isDestroyed()) return;
		try {
			win.setAlwaysOnTop(false);
		} catch (error) {
			console.error('[Pin Toggle] 取消置顶失败：', error);
		}
	}

	/**
	 * 重新断言置顶。
	 * 只用 moveTop()，绝不用 focus()——focus() 会抢走当前应用（例如全屏浏览器）
	 * 的焦点，用户就没法继续在页面上打字或操作。moveTop() 只调整 z 序，
	 * 不改变激活状态，是唯一安全的选择。
	 */
	private reassertTop() {
		const win = this.win;
		if (!win || win.isDestroyed()) return;
		if (!this.settings.alwaysOnTop || !this.settings.keepOnTop) return;
		if (!win.isVisible() || win.isMinimized()) return;

		if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, PIN_LEVEL);
		win.moveTop();
	}

	private attachKeeper() {
		const win = this.win;
		if (!win) return;

		const kick: ElectronWindowListener = () => {
			window.setTimeout(() => this.reassertTop(), 0);
		};
		// 激活 / 显示 / 还原都会触发系统 z 序重排；blur 用于被别的窗口压下去时抢回来
		this.keeperHandlers = { focus: kick, show: kick, restore: kick, blur: kick };
		for (const [event, handler] of Object.entries(this.keeperHandlers)) {
			win.on(event, handler);
		}

		this.registerInterval(
			window.setInterval(() => {
				if (this.realState === 'pinned') this.reassertTop();
			}, GUARD_INTERVAL_MS),
		);
	}

	private detachKeeper() {
		const win = this.win;
		try {
			if (win && !win.isDestroyed()) {
				for (const [event, handler] of Object.entries(this.keeperHandlers)) {
					win.off(event, handler);
				}
				// 插件被禁用后不应让窗口永久保持置顶
				win.setAlwaysOnTop(false);
			}
		} catch (error) {
			console.error('[Pin Toggle] 卸载清理失败：', error);
		}
		this.keeperHandlers = {};
		this.win = null;
	}

	/** 读取用户在「设置 → 快捷键」里给本命令绑的键，注册成系统级全局热键；未绑定则用默认值 */
	syncGlobalHotkey() {
		if (!this.win) return;

		let accelerator = '';
		const hotkeys = this.app.hotkeyManager.getHotkeys('pin-toggle:toggle');
		if (hotkeys && hotkeys.length > 0) {
			accelerator = hotkeyToAccelerator(hotkeys[0]);
		} else {
			accelerator = DEFAULT_ACCELERATOR;
		}

		// 无变化，跳过
		if (accelerator === this.currentAccelerator) return;

		this.unregisterGlobalHotkey();
		if (!accelerator) return;

		try {
			const registered = remote.globalShortcut.register(accelerator, () => this.toggleWindow());
			if (!registered) {
				// 只在同一个组合键上提示一次，避免轮询刷屏
				if (this.warnedAccelerator !== accelerator) {
					this.warnedAccelerator = accelerator;
					new Notice(
						`[Pin Toggle] 全局热键 ${accelerator} 注册失败：可能已被其他软件占用，` +
							'请在「设置 → 快捷键」里换一个组合键。',
						8000,
					);
				}
				return;
			}
			this.currentAccelerator = accelerator;
			this.warnedAccelerator = '';
		} catch (error) {
			console.error('[Pin Toggle] 注册全局热键失败：', accelerator, error);
			this.currentAccelerator = '';
		}
	}

	private unregisterGlobalHotkey() {
		if (!this.currentAccelerator) return;

		try {
			remote.globalShortcut.unregister(this.currentAccelerator);
		} catch (error) {
			console.error('[Pin Toggle] 注销全局热键失败：', error);
		}

		this.currentAccelerator = '';
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<PinSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...stored };
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class PinSettingTab extends PluginSettingTab {
	plugin: PinTogglePlugin;

	constructor(app: App, plugin: PinTogglePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: '快捷键',
				items: [
					{
						name: '绑定位置',
						desc:
							'在「设置 → 快捷键」中搜索本插件，给「唤出 / 收起窗口」绑定按键；' +
							'绑定后插件会在数秒内自动把它注册为系统级全局热键（即使窗口在后台也能唤出）。',
					},
					{
						name: '立即同步全局热键',
						desc: '改完标准快捷键后若未即时生效，点此手动刷新一次。',
						action: () => this.plugin.syncGlobalHotkey(),
					},
				],
			},
			{
				type: 'group',
				heading: '行为',
				items: [
					{
						name: '置顶 (always on top)',
						desc: '唤出时是否让窗口真正浮在最上层、挡住其他软件；关闭则只带到前台。',
						control: { type: 'toggle', key: 'alwaysOnTop' },
					},
					{
						name: '置顶守护',
						desc:
							'开启后持续维持置顶：被其他窗口（包括全屏浏览器）压下去时自动抢回上层。' +
							'关闭可省电，但会退化为「只在唤出那一刻置顶」。',
						control: { type: 'toggle', key: 'keepOnTop' },
					},
					{
						name: '收起方式',
						desc: '收起时：隐藏窗口（不占任务栏，像 Alt+E）还是最小化到任务栏。',
						control: { type: 'toggle', key: 'hideInsteadOfMinimize' },
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof PinSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'alwaysOnTop' || key === 'hideInsteadOfMinimize' || key === 'keepOnTop') {
			this.plugin.settings[key] = Boolean(value);
			await this.plugin.saveSettings();
			// 关掉「置顶」时立即同步窗口状态，避免设置与窗口不一致
			if (key === 'alwaysOnTop' && !value) this.plugin.releaseTop();
		}
	}
}
