# -*- coding: utf-8 -*-
"""把 Electron 运行时与阅读器代码打包成免安装的 Windows 便携版。

用法:
    python -I tools/pack_reader.py

输出:
    reader/dist/红楼梦阅读器-win64/红楼梦阅读器.exe
    reader/dist/红楼梦阅读器-1.0.0-win64.zip
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
READER = BASE / "reader"
ELECTRON_DIST = READER / "node_modules" / "electron" / "dist"
DIST_ROOT = READER / "dist"
APP_DIR = DIST_ROOT / "红楼梦阅读器-win64"
EXE_NAME = "红楼梦阅读器.exe"
ZIP_PATH = DIST_ROOT / "红楼梦阅读器-1.0.0-win64.zip"
RCEDIT = READER / "node_modules" / "rcedit" / "bin" / "rcedit-x64.exe"

README_TEXT = """红楼梦阅读器 1.0.0

双击「红楼梦阅读器.exe」启动。

使用：
  左侧目录：点击回目跳转，顶部可筛选。
  注释：点击正文中的 [1] 或 〔一〕 角标，右侧栏显示释义；再次点击「本章注释」返回列表。
  缩放：Ctrl + 鼠标滚轮；也可用 Ctrl + = / Ctrl + -，Ctrl + 0 复位。
  搜索：Ctrl + F，输入关键词后回车跳到第一处，点击结果跳转并高亮。
  翻回：← / → 上一回、下一回；Esc 关闭搜索或注释详情。
  面板：Ctrl + B 显示/隐藏目录，Ctrl + J 显示/隐藏注释栏。

AI 导读：
  点击右上角「AI 导读」打开悬浮窗。
  阅读器已内置 Our Free Model 独立免费模型服务，不需要安装 OFM/DSH、Node 或 Bun。
  默认使用 Kilo 免费池 reflection/beam-free；遇到限流会自动尝试其他免费模型。
  部分 OpenCode 免费模型需要 Bun；本程序不附带 Bun，未安装时请选择 Kilo 模型。
  AI 读取章节时正文会自动跟随；回答中的引用段落会淡红标出。
  引用“第X回 pA–pB”会标红整段范围；多个引用可用底部「AI 引用 1/N」导航逐条跳转。
  对 AI 说“带我读第X回 / 读完再讲下一段 / 第X回 pA–pB”，AI 会标出同一回内的
  段落范围并给出阅读时间；正文底部出现「AI 带读」计时条，读完点「读完了，继续」，
  AI 才会讲解这一段并给下一段。计时结束不会自动翻页。只要求标红时，在问题中写
  “第X回 pA–pB”即可。
  输入框上方可勾选「逐段带读」：每次 1–3 段，首次只提示范围，读完后用 2–4 句话
  讲解再给下一段。每条回答可「带索引」或「不带索引」复制。与《红楼梦》无关的
  提问会被拒绝，并禁用发送 30 秒。
  也可在 AI 设置中切换为自定义 Anthropic Messages 兼容 API，填写 Base URL、Key 与模型。
  使用 AI 时，所选章节原文与注释会发送到模型上游；免费池提示词可能被上游记录，
  请勿发送敏感内容。

移动版：
  源码内含 PWA，可部署到 HTTPS 后「添加到主屏幕」，支持手机与平板。
  移动版不内置免费模型运行时，请在 AI 设置中填写你自己的 Anthropic 兼容 API。
  公开仓库不附带正文；移动端首次打开会提示导入 book.json（只存本机）。
  桌面版若缺少书页，也可在同一导入页选择 book.json。

阅读进度、缩放、窗口位置和 AI 设置自动保存在：
  %APPDATA%\\红楼梦阅读器\\reader-state.json
  %APPDATA%\\红楼梦阅读器\\ai-settings.json
内置免费模型服务的数据和 API Key 位于：
  %APPDATA%\\红楼梦阅读器\\ofm

