/**
 * main.js 冒烟测试（不依赖 Obsidian 运行环境）
 *
 * 用桩件替换 obsidian / electron，加载真实的 main.js 产物，
 * 验证三态切换、置顶守护与卸载清理的行为是否符合预期。
 *
 * 运行：node tools/smoke-test.cjs
 */

const path = require("path");
const Module = require("module");

/* ---------------- 桩件 ---------------- */

class FakeWindow {
	constructor() {
		this.visible = true;
		this.minimized = false;
		this.alwaysOnTop = false;
		this.destroyed = false;
		this.calls = [];
		this.handlers = new Map();
	}

	record(name, ...args) {
		this.calls.push([name, ...args]);
	}

	isDestroyed() {
		return this.destroyed;
	}
	isVisible() {
		return this.visible;
	}
	isMinimized() {
		return this.minimized;
	}
	isAlwaysOnTop() {
		return this.alwaysOnTop;
	}
	setAlwaysOnTop(flag, level) {
		this.alwaysOnTop = flag;
		this.record("setAlwaysOnTop", flag, level);
	}
	show() {
		this.visible = true;
		this.minimized = false;
		this.record("show");
	}
	hide() {
		this.visible = false;
		this.record("hide");
	}
	minimize() {
		this.minimized = true;
		this.record("minimize");
	}
	focus() {
		this.record("focus");
	}
	moveTop() {
		this.record("moveTop");
	}
	on(event, handler) {
		this.handlers.set(event, handler);
	}
	off(event, handler) {
		if (this.handlers.get(event) === handler) this.handlers.delete(event);
	}
	count(name) {
		return this.calls.filter((c) => c[0] === name).length;
	}
	last(name) {
		const hits = this.calls.filter((c) => c[0] === name);
		return hits.length ? hits[hits.length - 1] : null;
	}
	clear() {
		this.calls = [];
	}
}

const fakeWin = new FakeWindow();
const notices = [];

class Plugin {
	constructor() {
		this.app = { hotkeyManager: { getHotkeys: () => [] } };
	}
	async loadData() {
		return null;
	}
	async saveData() {}
	addCommand() {}
	addSettingTab(tab) {
		this.tab = tab;
	}
	addRibbonIcon() {}
	registerInterval() {}
}

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
	}
}

class Notice {
	constructor(message) {
		notices.push(message);
	}
}

const obsidianStub = { Plugin, PluginSettingTab, Notice };
const electronStub = {
	remote: {
		getCurrentWindow: () => fakeWin,
		globalShortcut: {
			register: () => true,
			unregister: () => {},
		},
	},
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "obsidian") return obsidianStub;
	if (request === "electron") return electronStub;
	return originalLoad.apply(this, arguments);
};

// main.js 里用了 window.setTimeout / window.setInterval
global.window = {
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	setInterval: (fn, ms) => setInterval(fn, ms),
	clearInterval: (id) => clearInterval(id),
};

/* ---------------- 断言 ---------------- */

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
	if (condition) {
		passed++;
		console.log(`  PASS  ${name}`);
	} else {
		failed++;
		console.log(`  FAIL  ${name}${detail ? " -> " + detail : ""}`);
	}
}

const tick = () => new Promise((r) => setTimeout(r, 20));

/**
 * 插件有 250ms 的连击去重窗口（防止 Obsidian 内部热键与全局热键对同一次
 * 按键各触发一次），测试必须跨越该窗口，否则第二次调用会被静默丢弃。
 */
const press = async (fn) => {
	await new Promise((r) => setTimeout(r, 300));
	fn();
	await tick();
};

/* ---------------- 用例 ---------------- */

(async () => {
	const PinTogglePlugin = require(path.join(__dirname, "..", "main.js")).default;
	const plugin = new PinTogglePlugin();
	await plugin.onload();

	console.log("\n[1] 首次唤出：应使用 screen-saver 层级并置顶");
	fakeWin.clear();
	plugin.toggleWindow();
	await tick();
	check(
		"setAlwaysOnTop(true, 'screen-saver')",
		JSON.stringify(fakeWin.last("setAlwaysOnTop")) === JSON.stringify(["setAlwaysOnTop", true, "screen-saver"]),
		JSON.stringify(fakeWin.last("setAlwaysOnTop"))
	);
	check("调用了 moveTop()", fakeWin.count("moveTop") >= 1);
	check("窗口已置顶", fakeWin.isAlwaysOnTop());

	console.log("\n[2] 再次按键：应收起（默认 hide）");
	fakeWin.clear();
	await press(() => plugin.toggleWindow());
	check("取消置顶", fakeWin.isAlwaysOnTop() === false);
	check("执行 hide()", fakeWin.count("hide") === 1, JSON.stringify(fakeWin.calls));
	check("窗口不可见", fakeWin.isVisible() === false);

	console.log("\n[3] 收起状态下按键：应重新唤出");
	fakeWin.clear();
	await press(() => plugin.toggleWindow());
	check("窗口可见", fakeWin.isVisible() === true);
	check("重新置顶", fakeWin.isAlwaysOnTop() === true);

	console.log("\n[4] 回归：被压下去（可见但未置顶）时按键，应重新置顶而不是收起");
	fakeWin.alwaysOnTop = false; // 模拟 topmost 被外部剥夺
	fakeWin.clear();
	await press(() => plugin.toggleWindow());
	check("没有执行 hide()", fakeWin.count("hide") === 0, JSON.stringify(fakeWin.calls));
	check("重新置顶成功", fakeWin.isAlwaysOnTop() === true);

	console.log("\n[5] 置顶守护：blur 后应抢回 z 序");
	fakeWin.clear();
	const blur = fakeWin.handlers.get("blur");
	check("已注册 blur 处理器", typeof blur === "function");
	if (blur) blur();
	await tick();
	check("blur 后调用了 moveTop()", fakeWin.count("moveTop") >= 1, JSON.stringify(fakeWin.calls));
	check("blur 后未抢焦点（无 focus 调用）", fakeWin.count("focus") === 0);

	console.log("\n[6] 守护在收起态应保持静默");
	await press(() => plugin.toggleWindow()); // 收起
	fakeWin.clear();
	if (fakeWin.handlers.get("blur")) fakeWin.handlers.get("blur")();
	await tick();
	check("不可见时不调用 moveTop()", fakeWin.count("moveTop") === 0, JSON.stringify(fakeWin.calls));

	console.log("\n[7] 设置页定义");
	const defs = plugin.tab.getSettingDefinitions();
	const toggles = defs.flatMap((g) => g.items || []).filter((i) => i.control && i.control.type === "toggle");
	check("包含 3 个开关", toggles.length === 3, JSON.stringify(toggles.map((t) => t.control.key)));
	check(
		"含 keepOnTop 开关",
		toggles.some((t) => t.control.key === "keepOnTop")
	);

	console.log("\n[8] 卸载清理");
	fakeWin.clear();
	plugin.onunload();
	check("卸载时取消置顶", fakeWin.isAlwaysOnTop() === false, JSON.stringify(fakeWin.calls));
	check("卸载时移除 blur 监听", !fakeWin.handlers.has("blur"));

	console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
	process.exit(failed === 0 ? 0 : 1);
})();
