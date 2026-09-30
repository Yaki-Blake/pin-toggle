import { Plugin, PluginSettingTab, Setting, App, Hotkey } from 'obsidian';

/**
 * 拿到 Electron 的 remote 对象。
 * Obsidian 1.4+ 重新开放了 require('electron').remote；
 * 个别环境下可能需要 @electron/remote，这里做一层兜底。
 */
function getElectronRemote(): any {
	let r: any = null;
	try {
		r = require('electron').remote;
	} catch (e) {
		// ignore
	}
	if (!r) {
		try {
			r = require('@electron/remote');
		} catch (e) {
			// ignore
		}
	}
	return r;
}

/** 把 Obsidian 存的按键（如空格、Escape、ArrowUp）规范化成 Electron accelerator 能识别的写法 */
function normalizeKey(k: string): string {
	const map: Record<string, string> = {
		' ': 'Space',
		Escape: 'Esc',
		ArrowUp: 'Up',
		ArrowDown: 'Down',
		ArrowLeft: 'Left',
		ArrowRight: 'Right',
	};
	return map[k] || k;
}

/** 把 Obsidian 的 Hotkey 转成 Electron accelerator 字符串，例如 "Ctrl+Shift+A" */
function hotkeyToAccelerator(hk: Hotkey): string {
	const modMap: Record<string, string> = {
		Mod: 'CmdOrCtrl',
		Meta: 'Meta',
		Ctrl: 'Ctrl',
		Shift: 'Shift',
		Alt: 'Alt',
	};
	const mods = (hk.modifiers || []).map((m) => modMap[m] || m);
	const key = normalizeKey(hk.key || '');
	if (!key) return '';
	return [...mods, key].join('+');
}

/** 未在任何 vault 绑定热键时，使用的开箱即用默认全局键 */
const DEFAULT_ACCELERATOR = 'Ctrl+Alt+Space';

interface PinSettings {
	/** 唤出时是否让窗口真正浮在最上层（挡住其他软件） */
	alwaysOnTop: boolean;
	/** 收起方式：true=隐藏窗口(不占任务栏，像 Alt+E 收起) / false=最小化到任务栏 */
	hideInsteadOfMinimize: boolean;
}

const DEFAULT_SETTINGS: PinSettings = {
	alwaysOnTop: true,
	hideInsteadOfMinimize: true,
};

export default class PinTogglePlugin extends Plugin {
	settings: PinSettings;
	private remote: any = null;
	private currentAccelerator = '';
	private isPinned = false;
	private lastToggleTs = 0;

	async onload() {
		await this.loadSettings();
		this.remote = getElectronRemote();

		// 注册标准命令：会出现在命令面板，以及"设置 → 快捷键"里供绑定
		this.addCommand({
			id: 'toggle',
			name: 'Pin Toggle：唤出 / 收起 Obsidian 窗口',
			callback: () => this.toggleWindow(),
		});

		this.addSettingTab(new PinSettingTab(this.app, this));
		this.addRibbonIcon('pin', 'Pin / unpin Obsidian window', () => this.toggleWindow());

		// 读取"设置→快捷键"里绑定的键，并注册为系统级全局热键；之后每 2 秒自动同步一次
		this.syncGlobalHotkey();
		this.registerInterval(window.setInterval(() => this.syncGlobalHotkey(), 2000));

		if (!this.remote) {
			console.warn(
				'[Pin Toggle] 无法获取 Electron remote，全局热键不可用。请确认 Obsidian 版本 >= 1.4.0，或已启用 @electron/remote。'
			);
		}
	}

	onunload() {
		this.unregisterGlobalHotkey();
	}

	private getWindow(): any {
		if (!this.remote) return null;
		return this.remote.getCurrentWindow();
	}

	toggleWindow() {
		// 去重：避免"标准快捷键触发"与"全局热键触发"在同一按键下被重复执行
		const now = Date.now();
		if (now - this.lastToggleTs < 300) return;
		this.lastToggleTs = now;

		const win = this.getWindow();
		if (!win) return;

		if (this.isPinned) {
			// 收起
			if (this.settings.alwaysOnTop) {
				try {
					win.setAlwaysOnTop(false);
				} catch (e) {}
			}
			if (this.settings.hideInsteadOfMinimize) {
				win.hide();
			} else {
				win.minimize();
			}
			this.isPinned = false;
		} else {
			// 唤出并置顶
			if (this.settings.alwaysOnTop) {
				try {
					win.setAlwaysOnTop(true);
				} catch (e) {}
			}
			win.show();
			win.focus();
			try {
				win.moveTop();
			} catch (e) {}
			this.isPinned = true;
		}
	}

	/** 读取用户在"设置→快捷键"里给本命令绑的键，注册成系统级全局热键；未绑定则用默认值 */
	syncGlobalHotkey() {
		if (!this.remote) return;
		let acc = '';
		const hks = this.app.hotkeyManager.getHotkeys('pin-toggle:toggle');
		if (hks && hks.length) {
			acc = hotkeyToAccelerator(hks[0]);
		} else {
			acc = DEFAULT_ACCELERATOR;
		}
		if (acc === this.currentAccelerator) return; // 无变化，跳过
		this.unregisterGlobalHotkey();
		if (acc) {
			try {
				this.remote.globalShortcut.register(acc, () => this.toggleWindow());
				this.currentAccelerator = acc;
			} catch (e) {
				console.error('[Pin Toggle] 注册全局热键失败：', acc, e);
				this.currentAccelerator = '';
			}
		}
	}

	private unregisterGlobalHotkey() {
		if (!this.remote || !this.currentAccelerator) return;
		try {
			this.remote.globalShortcut.unregister(this.currentAccelerator);
		} catch (e) {
			// ignore
		}
		this.currentAccelerator = '';
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Pin Toggle 设置' });

		containerEl.createEl('p', {
			text:
				'快捷键请在 Obsidian 标准入口设置：设置 → 快捷键，搜索 "Pin Toggle"，给 "Pin Toggle：唤出 / 收起 Obsidian 窗口" 绑定按键。' +
				'绑定后插件会自动把它注册为系统级全局热键（即使 Obsidian 在后台也能唤起），无需在此手动输入。',
		});

		new Setting(containerEl)
			.setName('立即同步全局热键')
			.setDesc('改完标准快捷键后若未即时生效，点此手动刷新一次。')
			.addButton((btn) =>
				btn.setButtonText('同步').onClick(() => this.plugin.syncGlobalHotkey())
			);

		new Setting(containerEl)
			.setName('置顶 (Always on top)')
			.setDesc('唤出时是否让窗口真正浮在最上层、挡住其他软件；关闭则只"带到前台"。')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.alwaysOnTop).onChange(async (v) => {
					this.plugin.settings.alwaysOnTop = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('收起方式')
			.setDesc('关闭时：隐藏窗口（不占任务栏，像 Alt+E 收起）还是最小化到任务栏。')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.hideInsteadOfMinimize).onChange(async (v) => {
					this.plugin.settings.hideInsteadOfMinimize = v;
					await this.plugin.saveSettings();
				})
			);
	}
}