本程序为免安装便携版，不需要 Node.js 或 Python。
首次运行若被 Windows SmartScreen 拦截，请选择「更多信息」→「仍要运行」。
"""


def run_rcedit(exe: Path, icon: Path) -> None:
    if not RCEDIT.exists():
        print("提示：未找到 rcedit，跳过图标/版本信息写入。")
        return
    if not icon.exists():
        print("提示：未找到 icon.ico，跳过图标写入。")
        return
    command = [
        str(RCEDIT), str(exe),
        "--set-icon", str(icon),
        "--set-file-version", "1.0.0",
        "--set-product-version", "1.0.0",
        "--set-version-string", "ProductName", "红楼梦阅读器",
        "--set-version-string", "FileDescription", "红楼梦阅读器",
        "--set-version-string", "CompanyName", "HLM Reader",
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        print("警告：rcedit 写入失败（不影响运行）：")
        print(result.stdout.strip())
        print(result.stderr.strip())
    else:
        print("已写入 exe 图标与版本信息。")


def copy_runtime_packages(src_modules: Path, dst_modules: Path, entry: str) -> None:
    """复制 SDK 及其运行时依赖。npm 的依赖通常会被提升到顶层 node_modules，
    打包时只复制 @anthropic-ai/sdk 会漏掉 standardwebhooks 等依赖，导致主进程
    启动时 require 失败。"""
    pending = [entry]
    copied: set[str] = set()
    while pending:
        name = pending.pop()
        if name in copied:
            continue
        src = src_modules / name
        if not (src / "package.json").exists():
            raise RuntimeError(f"缺少运行时依赖 {name}，请先在 reader 目录执行 npm install")
        copied.add(name)
        dst = dst_modules / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules"))
        package = json.loads((src / "package.json").read_text(encoding="utf-8"))
        for section in ("dependencies", "optionalDependencies"):
            pending.extend((package.get(section) or {}).keys())
    print("复制运行时依赖:", ", ".join(sorted(copied)))


def make_zip() -> None:
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    count = 0
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in APP_DIR.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(DIST_ROOT))
                count += 1
    print(f"压缩包: {ZIP_PATH}（{ZIP_PATH.stat().st_size / 1024 / 1024:.1f} MB，{count} 个文件）")


def main() -> int:
    if not (ELECTRON_DIST / "electron.exe").exists():
        print("错误：找不到 Electron 运行时，请先在 reader 目录执行 npm install。")
        return 1
    if not (READER / "app" / "data.js").exists():
        print("错误：找不到阅读器数据 app/data.js，请先执行 python -I tools/build_reader_data.py")
        return 1

    if APP_DIR.exists():
        print("清理旧目录:", APP_DIR)
        shutil.rmtree(APP_DIR)
    DIST_ROOT.mkdir(parents=True, exist_ok=True)

    print("复制 Electron 运行时…")
    shutil.copytree(ELECTRON_DIST, APP_DIR)

    resources = APP_DIR / "resources"
    app_dir = resources / "app"
    app_dir.mkdir(parents=True, exist_ok=True)
    for name in ("package.json", "main.js", "preload.js", "ai-main.js", "ofm-service.js"):
        shutil.copy2(READER / name, app_dir / name)
    shutil.copytree(READER / "app", app_dir / "app")

    print("复制内置 AI 运行时与 SDK…")
    shutil.copytree(READER / "vendor", app_dir / "vendor")
    try:
        copy_runtime_packages(
            READER / "node_modules", app_dir / "node_modules", "@anthropic-ai/sdk"
        )
    except RuntimeError as err:
        print(f"错误：{err}")
        return 1

    background = BASE / "背景信息.md"
    if background.exists() and background.stat().st_size > 0:
        shutil.copy2(background, app_dir / "背景信息.md")

    default_app = resources / "default_app.asar"
    if default_app.exists():
        default_app.unlink()

    exe = APP_DIR / "electron.exe"
    target_exe = APP_DIR / EXE_NAME
    exe.rename(target_exe)
    run_rcedit(target_exe, READER / "app" / "icon.ico")

    (APP_DIR / "启动说明.txt").write_text(README_TEXT, encoding="utf-8-sig", newline="\r\n")

    size_mb = sum(p.stat().st_size for p in APP_DIR.rglob("*") if p.is_file()) / 1024 / 1024
    print(f"便携版目录: {APP_DIR}（{size_mb:.1f} MB）")
    print("可执行文件:", target_exe)
    make_zip()
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
