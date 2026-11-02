#!/usr/bin/env python3
"""Pin Toggle 诊断探针（只读，不修改任何窗口状态）

用途：在复现「Obsidian 已置顶却被全屏浏览器盖住 / 像被最小化」时运行本脚本，
      打印当前所有顶层窗口的 z-order、WS_EX_TOPMOST 标志、以及 Obsidian
      相对任务栏(Shell_TrayWnd)的位置，用于判定故障属于哪一类。

用法：
    python tools/win-zorder-probe.py            # 打印一次
    python tools/win-zorder-probe.py --watch    # 每秒刷新，边操作边观察

判定口径：
    A. Obsidian 仍带 WS_EX_TOPMOST 且在任务栏之上 -> 属于「全屏窗口高于 topmost」的 OS 语义
    B. Obsidian 仍带 WS_EX_TOPMOST 但位于任务栏之下 -> 命中 Electron behind_task_bar_ 降级
    C. Obsidian 不带 WS_EX_TOPMOST               -> 置顶标志已被剥夺（状态机已失真）
    D. 列表里找不到 Obsidian                     -> 窗口真的被 hide()/minimize() 了
"""

import ctypes
import ctypes.wintypes as wt
import sys
import time

u32 = ctypes.WinDLL("user32", use_last_error=True)

GWL_EXSTYLE = -20
WS_EX_TOPMOST = 0x00000008

EnumProc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
u32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
u32.GetWindowLongPtrW.argtypes = [wt.HWND, ctypes.c_int]
u32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
u32.GetClassNameW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
u32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
u32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]

MONITOR_DEFAULTTONEAREST = 2


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wt.DWORD),
        ("rcMonitor", wt.RECT),
        ("rcWork", wt.RECT),
        ("dwFlags", wt.DWORD),
    ]


def monitor_rect(hwnd):
    hmon = u32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    if not u32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
        return None
    return mi.rcMonitor


def collect():
    rows = []

    def cb(h, _):
        cls_buf = ctypes.create_unicode_buffer(256)
        u32.GetClassNameW(h, cls_buf, 256)
        cls = cls_buf.value

        title_buf = ctypes.create_unicode_buffer(512)
        u32.GetWindowTextW(h, title_buf, 512)
        title = title_buf.value

        visible = bool(u32.IsWindowVisible(h))
        is_taskbar = cls in ("Shell_TrayWnd", "Shell_SecondaryTrayWnd")
        if not visible and not is_taskbar:
            return True
        if not title and not is_taskbar:
            return True

        ex = u32.GetWindowLongPtrW(h, GWL_EXSTYLE)
        pid = wt.DWORD(0)
        u32.GetWindowThreadProcessId(h, ctypes.byref(pid))

        rect = wt.RECT()
        u32.GetWindowRect(h, ctypes.byref(rect))
        mon = monitor_rect(h)
        fullscreen = bool(
            mon
            and rect.left <= mon.left
            and rect.top <= mon.top
            and rect.right >= mon.right
            and rect.bottom >= mon.bottom
        )

        rows.append(
            {
                "z": len(rows),
                "hwnd": h,
                "topmost": bool(ex & WS_EX_TOPMOST),
                "cls": cls,
                "title": title,
                "pid": pid.value,
                "fullscreen": fullscreen,
            }
        )
        return True

    u32.EnumWindows(EnumProc(cb), 0)
    return rows


def report():
    rows = collect()
    fg = u32.GetForegroundWindow()
    print(f"时间: {time.strftime('%H:%M:%S')}   前台 HWND: 0x{fg:X}\n")
    print(f"{'Z':>3}  {'TOPMOST':<7} {'FULLSCR':<7} {'CLASS':<24} TITLE")
    print("-" * 96)
    for r in rows:
        marks = []
        if r["hwnd"] == fg:
            marks.append("前台")
        if r["cls"] == "Shell_TrayWnd":
            marks.append("任务栏")
        if "Obsidian" in r["title"]:
            marks.append("Obsidian")
        suffix = ("  <== " + "/".join(marks)) if marks else ""
        print(
            f"{r['z']:>3}  {'YES' if r['topmost'] else '-':<7} "
            f"{'YES' if r['fullscreen'] else '-':<7} {r['cls'][:24]:<24} {r['title'][:40]}{suffix}"
        )

    obs = [r for r in rows if "Obsidian" in r["title"]]
    bar = [r for r in rows if r["cls"] == "Shell_TrayWnd"]
    print("\n" + "=" * 96)
    if not obs:
        print("判定 D：窗口中找不到 Obsidian —— 窗口已被 hide() 或 minimize()，属于状态机问题。")
        return
    o = obs[0]
    if bar:
        b = bar[0]
        relation = "之上" if o["z"] < b["z"] else "之下"
        print(f"Obsidian Z={o['z']} topmost={o['topmost']}   任务栏 Z={b['z']} topmost={b['topmost']}   相对位置：任务栏{relation}")
    else:
        print(f"Obsidian Z={o['z']} topmost={o['topmost']}   （未找到任务栏）")

    fs = [r for r in rows if r["fullscreen"] and r["hwnd"] != o["hwnd"]]
    if fs:
        print(f"检测到 {len(fs)} 个全屏窗口：" + ", ".join(f"Z={r['z']} {r['title'][:24] or r['cls']}" for r in fs))

    if not o["topmost"]:
        print("判定 C：Obsidian 的 WS_EX_TOPMOST 已被剥夺 —— 置顶标志丢失，插件状态已失真。")
    elif bar and o["z"] > bar[0]["z"]:
        print("判定 B：Obsidian 仍是 topmost，但被压到任务栏之下 —— 命中 Electron behind_task_bar_ 降级路径。")
    elif fs and any(r["z"] < o["z"] for r in fs):
        print("判定 A：Obsidian 仍是 topmost 且高于任务栏，但全屏窗口排在它上面 —— 属于 Windows 全屏窗口高于 topmost 的 OS 语义。")
    else:
        print("判定 OK：Obsidian 处于正常置顶位置。")


if __name__ == "__main__":
    if "--watch" in sys.argv:
        try:
            while True:
                print("\033[H\033[J", end="")
                report()
                time.sleep(1.0)
        except KeyboardInterrupt:
            pass
    else:
        report()
