# -*- coding: utf-8 -*-
"""按回目切分红楼梦全文为每回一个 UTF-8 文本文件。

用法:
    python -I split_chapters.py <源文件.txt> <输出目录>

说明:
- 目录页（连续紧邻的回目行）自动识别并排除，只切正文。
- 本书第十七、十八回合并为「第十七回至十八回」，按原书回目保留为一个文件。
- 输出保留源文件的换行风格（本文件为 CRLF）。
"""
import re
import sys
from pathlib import Path

DIGITS = "一二三四五六七八九"
NUM = "一二三四五六七八九十百零○〇"


def cn2int(s: str) -> int:
    """把回次数字转成整数，兼容 '二十一'、'一○一'、'一一一' 等写法。"""
    if any(c in "○〇" for c in s) or (len(s) > 1 and all(c in DIGITS for c in s)):
        return int("".join(str(DIGITS.index(c) + 1) if c in DIGITS else "0" for c in s))
    total = cur = 0
    for c in s:
        if c in DIGITS:
            cur = DIGITS.index(c) + 1
        elif c == "十":
            total += (cur or 1) * 10
            cur = 0
        elif c == "百":
            total += (cur or 1) * 100
            cur = 0
    return total + cur


HEAD_RE = re.compile(r"^第([" + NUM + r"]+)回(?:至([" + NUM + r"]+)回)?[\s　]")
MARK_RE = re.compile(r"\[\d+\]|〔[^〕]*〕")


def clean_title(heading: str) -> str:
    """去掉回目中的校记/注释角标，规范空白，用于文件名。"""
    t = HEAD_RE.sub("", heading, count=1)
    t = MARK_RE.sub("", t)
    return re.sub(r"[\s　]+", " ", t).strip()


def safe_filename(name: str) -> str:
    """替换 Windows 文件名非法字符，并去掉结尾的点和空格。"""
    trans = str.maketrans({
        "<": "＜", ">": "＞", ":": "：", '"': "＂",
        "/": "／", "\\": "＼", "|": "｜", "?": "？", "*": "＊",
    })
    return name.translate(trans).rstrip(" .")


def find_headings(lines):
    out = []
    for i, line in enumerate(lines):
        if len(line) < 120:
            m = HEAD_RE.match(line)
            if m:
                first = cn2int(m.group(1))
                second = cn2int(m.group(2)) if m.group(2) else None
                out.append({"line": i, "a": first, "b": second, "text": line.rstrip()})
    return out


def main() -> int:
    if len(sys.argv) != 3:
        print("用法: python -I split_chapters.py <源文件.txt> <输出目录>")
        return 2
    src, outdir = Path(sys.argv[1]), Path(sys.argv[2])
    with src.open("r", encoding="utf-8", newline="") as f:
        text = f.read()
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines()

    headings = find_headings(lines)
    # 连续紧邻（间隔 <= 2 行）的回目行超过 4 条，视为目录页，排除。
    groups, cur = [], [headings[0]] if headings else []
    for h in headings[1:]:
        if h["line"] - cur[-1]["line"] <= 2:
            cur.append(h)
        else:
            groups.append(cur)
            cur = [h]
    if cur:
        groups.append(cur)
    toc_groups = [g for g in groups if len(g) >= 5]
    toc_lines = {h["line"] for g in toc_groups for h in g}
    body = [h for h in headings if h["line"] not in toc_lines]
    toc_starts = sorted(g[0]["line"] for g in toc_groups)

    # 校验编号：应为 1..120，仅 17、18 合并。
    got = []
    for h in body:
        got.extend([h["a"], h["b"]] if h["b"] else [h["a"]])
    if got != list(range(1, 121)):
        print("错误：正文回目编号不连续，得到:", got)
        return 1

    outdir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for idx, h in enumerate(body):
        start = h["line"]
        end = (body[idx + 1]["line"] - 1) if idx + 1 < len(body) else len(lines) - 1
        # 若本章之后、下一章之前夹着目录页，本章止于目录页之前。
        for t in toc_starts:
            if start < t <= end:
                end = t - 1
                break
        block = lines[start:end + 1]
        while block and not block[-1].strip():
            block.pop()
        chapter = f"{h['a']:03d}-{h['b']:03d}" if h["b"] else f"{h['a']:03d}"
        title = clean_title(h["text"])
        fname = safe_filename(f"第{chapter}回 {title}.txt")
        body_text = newline.join(block) + newline
        with (outdir / fname).open("w", encoding="utf-8", newline="") as f:
            f.write(body_text)
        manifest.append((idx + 1, fname, chapter, title, start + 1, start + len(block),
                         len(block), len(body_text)))

    with (outdir / "_目录.tsv").open("w", encoding="utf-8", newline="\n") as f:
        f.write("序号\t文件名\t回次\t回目\t起始行\t结束行\t行数\t字符数\n")
        for row in manifest:
            f.write("\t".join(str(x) for x in row) + "\n")

    note = (
        f"源文件: {src.name}\n"
        f"切分结果: {len(manifest)} 个文档（正文共 120 回）\n"
        f"说明: 本书第十七、十八回据底本合并为「第十七回至十八回」，"
        f"故为一个文件；其余每回一个文件。\n"
        f"目录页（连续紧邻的回目行）与前言等非正文内容未包含在文档内。\n"
        f"文件编码: UTF-8；换行: {'CRLF' if newline == chr(13)+chr(10) else 'LF'}。\n"
    )
    (outdir / "_切分说明.txt").write_text(note, encoding="utf-8", newline="\n")

    print(f"完成：{len(manifest)} 个文件 -> {outdir}")
    print(f"总字符数: {sum(r[7] for r in manifest):,}")
    print("首个:", manifest[0][1])
    print("末个:", manifest[-1][1])
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
