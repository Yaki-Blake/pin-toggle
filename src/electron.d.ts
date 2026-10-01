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
	/** Electron BrowserWindow 中本插件用到的成员 */
	export interface ElectronWindow {
		setAlwaysOnTop(flag: boolean): void;
		show(): void;
		hide(): void;
		minimize(): void;
		focus(): void;
		moveTop(): void;
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
	}

	export const remote: ElectronRemote;
}
