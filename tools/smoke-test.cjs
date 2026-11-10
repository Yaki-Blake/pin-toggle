/**
 * main.js 冒烟测试（不依赖 Obsidian 运行环境）
 *
 * 用桩件替换 obsidian / electron，加载真实的 main.js 产物，
 * 验证三态切换、置顶守护的门控条件与卸载清理的行为是否符合预期。
 *
 * 运行：node tools/smoke-test.cjs
 */

const path = require("path");
const Module = require("module");

/* ---------------- 桩件 ---------------- */

const zOrder = [];

class FakeWindow {
	constructor(id = 1) {
		this.id = id;
		this.visible = true;
		this.minimized = false;
		this.alwaysOnTop = false;
		// 真实环境里 Obsidian 启动时就是活动窗口
		this.focused = true;
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
	isFocused() {
		return this.focused;
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
		this.focused = false;
		this.record("hide");
	}
	minimize() {
		this.minimized = true;
		this.focused = false;
		this.record("minimize");
	}
	focus() {
		this.focused = true;
		this.record("focus");
	}
	moveTop() {
		this.record("moveTop");
		zOrder.push(this.id);
	}
	restore() {
		this.visible = true;
		this.minimized = false;
		this.record("restore");
	}
	emit(event) {
		const handler = this.handlers.get(event);
		if (handler) handler();
	}
	/** 模拟用户点右上角最小化：窗口状态改变 + Electron minimize 事件 */
	userMinimize() {
		this.minimized = true;
		this.visible = false;
		this.focused = false;
		this.emit("minimize");
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

const fakeWin = new FakeWindow(1);
const allWindows = [fakeWin];
const notices = [];

/**
 * window.setInterval 用桩件接住，不真的排定定时器：
 * 否则 1.5s 的守护轮询会在测试中途随机触发，断言计数变得不可复现。
 * 测试通过 guardTick() 显式触发一次「守护轮询」。
 */
const intervals = [];

class Plugin {
	constructor() {
		this.app = { hotkeyManager: { getHotkeys: () => [] } };
		this.domHandlers = new Map();
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
	registerDomEvent(_el, type, callback) {
		this.domHandlers.set(type, callback);
	}
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
		BrowserWindow: {
			getAllWindows: () => allWindows,
		},
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
	setInterval: (fn, ms) => {
		intervals.push({ fn, ms });
		return intervals.length;
	},
	clearInterval: () => {},
};
// 组合态事件注册在 document 上
global.document = {};

/** 触发一次守护轮询（对应 GUARD_INTERVAL_MS 那个定时器） */
const guardTick = () => {
	const guard = intervals.find((entry) => entry.ms === 1500);
	if (!guard) throw new Error("未找到守护轮询定时器");
	guard.fn();
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 插件有 250ms 的连击去重窗口（防止 Obsidian 内部热键与全局热键对同一次
 * 按键各触发一次），测试必须跨越该窗口，否则第二次调用会被静默丢弃。
 */
const press = async (fn) => {
	await sleep(300);
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
	check("唤出时强制提 z 序（聚焦也照提）", fakeWin.count("moveTop") >= 1, JSON.stringify(fakeWin.calls));
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

	console.log("\n[5] 守护：窗口失焦后应抢回 z 序");
	fakeWin.clear();
	const blur = fakeWin.handlers.get("blur");
	check("已注册 blur 处理器", typeof blur === "function");
	fakeWin.focused = false;
	if (blur) blur();
	await tick();
	check("blur 后调用了 moveTop()", fakeWin.count("moveTop") >= 1, JSON.stringify(fakeWin.calls));
	check("blur 后未抢焦点（无 focus 调用）", fakeWin.count("focus") === 0);

	console.log("\n[6] 回归：窗口聚焦时守护必须静默（修复抢输入法候选框）");
	fakeWin.focused = true;
	fakeWin.clear();
	if (fakeWin.handlers.get("focus")) fakeWin.handlers.get("focus")();
	await tick();
	guardTick();
	check("聚焦态下 moveTop() 一次都不调用", fakeWin.count("moveTop") === 0, JSON.stringify(fakeWin.calls));

	console.log("\n[7] 回归：输入法组合期间与上屏后的静默尾巴");
	fakeWin.focused = false; // 排除焦点门控，单独验证组合态守卫
	fakeWin.clear();
	const composeStart = plugin.domHandlers.get("compositionstart");
	const composeUpdate = plugin.domHandlers.get("compositionupdate");
	const composeEnd = plugin.domHandlers.get("compositionend");
	check(
		"已注册组合态监听",
		typeof composeStart === "function" && typeof composeUpdate === "function" && typeof composeEnd === "function"
	);
	composeStart();
	composeUpdate();
	guardTick();
	check("组合输入中不重提", fakeWin.count("moveTop") === 0, JSON.stringify(fakeWin.calls));
	composeEnd();
	guardTick();
	check("上屏后 300ms 内仍不重提", fakeWin.count("moveTop") === 0, JSON.stringify(fakeWin.calls));
	await sleep(350);
	guardTick();
	check("静默尾巴结束后恢复重提", fakeWin.count("moveTop") === 1, JSON.stringify(fakeWin.calls));

	console.log("\n[8] 用户主动唤出不受门控影响（force 分支）");
	await press(() => plugin.toggleWindow()); // 收起
	check("已收起", fakeWin.isVisible() === false);
	fakeWin.clear();
	composeStart(); // 即使处于组合态
	await press(() => plugin.toggleWindow());
	check("唤出时仍强制提 z 序", fakeWin.count("moveTop") >= 1, JSON.stringify(fakeWin.calls));
	check("窗口已置顶", fakeWin.isAlwaysOnTop() === true);

	console.log("\n[9] 设置页定义");
	const defs = plugin.tab.getSettingDefinitions();
	const toggles = defs.flatMap((g) => g.items || []).filter((i) => i.control && i.control.type === "toggle");
	check("包含 4 个开关", toggles.length === 4, JSON.stringify(toggles.map((t) => t.control.key)));
	check(
		"含 keepOnTop 开关",
		toggles.some((t) => t.control.key === "keepOnTop")
	);
	check(
		"含 siblingsOnTop 开关",
		toggles.some((t) => t.control.key === "siblingsOnTop")
	);

	console.log("\n[10] 内部窗口优先：结构性层级（不只是第一次打开）");
	const sibling = new FakeWindow(2);
	allWindows.push(sibling);
	plugin.reassertTop(true);
	check("内部窗口被提升进 topmost 带", sibling.isAlwaysOnTop() === true);
	check(
		"主窗口先 moveTop、内部窗口后 moveTop",
		JSON.stringify(zOrder.slice(-2)) === JSON.stringify([1, 2]),
		JSON.stringify(zOrder)
	);
	zOrder.length = 0;
	plugin.reassertTop(true);
	plugin.reassertTop(true);
	check("每轮守护都重建该顺序", JSON.stringify(zOrder) === JSON.stringify([1, 2, 1, 2]), JSON.stringify(zOrder));

	console.log("\n[11] 用户手动最小化：置顶实时失效，Alt+T 直接唤起到置顶");
	fakeWin.userMinimize();
	check("置顶意图实时失效", plugin.pinned === false);
	check("主窗口立即失去 topmost", fakeWin.isAlwaysOnTop() === false);
	check("内部窗口的临时 topmost 被还原", sibling.isAlwaysOnTop() === false);
	check("真实状态为 collapsed", plugin.realState === "collapsed");
	fakeWin.clear();
	guardTick();
	check("守护不会把置顶加回来", fakeWin.count("setAlwaysOnTop") === 0 && !fakeWin.isAlwaysOnTop());
	await press(() => plugin.toggleWindow());
	check("窗口从最小化被 restore", fakeWin.isMinimized() === false && fakeWin.isVisible() === true);
	check("窗口重新置顶", fakeWin.isAlwaysOnTop() === true);
	check("真实状态回到 pinned", plugin.realState === "pinned");

	console.log("\n[12] 卸载清理");
	fakeWin.clear();
	sibling.clear();
	plugin.onunload();
	check("卸载时取消置顶", fakeWin.isAlwaysOnTop() === false, JSON.stringify(fakeWin.calls));
	check("卸载时移除 blur 监听", !fakeWin.handlers.has("blur"));
	check("卸载时还原内部窗口", sibling.isAlwaysOnTop() === false);

	console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
	process.exit(failed === 0 ? 0 : 1);
})();
