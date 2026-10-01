import { App, Hotkey, Plugin, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import { remote, type ElectronWindow } from 'electron';

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

interface PinSettings {
	/** 唤出时是否让窗口真正浮在最上层（挡住其他软件） */
	alwaysOnTop: boolean;
	/** 收起方式：true=隐藏窗口（不占任务栏）/ false=最小化到任务栏 */
	hideInsteadOfMinimize: boolean;
}

const DEFAULT_SETTINGS: PinSettings = {
	alwaysOnTop: true,
	hideInsteadOfMinimize: true,
};

export default class PinTogglePlugin extends Plugin {
	settings: PinSettings = { ...DEFAULT_SETTINGS };

	private win: ElectronWindow | null = null;
	private currentAccelerator = '';
	private isPinned = false;
	private lastToggleTs = 0;

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
		}

		// 读取「设置 → 快捷键」里绑定的键并注册为系统级全局热键，之后每 2 秒同步一次
		this.syncGlobalHotkey();
		this.registerInterval(window.setInterval(() => this.syncGlobalHotkey(), 2000));
	}

	onunload() {
		this.unregisterGlobalHotkey();
	}

	toggleWindow() {
		const win = this.win;
		if (!win) return;

		// 去重：避免「标准快捷键触发」与「全局热键触发」被重复执行
		const now = Date.now();
		if (now - this.lastToggleTs < 300) return;
		this.lastToggleTs = now;

		const shouldPin = !this.isPinned;

		if (this.settings.alwaysOnTop) {
			try {
				win.setAlwaysOnTop(shouldPin);
			} catch (error) {
				console.error('[Pin Toggle] 切换置顶状态失败：', error);
			}
		}

		try {
			if (shouldPin) {
				win.show();
				win.focus();
				win.moveTop();
			} else if (this.settings.hideInsteadOfMinimize) {
				win.hide();
			} else {
				win.minimize();
			}
		} catch (error) {
			console.error('[Pin Toggle] 切换窗口显示状态失败：', error);
		}

		this.isPinned = shouldPin;
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
			remote.globalShortcut.register(accelerator, () => this.toggleWindow());
			this.currentAccelerator = accelerator;
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
		const stored = await this.loadData() as Partial<PinSettings> | null;
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
		if (key === 'alwaysOnTop' || key === 'hideInsteadOfMinimize') {
			this.plugin.settings[key] = Boolean(value);
			await this.plugin.saveSettings();
		}
	}
}
