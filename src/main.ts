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

/**
 * 输入法上屏后的静默尾巴（毫秒）。
 * 拼音选完词（compositionend）后的一小段时间内仍不重提 z 序，
 * 避免候选框刚收起、窗口就被抬到其它浮层之上。
 */
const COMPOSE_TAIL_MS = 300;

/**
 * 组合态的兜底过期时间（毫秒）。
 * compositionend 在极端情况下可能不送达（输入法进程崩溃、窗口被强杀），
 * 若只靠布尔标志，守卫会永久失效。超过这个时长没有任何组合事件就自动复位。
 */
const COMPOSE_STALE_MS = 10000;

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
	/** 是否让 Obsidian 自己弹出的窗口（设置页、新窗口笔记等）排在主窗口之上 */
	siblingsOnTop: boolean;
}

const DEFAULT_SETTINGS: PinSettings = {
	alwaysOnTop: true,
	hideInsteadOfMinimize: true,
	keepOnTop: true,
	siblingsOnTop: true,
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
	/** 插件是否主动置顶过；用户手动改变窗口状态后置 false，守护不再把置顶加回来 */
	private pinned = false;
	/** 被插件临时提升为置顶的同应用内部窗口 id，收起/卸载时统一还原 */
	private pinnedSiblings = new Set<number>();
	/** 输入法是否处于组合输入中（拼音候选框正在显示） */
	private composing = false;
	/** 最近一次组合事件的时间戳，用于计算静默尾巴与兜底复位 */
	private lastComposeTs = 0;

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

		this.pinned = true;
		// 先定层级再显示，保证窗口一出现就带正确的 z 序
		if (this.settings.alwaysOnTop) {
			win.setAlwaysOnTop(true, PIN_LEVEL);
		}
		// 用户手动点过最小化时 show() 不会把窗口从任务栏还原，必须显式 restore()
		if (win.isMinimized()) win.restore();
		if (!win.isVisible()) win.show();
		win.focus();
		// focus() 会触发 Electron 内部的 OnWidgetActivationChanged ->
		// MoveBehindTaskBarIfNeeded()，在同一个 tick 内提 z 序会被它覆盖，
		// 必须等激活落地后再提一次。这里是「用户主动唤出」，属于明确意图，
		// 因此绕过守护的焦点门控（force=true）。
		window.setTimeout(() => this.reassertTop(true), 0);
	}

	private collapse() {
		const win = this.win;
		if (!win || win.isDestroyed()) return;

		this.pinned = false;
		// 先摘掉 topmost，避免窗口隐藏后残留置顶状态
		win.setAlwaysOnTop(false);
		this.unpinSiblingWindows();
		if (this.settings.hideInsteadOfMinimize) {
			win.hide();
		} else {
			win.minimize();
		}
	}

	/** 立即取消窗口置顶（关闭「置顶」设置项时调用） */
	releaseTop() {
		const win = this.win;
		this.pinned = false;
		this.unpinSiblingWindows();
		if (!win || win.isDestroyed()) return;
		try {
			win.setAlwaysOnTop(false);
		} catch (error) {
			console.error('[Pin Toggle] 取消置顶失败：', error);
		}
	}

	/**
	 * 输入法是否正在组合输入（含上屏后的静默尾巴）。
	 *
	 * 拼音候选框本身也是一个 topmost 弹窗，与置顶后的编辑器同处最顶层窗口带。
	 * 此时调用 moveTop() 会把编辑器抬到候选框之上，选词结果被盖住 ——
	 * 这正是「输入拼音不到 2 秒就被置顶挡住」的成因。
	 */
	private isComposing(): boolean {
		if (!this.composing) {
			return Date.now() - this.lastComposeTs < COMPOSE_TAIL_MS;
		}
		// 兜底：compositionend 丢失时不能永久禁用守护
		if (Date.now() - this.lastComposeTs > COMPOSE_STALE_MS) {
			this.composing = false;
			return false;
		}
		return true;
	}

	/**
	 * 同进程内、除主窗口之外的可见窗口。
	 *
	 * Obsidian 的「设置」「在新窗口中打开」「对话框」等都是独立 BrowserWindow，
	 * 默认处于普通窗口带，会被置顶的主窗口压在下面 —— 这就是需要分层的原因。
	 */
	private getSiblingWindows(): ElectronWindow[] {
		const win = this.win;
		if (!win || win.isDestroyed()) return [];
		try {
			return remote.BrowserWindow.getAllWindows().filter(
				(w) => w && w.id !== win.id && !w.isDestroyed() && w.isVisible() && !w.isMinimized(),
			);
		} catch (error) {
			console.error('[Pin Toggle] 枚举应用窗口失败：', error);
			return [];
		}
	}

	/**
	 * 建立「主窗口 < 内部窗口」的稳定层级。
	 *
	 * Windows 的 z-order 只有 topmost / 非 topmost 两个带，无法给主窗口和内部窗口
	 * 各分配一个不同的层级带。可靠做法是：先让两者都进入 topmost 带（这样外部
	 * 程序都压不住），再固定按「主窗口 moveTop → 内部窗口 moveTop」的顺序排序，
	 * 后调用者永远排在更前面。守护每一轮都重建这个顺序，所以不是「第一次打开
	 * 才有效」，而是持续生效的结构性优先级。
	 */
	private raiseSiblingWindows(windows?: ElectronWindow[]) {
		if (!this.settings.siblingsOnTop) return;
		const list = windows ?? this.getSiblingWindows();
		for (const w of list) {
			try {
				if (!w.isAlwaysOnTop()) {
					w.setAlwaysOnTop(true, PIN_LEVEL);
					this.pinnedSiblings.add(w.id);
				}
				w.moveTop();
			} catch (error) {
				console.error('[Pin Toggle] 提升内部窗口层级失败：', error);
			}
		}
	}

	/** 撤销对内部窗口的层级改动，避免收起/卸载后残留 topmost */
	private unpinSiblingWindows() {
		if (this.pinnedSiblings.size === 0) return;
		let all: ElectronWindow[] = [];
		try {
			all = remote.BrowserWindow.getAllWindows();
		} catch (error) {
			console.error('[Pin Toggle] 枚举应用窗口失败：', error);
			this.pinnedSiblings.clear();
			return;
		}
		for (const id of this.pinnedSiblings) {
			try {
				const w = all.find((x) => x && x.id === id);
				if (w && !w.isDestroyed() && w.isAlwaysOnTop()) w.setAlwaysOnTop(false);
			} catch (error) {
				console.error('[Pin Toggle] 还原内部窗口层级失败：', error);
			}
		}
		this.pinnedSiblings.clear();
	}

	/** 用户自己点了最小化/隐藏 —— 置顶状态实时失效，守护不得再把它加回来 */
	private onWindowStateChangedByUser() {
		if (!this.pinned) return;
		this.pinned = false;
		const win = this.win;
		try {
			if (win && !win.isDestroyed() && win.isAlwaysOnTop()) win.setAlwaysOnTop(false);
		} catch (error) {
			console.error('[Pin Toggle] 取消置顶失败：', error);
		}
		this.unpinSiblingWindows();
	}

	/**
	 * 重新断言置顶。
	 *
	 * 只用 moveTop()，绝不用 focus()——focus() 会抢走当前应用（例如全屏浏览器）
	 * 的焦点，用户就没法继续在页面上打字或操作。moveTop() 只调整 z 序，
	 * 不改变激活状态，是唯一安全的选择。
	 *
	 * 守护的职责是「被别的程序压下去时抢回来」，因此只有在窗口**不是活动窗口**
	 * 时才需要动作。若窗口已经获得焦点，它本来就高于所有非 topmost 窗口，
	 * 此时唯一还能压在它上面的，是本该压在它上面的浮层（输入法候选框、
	 * 提示气泡、菜单）——再提一次只会把这些浮层盖掉，没有任何收益。
	 *
	 * @param force 用户主动唤出时传 true，绕过门控
	 */
	private reassertTop(force = false) {
		const win = this.win;
		if (!win || win.isDestroyed()) return;
		if (!this.settings.alwaysOnTop || !this.settings.keepOnTop) return;
		if (!this.pinned && !force) return;
		if (!win.isVisible() || win.isMinimized()) return;

		const siblings = this.settings.siblingsOnTop ? this.getSiblingWindows() : [];
		if (!force) {
			// 有内部窗口时即使主窗口聚焦，也要重建「主窗口 < 内部窗口」的顺序
			if (win.isFocused() && siblings.length === 0) return;
			if (this.isComposing()) return;
		}

		if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, PIN_LEVEL);
		win.moveTop();
		this.raiseSiblingWindows(siblings);
	}

	private attachKeeper() {
		const win = this.win;
		if (!win) return;

		const kick: ElectronWindowListener = () => {
			window.setTimeout(() => this.reassertTop(), 0);
		};
		// 激活 / 显示 / 还原都会触发系统 z 序重排；blur 用于被别的窗口压下去时抢回来。
		// 注意：这些钩子都要经过 reassertTop() 的门控，聚焦态下不会真的提 z 序。
		const userChanged: ElectronWindowListener = () => this.onWindowStateChangedByUser();
		this.keeperHandlers = {
			focus: kick,
			show: kick,
			restore: kick,
			blur: kick,
			minimize: userChanged,
			hide: userChanged,
		};
		for (const [event, handler] of Object.entries(this.keeperHandlers)) {
			win.on(event, handler);
		}

		// 输入法组合态：候选框显示期间禁止重提，否则会把选词框盖住
		this.registerDomEvent(document, 'compositionstart', () => {
			this.composing = true;
			this.lastComposeTs = Date.now();
		});
		this.registerDomEvent(document, 'compositionupdate', () => {
			this.lastComposeTs = Date.now();
		});
		this.registerDomEvent(document, 'compositionend', () => {
			this.composing = false;
			this.lastComposeTs = Date.now();
		});

		this.registerInterval(
			window.setInterval(() => {
				if (this.pinned) this.reassertTop();
			}, GUARD_INTERVAL_MS),
		);
	}

	private detachKeeper() {
		const win = this.win;
		this.pinned = false;
		this.unpinSiblingWindows();
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
					{
						name: '内部窗口优先',
						desc:
							'Obsidian 自己弹出的窗口（设置页、新窗口笔记、对话框等）始终排在主窗口之上；' +
							'主窗口只负责压住其他软件。关闭则主窗口回到最顶。',
						control: { type: 'toggle', key: 'siblingsOnTop' },
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof PinSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (
			key === 'alwaysOnTop' ||
			key === 'hideInsteadOfMinimize' ||
			key === 'keepOnTop' ||
			key === 'siblingsOnTop'
		) {
			this.plugin.settings[key] = Boolean(value);
			await this.plugin.saveSettings();
			// 关掉「置顶」时立即同步窗口状态，避免设置与窗口不一致
			if (key === 'alwaysOnTop' && !value) this.plugin.releaseTop();
		}
	}
}
