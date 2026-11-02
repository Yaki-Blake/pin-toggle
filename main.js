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
var TOGGLE_GUARD_MS = 250;
var HOTKEY_SYNC_MS = 5e3;
var DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  hideInsteadOfMinimize: true,
  keepOnTop: true
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
    if (this.settings.alwaysOnTop) {
      win.setAlwaysOnTop(true, PIN_LEVEL);
    }
    if (!win.isVisible()) win.show();
    win.focus();
    window.setTimeout(() => this.reassertTop(), 0);
  }
  collapse() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
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
      console.error("[Pin Toggle] \u53D6\u6D88\u7F6E\u9876\u5931\u8D25\uFF1A", error);
    }
  }
  /**
   * 重新断言置顶。
   * 只用 moveTop()，绝不用 focus()——focus() 会抢走当前应用（例如全屏浏览器）
   * 的焦点，用户就没法继续在页面上打字或操作。moveTop() 只调整 z 序，
   * 不改变激活状态，是唯一安全的选择。
   */
  reassertTop() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    if (!this.settings.alwaysOnTop || !this.settings.keepOnTop) return;
    if (!win.isVisible() || win.isMinimized()) return;
    if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, PIN_LEVEL);
    win.moveTop();
  }
  attachKeeper() {
    const win = this.win;
    if (!win) return;
    const kick = () => {
      window.setTimeout(() => this.reassertTop(), 0);
    };
    this.keeperHandlers = { focus: kick, show: kick, restore: kick, blur: kick };
    for (const [event, handler] of Object.entries(this.keeperHandlers)) {
      win.on(event, handler);
    }
    this.registerInterval(
      window.setInterval(() => {
        if (this.realState === "pinned") this.reassertTop();
      }, GUARD_INTERVAL_MS)
    );
  }
  detachKeeper() {
    const win = this.win;
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
          }
        ]
      }
    ];
  }
  getControlValue(key) {
    return this.plugin.settings[key];
  }
  async setControlValue(key, value) {
    if (key === "alwaysOnTop" || key === "hideInsteadOfMinimize" || key === "keepOnTop") {
      this.plugin.settings[key] = Boolean(value);
      await this.plugin.saveSettings();
      if (key === "alwaysOnTop" && !value) this.plugin.releaseTop();
    }
  }
};
