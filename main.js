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
var DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  hideInsteadOfMinimize: true
};
var PinTogglePlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.win = null;
    this.currentAccelerator = "";
    this.isPinned = false;
    this.lastToggleTs = 0;
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
    }
    this.syncGlobalHotkey();
    this.registerInterval(window.setInterval(() => this.syncGlobalHotkey(), 2e3));
  }
  onunload() {
    this.unregisterGlobalHotkey();
  }
  toggleWindow() {
    const win = this.win;
    if (!win) return;
    const now = Date.now();
    if (now - this.lastToggleTs < 300) return;
    this.lastToggleTs = now;
    const shouldPin = !this.isPinned;
    if (this.settings.alwaysOnTop) {
      try {
        win.setAlwaysOnTop(shouldPin);
      } catch (error) {
        console.error("[Pin Toggle] \u5207\u6362\u7F6E\u9876\u72B6\u6001\u5931\u8D25\uFF1A", error);
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
      console.error("[Pin Toggle] \u5207\u6362\u7A97\u53E3\u663E\u793A\u72B6\u6001\u5931\u8D25\uFF1A", error);
    }
    this.isPinned = shouldPin;
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
      import_electron.remote.globalShortcut.register(accelerator, () => this.toggleWindow());
      this.currentAccelerator = accelerator;
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
    if (key === "alwaysOnTop" || key === "hideInsteadOfMinimize") {
      this.plugin.settings[key] = Boolean(value);
      await this.plugin.saveSettings();
    }
  }
};
