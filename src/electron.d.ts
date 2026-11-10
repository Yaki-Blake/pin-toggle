/**
 * 极简的 Electron `remote` 类型声明。
 *
 * Obsidian 桌面端会在渲染进程里注入 `electron.remote`（Obsidian 自身启动逻辑：
 * `require("electron")`，若 `remote` 缺失则自动回退到 `@electron/remote`），
 * 所以插件只需声明用到的成员，不必引入体积巨大的 `electron` 依赖。
 *
 * 本文件不含顶层 import/export，属于全局声明文件，`declare module` 在此合法。
 */
declare module 'electron' {
	/** 窗口事件回调 */
	export type ElectronWindowListener = (...args: unknown[]) => void;

	/** Electron BrowserWindow 中本插件用到的成员 */
	export interface ElectronWindow {
		/** 窗口唯一 id，用于区分主窗口与同进程的其他窗口 */
		id: number;
		/**
		 * 设置置顶。
		 * `level` 在 Windows 上不决定层级高低，只决定窗口是否被压到任务栏之后：
		 * 传 `floating`（默认值）会命中 Electron 的 behind_task_bar_ 分支，
		 * 传 `screen-saver` 则不会。
		 */
		setAlwaysOnTop(flag: boolean, level?: string): void;
		isAlwaysOnTop(): boolean;
		isVisible(): boolean;
		isMinimized(): boolean;
		isDestroyed(): boolean;
		/** 窗口是否为当前活动窗口（系统焦点所在） */
		isFocused(): boolean;
		show(): void;
		hide(): void;
		minimize(): void;
		/** 从最小化状态还原；show() 对最小化窗口无效 */
		restore(): void;
		focus(): void;
		moveTop(): void;
		on(event: string, listener: ElectronWindowListener): void;
		off(event: string, listener: ElectronWindowListener): void;
	}

	/** Electron globalShortcut 模块中本插件用到的成员 */
	export interface ElectronGlobalShortcut {
		register(accelerator: string, callback: () => void): boolean;
		unregister(accelerator: string): void;
	}

	/** Electron remote 模块中本插件用到的成员 */
	export interface ElectronRemote {
		getCurrentWindow(): ElectronWindow;
		globalShortcut: ElectronGlobalShortcut;
		/** 枚举同进程内所有 BrowserWindow，用于识别 Obsidian 自己弹出的窗口 */
		BrowserWindow: {
			getAllWindows(): ElectronWindow[];
		};
	}

	export const remote: ElectronRemote;
}
