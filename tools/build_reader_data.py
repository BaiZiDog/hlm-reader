# -*- coding: utf-8 -*-
"""把分回正文与注释索引合成为阅读器使用的 data.js。

用法:
    python -I tools/build_reader_data.py

输入:
    chapters/*.txt
    links/by_chapter/*.json
输出:
    reader/app/data.js

数据中每个正文段落保存为字符串（无角标）或 token 数组（含角标）。
位置一律来自 links 索引，不在渲染阶段重新解析，避免错位。
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
CHAPTERS = BASE / "chapters"
INDEX_DIR = BASE / "links" / "by_chapter"
OUT = BASE / "reader" / "app" / "data.js"

MARK_RE = re.compile(r"\[\d+\]|〔[一二三四五六七八九十百零〇○]+〕")


def tokens_for(line_no: int, text: str, links_by_line: dict, where: str):
    """按注释索引给出的列位置，把一行切成文本片段与角标 token。"""
    links = sorted(links_by_line.get(line_no, []), key=lambda x: x["column"])
    if not links:
        return text
    parts, pos = [], 0
    for link in links:
        col, end = link["column"], link["marker_end_column"]
        marker = link["marker"]
        if col < pos or text[col:end] != marker:
            raise ValueError(
                f"{where}: 第 {line_no} 行角标错位，期望 {marker!r}，"
                f"实际 {text[col:end]!r}（列 {col}-{end}）"
            )
        if col > pos:
            parts.append(text[pos:col])
        token = {
            "marker": marker,
            "noteId": link.get("note_id"),
            "kind": link["kind"],
            "status": link["status"],
        }
        if link.get("adjacent_note_ids"):
            token["adjacent"] = link["adjacent_note_ids"]
        if link.get("candidate_note_ids"):
            token["candidates"] = link["candidate_note_ids"]
        parts.append(token)
        pos = end
    if pos < len(text):
        parts.append(text[pos:])
    return parts


def plain_text(parts) -> str:
    """去掉角标后的纯文本，用于判断诗行与建立检索。"""
    if isinstance(parts, str):
        return parts
    return "".join(p for p in parts if isinstance(p, str))


def verse_candidate(text: str) -> bool:
    """判断一行是否像诗句：短、无引号、无冒号、最多一个句末标点。"""
    s = text.strip()
    if not (8 <= len(s) <= 56):
        return False
    if any(c in s for c in "“”『』「」"):
        return False
    if "：" in s:
        return False
    if any(w in s for w in ("说道", "笑道", "问道", "答道", "回道", "想道",
                            "叫道", "喝道", "骂道", "道是")):
        return False
    ends = sum(s.count(c) for c in "。？！")
    if ends > 1:
        return False
    if ends == 1 and s[-1] not in "。？！":
        return False
    if not any(c in s for c in "，；"):
        return False
    return True


def clean_label(heading: str) -> str:
    label = re.split(r"[\s　]", heading.strip(), 1)[0]
    return MARK_RE.sub("", label).strip()


def main() -> int:
    index_files = sorted(INDEX_DIR.glob("*.json"))
    if not index_files:
        print("错误：找不到注释索引", INDEX_DIR)
        return 1

    chapters = []
    total_links = total_notes = total_missing = 0
    verse_lines = 0
    warnings = []

    for index_file in index_files:
        wrapper = json.loads(index_file.read_text(encoding="utf-8"))
        chapter = wrapper["chapter"]
        cid = chapter["chapter"]
        txt_path = CHAPTERS / chapter["file"]
        if not txt_path.exists():
            print("错误：找不到正文文件", txt_path)
            return 1
        raw = txt_path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != chapter["sha256"]:
            print(f"错误：{txt_path.name} 的 SHA-256 与索引不一致")
            return 1
        lines = raw.decode("utf-8").splitlines()

        links_by_line: dict[int, list] = {}
        for link in chapter["links"]:
            links_by_line.setdefault(link["line"], []).append(link)

        sep = chapter["separator_line"]
        if not sep or not (1 <= sep <= len(lines) + 1):
            print(f"错误：{txt_path.name} 的注释分隔行无效: {sep}")
            return 1
        body = lines[:sep - 1]
        while body and not body[-1].strip():
            body.pop()
        if not body:
            print(f"错误：{txt_path.name} 没有正文")
            return 1

        # 校验正文中的角标与索引完全一一对应。
        found = 0
        indexed = sum(len(v) for v in links_by_line.values())
        for line_no in range(1, len(body) + 1):
            n_found = len(MARK_RE.findall(body[line_no - 1]))
            n_index = len(links_by_line.get(line_no, []))
            found += n_found
            if n_found != n_index:
                raise ValueError(
                    f"{txt_path.name}: 第 {line_no} 行角标 {n_found} 个，"
                    f"索引 {n_index} 个"
                )
        if found != indexed:
            raise ValueError(f"{txt_path.name}: 角标覆盖不完整 {found}/{indexed}")

        notes = {}
        note_order = []
        for note in chapter["notes"]:
            text = (note.get("text_clean") or note.get("text") or "").strip()
            if not text:
                warnings.append(f"{txt_path.name}: 注释 {note['id']} 内容为空")
            notes[note["id"]] = {
                "id": note["id"],
                "kind": note["kind"],
                "aliases": note["aliases"],
                "text": text,
                "line": note["line"],
                "endLine": note["end_line"],
                "sourceLine": note["source_line"],
            }
            note_order.append(note["id"])

        for link in chapter["links"]:
            total_links += 1
            if link["status"] != "ok":
                total_missing += 1
            if link.get("note_id") and link["note_id"] not in notes:
                raise ValueError(f"{txt_path.name}: 链接指向不存在的注释 {link['note_id']}")
            for aid in link.get("adjacent_note_ids") or []:
                if aid not in notes:
                    raise ValueError(f"{txt_path.name}: 邻接注释不存在 {aid}")
        total_notes += len(notes)

        heading = tokens_for(1, body[0], links_by_line, txt_path.name)
        label = clean_label(body[0])

        paragraphs = []
        for line_no in range(2, len(body) + 1):
            text = body[line_no - 1]
            if not text.strip():
                continue
            parts = tokens_for(line_no, text, links_by_line, txt_path.name)
            item = {"tokens": parts} if not isinstance(parts, str) else {"text": parts}
            item["verse"] = verse_candidate(plain_text(parts))
            paragraphs.append(item)

        # 连续两行以上像诗句的段落标记为诗行，渲染时居中不缩进。
        i = 0
        while i < len(paragraphs):
            if paragraphs[i]["verse"]:
                j = i
                while j < len(paragraphs) and paragraphs[j]["verse"]:
                    j += 1
                if j - i >= 2:
                    for k in range(i, j):
                        paragraphs[k]["verse"] = True
                        verse_lines += 1
                else:
                    paragraphs[i]["verse"] = False
                i = j
            else:
                i += 1
        for p in paragraphs:
            if not p["verse"]:
                p.pop("verse", None)

        chapters.append({
            "id": cid,
            "label": label,
            "title": chapter["title"],
            "file": chapter["file"],
            "heading": heading,
            "paragraphs": paragraphs,
            "notes": notes,
            "noteOrder": note_order,
            "noteCount": len(notes),
            "linkCount": len(chapter["links"]),
        })

    chapters.sort(key=lambda c: int(c["id"].split("-")[0]))
    meta = {
        "title": "红楼梦",
        "edition": "人民文学出版社 · 2008 年第 3 版 · 全 120 回",
        "generated": date.today().isoformat(),
        "chapters": len(chapters),
        "hui": 120,
        "links": total_links,
        "notes": total_notes,
        "missing": total_missing,
        "verseLines": verse_lines,
    }
    payload = {"meta": meta, "chapters": chapters}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    js = "window.HLM_DATA=" + encoded + ";\n"
    js = js.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(js, encoding="utf-8", newline="\n")
    # 主进程的 AI 工具读取这份纯 JSON，避免再解析浏览器脚本。
    book_json = OUT.parent / "book.json"
    book_json.write_text(encoded, encoding="utf-8", newline="\n")

    print(f"完成：{len(chapters)} 篇 / {total_links} 个角标 / {total_notes} 条注释")
    print(f"缺定义角标: {total_missing}；诗行: {verse_lines}")
    print(f"输出: {OUT}（{OUT.stat().st_size:,} 字节）")
    print(f"AI 数据: {book_json}（{book_json.stat().st_size:,} 字节）")
    if warnings:
        print("警告:")
        for w in warnings:
            print(" -", w)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
