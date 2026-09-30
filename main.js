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
function getElectronRemote() {
  let r = null;
  try {
    r = require("electron").remote;
  } catch (e) {
  }
  if (!r) {
    try {
      r = require("@electron/remote");
    } catch (e) {
    }
  }
  return r;
}
function normalizeKey(k) {
  const map = {
    " ": "Space",
    Escape: "Esc",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right"
  };
  return map[k] || k;
}
function hotkeyToAccelerator(hk) {
  const modMap = {
    Mod: "CmdOrCtrl",
    Meta: "Meta",
    Ctrl: "Ctrl",
    Shift: "Shift",
    Alt: "Alt"
  };
  const mods = (hk.modifiers || []).map((m) => modMap[m] || m);
  const key = normalizeKey(hk.key || "");
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
    this.remote = null;
    this.currentAccelerator = "";
    this.isPinned = false;
    this.lastToggleTs = 0;
  }
  async onload() {
    await this.loadSettings();
    this.remote = getElectronRemote();
    this.addCommand({
      id: "toggle",
      name: "Pin Toggle\uFF1A\u5524\u51FA / \u6536\u8D77 Obsidian \u7A97\u53E3",
      callback: () => this.toggleWindow()
    });
    this.addSettingTab(new PinSettingTab(this.app, this));
    this.addRibbonIcon("pin", "Pin / unpin Obsidian window", () => this.toggleWindow());
    this.syncGlobalHotkey();
    this.registerInterval(window.setInterval(() => this.syncGlobalHotkey(), 2e3));
    if (!this.remote) {
      console.warn(
        "[Pin Toggle] \u65E0\u6CD5\u83B7\u53D6 Electron remote\uFF0C\u5168\u5C40\u70ED\u952E\u4E0D\u53EF\u7528\u3002\u8BF7\u786E\u8BA4 Obsidian \u7248\u672C >= 1.4.0\uFF0C\u6216\u5DF2\u542F\u7528 @electron/remote\u3002"
      );
    }
  }
  onunload() {
    this.unregisterGlobalHotkey();
  }
  getWindow() {
    if (!this.remote) return null;
    return this.remote.getCurrentWindow();
  }
  toggleWindow() {
    const now = Date.now();
    if (now - this.lastToggleTs < 300) return;
    this.lastToggleTs = now;
    const win = this.getWindow();
    if (!win) return;
    if (this.isPinned) {
      if (this.settings.alwaysOnTop) {
        try {
          win.setAlwaysOnTop(false);
        } catch (e) {
        }
      }
      if (this.settings.hideInsteadOfMinimize) {
        win.hide();
      } else {
        win.minimize();
      }
      this.isPinned = false;
    } else {
      if (this.settings.alwaysOnTop) {
        try {
          win.setAlwaysOnTop(true);
        } catch (e) {
        }
      }
      win.show();
      win.focus();
      try {
        win.moveTop();
      } catch (e) {
      }
      this.isPinned = true;
    }
  }
  /** 读取用户在"设置→快捷键"里给本命令绑的键，注册成系统级全局热键；未绑定则用默认值 */
  syncGlobalHotkey() {
    if (!this.remote) return;
    let acc = "";
    const hks = this.app.hotkeyManager.getHotkeys("pin-toggle:toggle");
    if (hks && hks.length) {
      acc = hotkeyToAccelerator(hks[0]);
    } else {
      acc = DEFAULT_ACCELERATOR;
    }
    if (acc === this.currentAccelerator) return;
    this.unregisterGlobalHotkey();
    if (acc) {
      try {
        this.remote.globalShortcut.register(acc, () => this.toggleWindow());
        this.currentAccelerator = acc;
      } catch (e) {
        console.error("[Pin Toggle] \u6CE8\u518C\u5168\u5C40\u70ED\u952E\u5931\u8D25\uFF1A", acc, e);
        this.currentAccelerator = "";
      }
    }
  }
  unregisterGlobalHotkey() {
    if (!this.remote || !this.currentAccelerator) return;
    try {
      this.remote.globalShortcut.unregister(this.currentAccelerator);
    } catch (e) {
    }
    this.currentAccelerator = "";
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Pin Toggle \u8BBE\u7F6E" });
    containerEl.createEl("p", {
      text: '\u5FEB\u6377\u952E\u8BF7\u5728 Obsidian \u6807\u51C6\u5165\u53E3\u8BBE\u7F6E\uFF1A\u8BBE\u7F6E \u2192 \u5FEB\u6377\u952E\uFF0C\u641C\u7D22 "Pin Toggle"\uFF0C\u7ED9 "Pin Toggle\uFF1A\u5524\u51FA / \u6536\u8D77 Obsidian \u7A97\u53E3" \u7ED1\u5B9A\u6309\u952E\u3002\u7ED1\u5B9A\u540E\u63D2\u4EF6\u4F1A\u81EA\u52A8\u628A\u5B83\u6CE8\u518C\u4E3A\u7CFB\u7EDF\u7EA7\u5168\u5C40\u70ED\u952E\uFF08\u5373\u4F7F Obsidian \u5728\u540E\u53F0\u4E5F\u80FD\u5524\u8D77\uFF09\uFF0C\u65E0\u9700\u5728\u6B64\u624B\u52A8\u8F93\u5165\u3002'
    });
    new import_obsidian.Setting(containerEl).setName("\u7ACB\u5373\u540C\u6B65\u5168\u5C40\u70ED\u952E").setDesc("\u6539\u5B8C\u6807\u51C6\u5FEB\u6377\u952E\u540E\u82E5\u672A\u5373\u65F6\u751F\u6548\uFF0C\u70B9\u6B64\u624B\u52A8\u5237\u65B0\u4E00\u6B21\u3002").addButton(
      (btn) => btn.setButtonText("\u540C\u6B65").onClick(() => this.plugin.syncGlobalHotkey())
    );
    new import_obsidian.Setting(containerEl).setName("\u7F6E\u9876 (Always on top)").setDesc('\u5524\u51FA\u65F6\u662F\u5426\u8BA9\u7A97\u53E3\u771F\u6B63\u6D6E\u5728\u6700\u4E0A\u5C42\u3001\u6321\u4F4F\u5176\u4ED6\u8F6F\u4EF6\uFF1B\u5173\u95ED\u5219\u53EA"\u5E26\u5230\u524D\u53F0"\u3002').addToggle(
      (t) => t.setValue(this.plugin.settings.alwaysOnTop).onChange(async (v) => {
        this.plugin.settings.alwaysOnTop = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u6536\u8D77\u65B9\u5F0F").setDesc("\u5173\u95ED\u65F6\uFF1A\u9690\u85CF\u7A97\u53E3\uFF08\u4E0D\u5360\u4EFB\u52A1\u680F\uFF0C\u50CF Alt+E \u6536\u8D77\uFF09\u8FD8\u662F\u6700\u5C0F\u5316\u5230\u4EFB\u52A1\u680F\u3002").addToggle(
      (t) => t.setValue(this.plugin.settings.hideInsteadOfMinimize).onChange(async (v) => {
        this.plugin.settings.hideInsteadOfMinimize = v;
        await this.plugin.saveSettings();
      })
    );
  }
};
