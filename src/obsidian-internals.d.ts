import type { Hotkey } from 'obsidian';

/**
 * Obsidian 运行时存在、但未写进公开类型声明的内部 API：
 * 用于读取用户在「设置 → 快捷键」里为某个命令绑定的按键。
 */
export interface HotkeyManagerApi {
	getHotkeys(commandId: string): Hotkey[] | undefined;
}

declare module 'obsidian' {
	interface App {
		/** 内部 API：命令的快捷键管理（读取用户绑定，用于注册系统级全局热键） */
		hotkeyManager: HotkeyManagerApi;
	}
}
