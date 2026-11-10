"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PinTogglePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_electron = require("electron");
function normalizeKey(key) {
  const map = {
    " ": "Space",
    Escape: "Esc",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right"
  };
  return map[key] ?? key;
}
function hotkeyToAccelerator(hotkey) {
  const modMap = {
    Mod: "CmdOrCtrl",
    Meta: "Meta",
    Ctrl: "Ctrl",
    Shift: "Shift",
    Alt: "Alt"
  };
  const mods = (hotkey.modifiers ?? []).map((mod) => modMap[mod] ?? mod);
  const key = normalizeKey(hotkey.key ?? "");
  if (!key) return "";
  return [...mods, key].join("+");
}
var DEFAULT_ACCELERATOR = "Ctrl+Alt+Space";
var PIN_LEVEL = "screen-saver";
var GUARD_INTERVAL_MS = 1500;
var COMPOSE_TAIL_MS = 300;
var COMPOSE_STALE_MS = 1e4;
var TOGGLE_GUARD_MS = 250;
var HOTKEY_SYNC_MS = 5e3;
var DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  hideInsteadOfMinimize: true,
  keepOnTop: true,
  siblingsOnTop: true
};
var PinTogglePlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.win = null;
    this.currentAccelerator = "";
    this.warnedAccelerator = "";
    this.lastToggleTs = 0;
    this.keeperHandlers = {};
    /** 插件是否主动置顶过；用户手动改变窗口状态后置 false，守护不再把置顶加回来 */
    this.pinned = false;
    /** 被插件临时提升为置顶的同应用内部窗口 id，收起/卸载时统一还原 */
    this.pinnedSiblings = /* @__PURE__ */ new Set();
    /** 输入法是否处于组合输入中（拼音候选框正在显示） */
    this.composing = false;
    /** 最近一次组合事件的时间戳，用于计算静默尾巴与兜底复位 */
    this.lastComposeTs = 0;
  }
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "toggle",
      name: "\u5524\u51FA / \u6536\u8D77\u7A97\u53E3",
      callback: () => this.toggleWindow()
    });
    this.addSettingTab(new PinSettingTab(this.app, this));
    this.addRibbonIcon("pin", "\u5524\u51FA / \u6536\u8D77\u7A97\u53E3", () => this.toggleWindow());
    try {
      this.win = import_electron.remote.getCurrentWindow();
    } catch (error) {
      this.win = null;
      console.error("[Pin Toggle] \u65E0\u6CD5\u83B7\u53D6 Electron \u7A97\u53E3\uFF0C\u7F6E\u9876\u4E0E\u5168\u5C40\u70ED\u952E\u4E0D\u53EF\u7528\u3002", error);
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
  get realState() {
    const win = this.win;
    if (!win || win.isDestroyed()) return "unavailable";
    if (!win.isVisible() || win.isMinimized()) return "collapsed";
    return win.isAlwaysOnTop() ? "pinned" : "front";
  }
  toggleWindow() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const now = Date.now();
    if (now - this.lastToggleTs < TOGGLE_GUARD_MS) return;
    this.lastToggleTs = now;
    const state = this.realState;
    if (state === "collapsed" || state === "unavailable") {
      this.summon();
      return;
    }
    if (this.settings.alwaysOnTop && state === "front") {
      this.summon();
      return;
    }
    this.collapse();
  }
  summon() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    this.pinned = true;
    if (this.settings.alwaysOnTop) {
      win.setAlwaysOnTop(true, PIN_LEVEL);
    }
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    window.setTimeout(() => this.reassertTop(true), 0);
  }
  collapse() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    this.pinned = false;
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
      console.error("[Pin Toggle] \u53D6\u6D88\u7F6E\u9876\u5931\u8D25\uFF1A", error);
    }
  }
  /**
   * 输入法是否正在组合输入（含上屏后的静默尾巴）。
   *
   * 拼音候选框本身也是一个 topmost 弹窗，与置顶后的编辑器同处最顶层窗口带。
   * 此时调用 moveTop() 会把编辑器抬到候选框之上，选词结果被盖住 ——
   * 这正是「输入拼音不到 2 秒就被置顶挡住」的成因。
   */
  isComposing() {
    if (!this.composing) {
      return Date.now() - this.lastComposeTs < COMPOSE_TAIL_MS;
    }
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
  getSiblingWindows() {
    const win = this.win;
    if (!win || win.isDestroyed()) return [];
    try {
      return import_electron.remote.BrowserWindow.getAllWindows().filter(
        (w) => w && w.id !== win.id && !w.isDestroyed() && w.isVisible() && !w.isMinimized()
      );
    } catch (error) {
      console.error("[Pin Toggle] \u679A\u4E3E\u5E94\u7528\u7A97\u53E3\u5931\u8D25\uFF1A", error);
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
  raiseSiblingWindows(windows) {
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
        console.error("[Pin Toggle] \u63D0\u5347\u5185\u90E8\u7A97\u53E3\u5C42\u7EA7\u5931\u8D25\uFF1A", error);
      }
    }
  }
  /** 撤销对内部窗口的层级改动，避免收起/卸载后残留 topmost */
  unpinSiblingWindows() {
    if (this.pinnedSiblings.size === 0) return;
    let all = [];
    try {
      all = import_electron.remote.BrowserWindow.getAllWindows();
    } catch (error) {
      console.error("[Pin Toggle] \u679A\u4E3E\u5E94\u7528\u7A97\u53E3\u5931\u8D25\uFF1A", error);
      this.pinnedSiblings.clear();
      return;
    }
    for (const id of this.pinnedSiblings) {
      try {
        const w = all.find((x) => x && x.id === id);
        if (w && !w.isDestroyed() && w.isAlwaysOnTop()) w.setAlwaysOnTop(false);
      } catch (error) {
        console.error("[Pin Toggle] \u8FD8\u539F\u5185\u90E8\u7A97\u53E3\u5C42\u7EA7\u5931\u8D25\uFF1A", error);
      }
    }
    this.pinnedSiblings.clear();
  }
  /** 用户自己点了最小化/隐藏 —— 置顶状态实时失效，守护不得再把它加回来 */
  onWindowStateChangedByUser() {
    if (!this.pinned) return;
    this.pinned = false;
    const win = this.win;
    try {
      if (win && !win.isDestroyed() && win.isAlwaysOnTop()) win.setAlwaysOnTop(false);
    } catch (error) {
      console.error("[Pin Toggle] \u53D6\u6D88\u7F6E\u9876\u5931\u8D25\uFF1A", error);
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
  reassertTop(force = false) {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    if (!this.settings.alwaysOnTop || !this.settings.keepOnTop) return;
    if (!this.pinned && !force) return;
    if (!win.isVisible() || win.isMinimized()) return;
    const siblings = this.settings.siblingsOnTop ? this.getSiblingWindows() : [];
    if (!force) {
      if (win.isFocused() && siblings.length === 0) return;
      if (this.isComposing()) return;
    }
    if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, PIN_LEVEL);
    win.moveTop();
    this.raiseSiblingWindows(siblings);
  }
  attachKeeper() {
    const win = this.win;
    if (!win) return;
    const kick = () => {
      window.setTimeout(() => this.reassertTop(), 0);
    };
    const userChanged = () => this.onWindowStateChangedByUser();
    this.keeperHandlers = {
      focus: kick,
      show: kick,
      restore: kick,
      blur: kick,
      minimize: userChanged,
      hide: userChanged
    };
    for (const [event, handler] of Object.entries(this.keeperHandlers)) {
      win.on(event, handler);
    }
    this.registerDomEvent(document, "compositionstart", () => {
      this.composing = true;
      this.lastComposeTs = Date.now();
    });
    this.registerDomEvent(document, "compositionupdate", () => {
      this.lastComposeTs = Date.now();
    });
    this.registerDomEvent(document, "compositionend", () => {
      this.composing = false;
      this.lastComposeTs = Date.now();
    });
    this.registerInterval(
      window.setInterval(() => {
        if (this.pinned) this.reassertTop();
      }, GUARD_INTERVAL_MS)
    );
  }
  detachKeeper() {
    const win = this.win;
    this.pinned = false;
    this.unpinSiblingWindows();
    try {
      if (win && !win.isDestroyed()) {
        for (const [event, handler] of Object.entries(this.keeperHandlers)) {
          win.off(event, handler);
        }
        win.setAlwaysOnTop(false);
      }
    } catch (error) {
      console.error("[Pin Toggle] \u5378\u8F7D\u6E05\u7406\u5931\u8D25\uFF1A", error);
    }
    this.keeperHandlers = {};
    this.win = null;
  }
  /** 读取用户在「设置 → 快捷键」里给本命令绑的键，注册成系统级全局热键；未绑定则用默认值 */
  syncGlobalHotkey() {
    if (!this.win) return;
    let accelerator = "";
    const hotkeys = this.app.hotkeyManager.getHotkeys("pin-toggle:toggle");
    if (hotkeys && hotkeys.length > 0) {
      accelerator = hotkeyToAccelerator(hotkeys[0]);
    } else {
      accelerator = DEFAULT_ACCELERATOR;
    }
    if (accelerator === this.currentAccelerator) return;
    this.unregisterGlobalHotkey();
    if (!accelerator) return;
    try {
      const registered = import_electron.remote.globalShortcut.register(accelerator, () => this.toggleWindow());
      if (!registered) {
        if (this.warnedAccelerator !== accelerator) {
          this.warnedAccelerator = accelerator;
          new import_obsidian.Notice(
            `[Pin Toggle] \u5168\u5C40\u70ED\u952E ${accelerator} \u6CE8\u518C\u5931\u8D25\uFF1A\u53EF\u80FD\u5DF2\u88AB\u5176\u4ED6\u8F6F\u4EF6\u5360\u7528\uFF0C\u8BF7\u5728\u300C\u8BBE\u7F6E \u2192 \u5FEB\u6377\u952E\u300D\u91CC\u6362\u4E00\u4E2A\u7EC4\u5408\u952E\u3002`,
            8e3
          );
        }
        return;
      }
      this.currentAccelerator = accelerator;
      this.warnedAccelerator = "";
    } catch (error) {
      console.error("[Pin Toggle] \u6CE8\u518C\u5168\u5C40\u70ED\u952E\u5931\u8D25\uFF1A", accelerator, error);
      this.currentAccelerator = "";
    }
  }
  unregisterGlobalHotkey() {
    if (!this.currentAccelerator) return;
    try {
      import_electron.remote.globalShortcut.unregister(this.currentAccelerator);
    } catch (error) {
      console.error("[Pin Toggle] \u6CE8\u9500\u5168\u5C40\u70ED\u952E\u5931\u8D25\uFF1A", error);
    }
    this.currentAccelerator = "";
  }
  async loadSettings() {
    const stored = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...stored };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var PinSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  getSettingDefinitions() {
    return [
      {
        type: "group",
        heading: "\u5FEB\u6377\u952E",
        items: [
          {
            name: "\u7ED1\u5B9A\u4F4D\u7F6E",
            desc: "\u5728\u300C\u8BBE\u7F6E \u2192 \u5FEB\u6377\u952E\u300D\u4E2D\u641C\u7D22\u672C\u63D2\u4EF6\uFF0C\u7ED9\u300C\u5524\u51FA / \u6536\u8D77\u7A97\u53E3\u300D\u7ED1\u5B9A\u6309\u952E\uFF1B\u7ED1\u5B9A\u540E\u63D2\u4EF6\u4F1A\u5728\u6570\u79D2\u5185\u81EA\u52A8\u628A\u5B83\u6CE8\u518C\u4E3A\u7CFB\u7EDF\u7EA7\u5168\u5C40\u70ED\u952E\uFF08\u5373\u4F7F\u7A97\u53E3\u5728\u540E\u53F0\u4E5F\u80FD\u5524\u51FA\uFF09\u3002"
          },
          {
            name: "\u7ACB\u5373\u540C\u6B65\u5168\u5C40\u70ED\u952E",
            desc: "\u6539\u5B8C\u6807\u51C6\u5FEB\u6377\u952E\u540E\u82E5\u672A\u5373\u65F6\u751F\u6548\uFF0C\u70B9\u6B64\u624B\u52A8\u5237\u65B0\u4E00\u6B21\u3002",
            action: () => this.plugin.syncGlobalHotkey()
          }
        ]
      },
      {
        type: "group",
        heading: "\u884C\u4E3A",
        items: [
          {
            name: "\u7F6E\u9876 (always on top)",
            desc: "\u5524\u51FA\u65F6\u662F\u5426\u8BA9\u7A97\u53E3\u771F\u6B63\u6D6E\u5728\u6700\u4E0A\u5C42\u3001\u6321\u4F4F\u5176\u4ED6\u8F6F\u4EF6\uFF1B\u5173\u95ED\u5219\u53EA\u5E26\u5230\u524D\u53F0\u3002",
            control: { type: "toggle", key: "alwaysOnTop" }
          },
          {
            name: "\u7F6E\u9876\u5B88\u62A4",
            desc: "\u5F00\u542F\u540E\u6301\u7EED\u7EF4\u6301\u7F6E\u9876\uFF1A\u88AB\u5176\u4ED6\u7A97\u53E3\uFF08\u5305\u62EC\u5168\u5C4F\u6D4F\u89C8\u5668\uFF09\u538B\u4E0B\u53BB\u65F6\u81EA\u52A8\u62A2\u56DE\u4E0A\u5C42\u3002\u5173\u95ED\u53EF\u7701\u7535\uFF0C\u4F46\u4F1A\u9000\u5316\u4E3A\u300C\u53EA\u5728\u5524\u51FA\u90A3\u4E00\u523B\u7F6E\u9876\u300D\u3002",
            control: { type: "toggle", key: "keepOnTop" }
          },
          {
            name: "\u6536\u8D77\u65B9\u5F0F",
            desc: "\u6536\u8D77\u65F6\uFF1A\u9690\u85CF\u7A97\u53E3\uFF08\u4E0D\u5360\u4EFB\u52A1\u680F\uFF0C\u50CF Alt+E\uFF09\u8FD8\u662F\u6700\u5C0F\u5316\u5230\u4EFB\u52A1\u680F\u3002",
            control: { type: "toggle", key: "hideInsteadOfMinimize" }
          },
          {
            name: "\u5185\u90E8\u7A97\u53E3\u4F18\u5148",
            desc: "Obsidian \u81EA\u5DF1\u5F39\u51FA\u7684\u7A97\u53E3\uFF08\u8BBE\u7F6E\u9875\u3001\u65B0\u7A97\u53E3\u7B14\u8BB0\u3001\u5BF9\u8BDD\u6846\u7B49\uFF09\u59CB\u7EC8\u6392\u5728\u4E3B\u7A97\u53E3\u4E4B\u4E0A\uFF1B\u4E3B\u7A97\u53E3\u53EA\u8D1F\u8D23\u538B\u4F4F\u5176\u4ED6\u8F6F\u4EF6\u3002\u5173\u95ED\u5219\u4E3B\u7A97\u53E3\u56DE\u5230\u6700\u9876\u3002",
            control: { type: "toggle", key: "siblingsOnTop" }
          }
        ]
      }
    ];
  }
  getControlValue(key) {
    return this.plugin.settings[key];
  }
  async setControlValue(key, value) {
    if (key === "alwaysOnTop" || key === "hideInsteadOfMinimize" || key === "keepOnTop" || key === "siblingsOnTop") {
      this.plugin.settings[key] = Boolean(value);
      await this.plugin.saveSettings();
      if (key === "alwaysOnTop" && !value) this.plugin.releaseTop();
    }
  }
};
