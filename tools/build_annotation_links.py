# -*- coding: utf-8 -*-
"""建立《红楼梦》分回文档中「正文角标」与「章末注释/校记」的机器可读链接索引。

用法:
    python -I build_annotation_links.py <chapters_dir> <links_dir>

输入:
    <chapters_dir>/_目录.tsv        切分清单（由 split_chapters.py 生成）
    <chapters_dir>/第*.txt          分回正文

输出:
    <links_dir>/annotations.json    全量索引（推荐给程序读取）
    <links_dir>/annotations.tsv     每个正文角标一行（表格/数据库导入）
    <links_dir>/notes.tsv           每个注释块一行
    <links_dir>/annotations.sqlite3 SQLite 查询库
    <links_dir>/by_chapter/*.json   每回一个独立索引
    <links_dir>/README.md           字段、坐标与用法说明
    <links_dir>/validation_report.txt 自检结果

坐标约定:
    line    章内 1 基行号
    column  行内 0 基 Unicode 码点下标（不含换行符）
    char_offset  把 CRLF 规范成 LF 后，从文件头起算的 0 基码点偏移
    byte_offset  把 CRLF 规范成 LF 后，从文件头起算的 0 基 UTF-8 字节偏移
    source_line  整本书源文件中的 1 基行号（来自 _目录.tsv 的起始行）
"""
import hashlib
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

NUM = "一二三四五六七八九十百零〇○"
MARK_RE = re.compile(r"(\[\d+\]|〔[" + NUM + r"]+〕)")
LEAD_RE = re.compile(r"\s*(\[\d+\]|〔[" + NUM + r"]+〕)")
SEP_RE = re.compile(r"^\s*\*\s*\*\s*\*\s*$")

COORDINATES = {
    "line": "章内 1 基行号",
    "column": "行内 0 基 Unicode 码点下标（不含换行符）",
    "char_offset": "CRLF 规范为 LF 后，从文件头起算的 0 基码点偏移",
    "byte_offset": "CRLF 规范为 LF 后，从文件头起算的 0 基 UTF-8 字节偏移",
    "source_line": "整本书源文件中的 1 基行号",
}


def tsv_escape(value):
    if value is None:
        return ""
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("\t", "\\t")
        .replace("\r", "")
        .replace("\n", "\\n")
    )


def parse_leading_markers(line):
    """解析注释行开头的连续角标，例如 '[15] 〔四〕 正文...'。"""
    aliases = []
    pos = 0
    first_col = None
    while True:
        m = LEAD_RE.match(line, pos)
        if not m:
            break
        if first_col is None:
            first_col = m.start(1)
        aliases.append(m.group(1))
        pos = m.end()
    if not aliases:
        return [], line, None
    return aliases, line[pos:].lstrip(), first_col


def build_offsets(lines):
    char_prefix = [0]
    byte_prefix = [0]
    for line in lines:
        char_prefix.append(char_prefix[-1] + len(line) + 1)
        byte_prefix.append(byte_prefix[-1] + len(line.encode("utf-8")) + 1)
    return char_prefix, byte_prefix


def offsets_at(lines, char_prefix, byte_prefix, line_no, column):
    """line_no 为 1 基，column 为 0 基码点下标。"""
    i = line_no - 1
    char_offset = char_prefix[i] + column
    byte_offset = byte_prefix[i] + len(lines[i][:column].encode("utf-8"))
    return char_offset, byte_offset


def read_manifest(chapters_dir):
    path = chapters_dir / "_目录.tsv"
    if not path.exists():
        raise SystemExit(f"找不到切分清单: {path}")
    rows = path.read_text(encoding="utf-8").splitlines()
    header = rows[0].split("\t")
    result = []
    for row in rows[1:]:
        if not row.strip():
            continue
        result.append(dict(zip(header, row.split("\t"))))
    return result


def process_chapter(row, chapters_dir):
    path = chapters_dir / row["文件名"]
    raw_bytes = path.read_bytes()
    sha256 = hashlib.sha256(raw_bytes).hexdigest()
    text = raw_bytes.decode("utf-8")
    lines = text.splitlines()
    if not lines:
        raise SystemExit(f"空文件: {path}")
    char_prefix, byte_prefix = build_offsets(lines)

    sep_idx = next((i for i, line in enumerate(lines) if SEP_RE.match(line)), None)
    separator_line = sep_idx + 1 if sep_idx is not None else None
    body = lines[:sep_idx] if sep_idx is not None else lines
    notes = lines[sep_idx + 1:] if sep_idx is not None else []

    source_start = int(row["起始行"])
    chapter_key = row["回次"]

    links = []
    for i, line in enumerate(body, start=1):
        for m in MARK_RE.finditer(line):
            marker = m.group(1)
            col = m.start(1)
            kind = "footnote" if marker.startswith("[") else "collation"
            char_offset, byte_offset = offsets_at(
                lines, char_prefix, byte_prefix, i, col
            )
            end_char, end_byte = offsets_at(
                lines, char_prefix, byte_prefix, i, col + len(marker)
            )
            links.append({
                "marker": marker,
                "kind": kind,
                "status": "pending",
                "line": i,
                "column": col,
                "marker_end_column": col + len(marker),
                "char_offset": char_offset,
                "byte_offset": byte_offset,
                "marker_end_char_offset": end_char,
                "marker_end_byte_offset": end_byte,
                "source_line": source_start + i - 1,
                "context_before": line[max(0, col - 24):col],
                "context_after": line[col + len(marker):col + len(marker) + 24],
                "note_id": None,
                "adjacent_note_ids": [],
                "candidate_note_ids": [],
            })

    starts = []
    for i, line in enumerate(notes):
        aliases, rest, col = parse_leading_markers(line)
        if aliases:
            starts.append((i, aliases, rest, col))

    note_blocks = []
    for j, (i, aliases, rest, col) in enumerate(starts):
        end_idx = starts[j + 1][0] - 1 if j + 1 < len(starts) else len(notes) - 1
        block = notes[i:end_idx + 1]
        while block and not block[-1].strip():
            block.pop()
        if not block:
            continue
        line_no = (sep_idx + 2) + i
        end_line = line_no + len(block) - 1
        char_offset, byte_offset = offsets_at(
            lines, char_prefix, byte_prefix, line_no, col or 0
        )
        if all(a.startswith("[") for a in aliases):
            kind = "footnote"
        elif all(a.startswith("〔") for a in aliases):
            kind = "collation"
        else:
            kind = "mixed"
        clean_lines = [rest] + block[1:]
        text_clean = "\n".join(clean_lines).strip()
        note_blocks.append({
            "id": f"c{chapter_key}-n{j + 1:04d}",
            "kind": kind,
            "aliases": aliases,
            "line": line_no,
            "end_line": end_line,
            "column": col or 0,
            "char_offset": char_offset,
            "byte_offset": byte_offset,
            "source_line": source_start + line_no - 1,
            "text": "\n".join(block),
            "text_clean": text_clean,
            "body_occurrences": [],
        })

    alias_map = {}
    for note in note_blocks:
        for alias in note["aliases"]:
            alias_map.setdefault(alias, []).append(note)
    duplicate_aliases = {
        alias: [n["id"] for n in items]
        for alias, items in alias_map.items()
        if len(items) > 1
    }

    for seq, link in enumerate(links, start=1):
        link["id"] = f"c{chapter_key}-l{seq:04d}"
        matches = alias_map.get(link["marker"], [])
        if len(matches) == 1:
            link["status"] = "ok"
            link["note_id"] = matches[0]["id"]
            matches[0]["body_occurrences"].append(link["id"])
        elif len(matches) == 0:
            link["status"] = "missing_definition"
        else:
            link["status"] = "ambiguous"
            link["candidate_note_ids"] = [n["id"] for n in matches]

    resolved = [l for l in links if l["status"] == "ok" and l["note_id"]]
    for link in links:
        if link["status"] == "ok":
            continue
        adjacent = []
        for other in resolved:
            if other["line"] == link["line"] and abs(other["column"] - link["column"]) <= len(link["marker"]) + 4:
                if other["note_id"] not in adjacent:
                    adjacent.append(other["note_id"])
        link["adjacent_note_ids"] = adjacent

    used_markers = {l["marker"] for l in links if l["note_id"]}
    unused_aliases = []
    for note in note_blocks:
        for alias in note["aliases"]:
            if alias not in used_markers:
                unused_aliases.append({
                    "alias": alias,
                    "note_id": note["id"],
                    "line": note["line"],
                    "reason": "该注释块存在，但正文中没有使用这个别名",
                })

    orphan_note_ids = [n["id"] for n in note_blocks if not n["body_occurrences"]]

    summary = {
        "body_markers": len(links),
        "resolved": sum(1 for l in links if l["status"] == "ok"),
        "missing_definitions": sum(1 for l in links if l["status"] == "missing_definition"),
        "ambiguous": sum(1 for l in links if l["status"] == "ambiguous"),
        "note_blocks": len(note_blocks),
        "unused_note_aliases": len(unused_aliases),
        "orphan_note_blocks": len(orphan_note_ids),
    }

    return {
        "index": int(row["序号"]),
        "chapter": chapter_key,
        "title": row["回目"],
        "file": row["文件名"],
        "sha256": sha256,
        "file_size_bytes": len(raw_bytes),
        "source_start_line": source_start,
        "line_count": len(lines),
        "separator_line": separator_line,
        "note_start_line": note_blocks[0]["line"] if note_blocks else None,
        "summary": summary,
        "notes": note_blocks,
        "links": links,
        "unused_note_aliases": unused_aliases,
        "orphan_note_ids": orphan_note_ids,
        "duplicate_note_aliases": duplicate_aliases,
    }


def write_json(path, obj):
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def write_tsv(chapters, links_dir):
    link_header = [
        "chapter_index", "chapter", "file", "link_id", "marker", "kind", "status",
        "line", "column", "char_offset", "byte_offset", "source_line",
        "context_before", "context_after", "note_id", "note_line", "note_end_line",
        "note_source_line", "note_aliases", "note_preview", "adjacent_note_ids",
    ]
    with (links_dir / "annotations.tsv").open("w", encoding="utf-8", newline="\n") as f:
        f.write("\t".join(link_header) + "\n")
        for ch in chapters:
            note_by_id = {n["id"]: n for n in ch["notes"]}
            for link in ch["links"]:
                note = note_by_id.get(link["note_id"])
                row = [
                    ch["index"], ch["chapter"], ch["file"], link["id"],
                    link["marker"], link["kind"], link["status"],
                    link["line"], link["column"], link["char_offset"],
                    link["byte_offset"], link["source_line"],
                    link["context_before"], link["context_after"],
                    link["note_id"] or "",
                    note["line"] if note else "",
                    note["end_line"] if note else "",
                    note["source_line"] if note else "",
                    ";".join(note["aliases"]) if note else "",
                    note["text_clean"][:200] if note else "",
                    ";".join(link["adjacent_note_ids"]),
                ]
                f.write("\t".join(tsv_escape(x) for x in row) + "\n")

    note_header = [
        "chapter_index", "chapter", "file", "note_id", "kind", "aliases",
        "line", "end_line", "column", "char_offset", "byte_offset", "source_line",
        "body_occurrence_count", "body_occurrence_ids", "orphan",
        "text", "text_clean",
    ]
    with (links_dir / "notes.tsv").open("w", encoding="utf-8", newline="\n") as f:
        f.write("\t".join(note_header) + "\n")
        for ch in chapters:
            for note in ch["notes"]:
                row = [
                    ch["index"], ch["chapter"], ch["file"], note["id"],
                    note["kind"], ";".join(note["aliases"]),
                    note["line"], note["end_line"], note["column"],
                    note["char_offset"], note["byte_offset"], note["source_line"],
                    len(note["body_occurrences"]),
                    ";".join(note["body_occurrences"]),
                    1 if not note["body_occurrences"] else 0,
                    note["text"], note["text_clean"],
                ]
                f.write("\t".join(tsv_escape(x) for x in row) + "\n")


def write_sqlite(chapters, links_dir):
    db_path = links_dir / "annotations.sqlite3"
    if db_path.exists():
        db_path.unlink()
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript("""
        CREATE TABLE chapters (
            id INTEGER PRIMARY KEY,
            chapter TEXT NOT NULL,
            title TEXT,
            file TEXT NOT NULL UNIQUE,
            sha256 TEXT,
            file_size_bytes INTEGER,
            source_start_line INTEGER,
            line_count INTEGER,
            separator_line INTEGER,
            note_start_line INTEGER,
            body_markers INTEGER,
            resolved INTEGER,
            missing_definitions INTEGER,
            ambiguous INTEGER,
            note_blocks INTEGER
        );
        CREATE TABLE notes (
            id TEXT PRIMARY KEY,
            chapter_id INTEGER NOT NULL REFERENCES chapters(id),
            kind TEXT,
            aliases TEXT,
            line INTEGER,
            end_line INTEGER,
            col INTEGER,
            char_offset INTEGER,
            byte_offset INTEGER,
            source_line INTEGER,
            text TEXT,
            text_clean TEXT,
            body_occurrence_count INTEGER,
            body_occurrence_ids TEXT,
            orphan INTEGER
        );
        CREATE TABLE links (
            id TEXT PRIMARY KEY,
            chapter_id INTEGER NOT NULL REFERENCES chapters(id),
            note_id TEXT REFERENCES notes(id),
            marker TEXT,
            kind TEXT,
            status TEXT,
            line INTEGER,
            col INTEGER,
            marker_end_col INTEGER,
            char_offset INTEGER,
            byte_offset INTEGER,
            marker_end_char_offset INTEGER,
            marker_end_byte_offset INTEGER,
            source_line INTEGER,
            context_before TEXT,
            context_after TEXT,
            adjacent_note_ids TEXT,
            candidate_note_ids TEXT
        );
        CREATE INDEX idx_links_chapter_pos ON links(chapter_id, line, col);
        CREATE INDEX idx_links_marker ON links(chapter_id, marker);
        CREATE INDEX idx_notes_chapter_pos ON notes(chapter_id, line);
        CREATE VIEW link_lookup AS
        SELECT
            c.chapter AS chapter,
            c.file AS file,
            l.id AS link_id,
            l.marker AS marker,
            l.kind AS kind,
            l.status AS status,
            l.line AS line,
            l.col AS col,
            l.source_line AS source_line,
            l.context_before AS context_before,
            l.context_after AS context_after,
            l.note_id AS note_id,
            n.kind AS note_kind,
            n.aliases AS note_aliases,
            n.line AS note_line,
            n.end_line AS note_end_line,
            n.source_line AS note_source_line,
            n.text_clean AS note_text
        FROM links l
        JOIN chapters c ON c.id = l.chapter_id
        LEFT JOIN notes n ON n.id = l.note_id;
    """)

    con.executemany(
        "INSERT INTO chapters VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                ch["index"], ch["chapter"], ch["title"], ch["file"],
                ch["sha256"], ch["file_size_bytes"], ch["source_start_line"],
                ch["line_count"], ch["separator_line"], ch["note_start_line"],
                ch["summary"]["body_markers"], ch["summary"]["resolved"],
                ch["summary"]["missing_definitions"], ch["summary"]["ambiguous"],
                ch["summary"]["note_blocks"],
            )
            for ch in chapters
        ],
    )
    note_rows = []
    link_rows = []
    for ch in chapters:
        for note in ch["notes"]:
            note_rows.append((
                note["id"], ch["index"], note["kind"],
                json.dumps(note["aliases"], ensure_ascii=False),
                note["line"], note["end_line"], note["column"],
                note["char_offset"], note["byte_offset"], note["source_line"],
                note["text"], note["text_clean"], len(note["body_occurrences"]),
                json.dumps(note["body_occurrences"], ensure_ascii=False),
                1 if not note["body_occurrences"] else 0,
            ))
        for link in ch["links"]:
            link_rows.append((
                link["id"], ch["index"], link["note_id"], link["marker"],
                link["kind"], link["status"], link["line"], link["column"],
                link["marker_end_column"], link["char_offset"], link["byte_offset"],
                link["marker_end_char_offset"], link["marker_end_byte_offset"],
                link["source_line"], link["context_before"], link["context_after"],
                json.dumps(link["adjacent_note_ids"], ensure_ascii=False),
                json.dumps(link["candidate_note_ids"], ensure_ascii=False),
            ))
    con.executemany(
        "INSERT INTO notes VALUES (" + ",".join("?" * 15) + ")", note_rows
    )
    con.executemany(
        "INSERT INTO links VALUES (" + ",".join("?" * 18) + ")", link_rows
    )
    con.commit()

    checks = {
        "links": con.execute("SELECT COUNT(*) FROM links").fetchone()[0],
        "notes": con.execute("SELECT COUNT(*) FROM notes").fetchone()[0],
        "chapters": con.execute("SELECT COUNT(*) FROM chapters").fetchone()[0],
        "missing": con.execute(
            "SELECT COUNT(*) FROM links WHERE status='missing_definition'"
        ).fetchone()[0],
        "broken_note_refs": con.execute(
            "SELECT COUNT(*) FROM links l LEFT JOIN notes n ON l.note_id=n.id "
            "WHERE l.note_id IS NOT NULL AND n.id IS NULL"
        ).fetchone()[0],
    }
    con.close()
    return db_path, checks


def build_readme(links_dir, stats, chapters):
    missing = [
        (ch["chapter"], l["marker"], l["line"], l["column"], l["context_before"], l["context_after"], l["adjacent_note_ids"])
        for ch in chapters for l in ch["links"] if l["status"] != "ok"
    ]
    sample_ch = chapters[0]
    sample_link = next(l for l in sample_ch["links"] if l["status"] == "ok")
    sample_note = next(n for n in sample_ch["notes"] if n["id"] == sample_link["note_id"])
    text = f"""# 红楼梦注释链接索引

本目录把分回正文中的角标与章末注释/校记建立了机器可读的链接。

## 文件

- `annotations.json`：全量索引，推荐程序读取。
- `annotations.tsv`：一个正文角标一行，便于导入表格/数据库。
- `notes.tsv`：一个注释块一行。
- `annotations.sqlite3`：SQLite 查询库，含 `chapters`、`links`、`notes` 表和 `link_lookup` 视图。
- `by_chapter/*.json`：每回一个独立索引，文件名与章节 `.txt` 同名（扩展名改为 `.json`）。
- `validation_report.txt`：生成时的自检结果。

## 坐标约定

| 字段 | 含义 |
|---|---|
| `line` | 章内 1 基行号 |
| `column` | 行内 0 基 Unicode 码点下标（不含换行符） |
| `char_offset` | 把文件 CRLF 规范成 LF 后，从文件头起算的 0 基码点偏移 |
| `byte_offset` | 把文件 CRLF 规范成 LF 后，从文件头起算的 0 基 UTF-8 字节偏移 |
| `source_line` | 整本书源文件中的 1 基行号 |

注意：`line`/`column` 不依赖换行风格，最稳健；`char_offset`/`byte_offset`
按 LF 文本计算，若你的软件保留 CRLF，请自行把 `\\r\\n` 规范为 `\\n` 后再用偏移量。

## 版本校验

`annotations.json` 的每个章节对象和 SQLite 的 `chapters` 表都带有
`sha256` 与 `file_size_bytes`。使用索引前，先对当前章节 `.txt` 计算 SHA-256
并与索引值比对；不一致说明正文已改动，行/列位置可能失效，请重新生成本索引。

## 链接状态 `status`

- `ok`：正文角标找到唯一注释定义，`note_id` 指向该注释块。
- `missing_definition`：正文有角标，但章末没有对应定义（本书共 {stats['missing_definitions']} 处）。
  这类记录仍保留精确位置；`adjacent_note_ids` 给出同一位置紧邻的、能解析的校记，
  可作为回退展示，但不要把它当作同一注释。
- `ambiguous`：同一编号有多个定义（本书没有这种情况）。

## 注释块

章末以 `* * *` 分隔。一个注释块可能：

- 跨多行（如引诗、长校记）；
- 以多个连续角标开头，例如第 5 回第 220 行的 `[15] 〔四〕 ...`，
  此时 `notes[].aliases` 同时包含 `[15]` 和 `〔四〕`，正文中的 `〔四〕` 会链接到该块；
- 包含正文中没有使用的别名（`unused_note_aliases`）。

正文中的 `〔红楼梦引子〕` 等是曲牌/诗题，不是注释，未纳入索引；只识别
`〔一〕`、`〔二〕`、`〔一〇〕` 这类纯数字式校记编号。

## 示例

### SQLite

```sql
-- 第 001 回某位置的角标及其注释
SELECT marker, line, col, note_id, note_text
FROM link_lookup
WHERE chapter = '001' AND line = 4 AND col = 125;

-- 已知角标文本时按编号查（同一回内编号唯一）
SELECT marker, line, col, note_id, note_text
FROM link_lookup
WHERE chapter = '001' AND marker = '[1]';

-- 第 021 回所有缺定义的角标，以及同位置可回退的校记
SELECT l.marker, l.line, l.col, l.adjacent_note_ids, n.text_clean AS fallback
FROM links l
JOIN chapters c ON c.id = l.chapter_id
LEFT JOIN notes n ON n.id = json_extract(l.adjacent_note_ids, '$[0]')
WHERE c.chapter = '021' AND l.status = 'missing_definition';
```

`notes.aliases`、`links.adjacent_note_ids`、`links.candidate_note_ids`
在 SQLite 中是 JSON 数组文本；`annotations.tsv` / `notes.tsv` 中的制表符和换行
分别转义为 `\\t`、`\\n`。

### Python（按位置查最近的前置角标）

```python
import json
data = json.load(open("links/annotations.json", encoding="utf-8"))
ch = next(c for c in data["chapters"] if c["file"] == "{sample_ch['file']}")
target = ({sample_link['line']}, {sample_link['column']})
before = [l for l in ch["links"]
          if (l["line"], l["column"]) <= target]
if not before:
    print("(该位置之前没有角标)")
else:
    link = max(before, key=lambda l: (l["line"], l["column"]))
    note = next((n for n in ch["notes"] if n["id"] == link.get("note_id")), None)
    print(link["marker"], note["text_clean"] if note else "(无定义)")
```

## 本索引统计

- 分回文档：{stats['chapters']} 个（正文覆盖 120 回，第 17、18 回按底本合并）
- 正文角标：{stats['body_markers']} 个
- 成功链接：{stats['resolved']} 个
- 缺定义：{stats['missing_definitions']} 个
- 注释块：{stats['note_blocks']} 个
- 未使用的注释别名：{stats['unused_note_aliases']} 个
- 无正文位置的注释块：{stats['orphan_note_blocks']} 个

### 缺定义明细

| 回 | 角标 | 行 | 列 | 前文 | 后文 | 同位置校记 |
|---|---|---|---|---|---|---|
"""
    for chapter, marker, line, col, before, after, adj in missing:
        text += f"| {chapter} | `{marker}` | {line} | {col} | {before} | {after} | {', '.join(adj)} |\n"
    text += f"""
## 重新生成

```text
python -I tools/build_annotation_links.py chapters links
```

样例（第 {sample_ch['chapter']} 回）：

```json
{{
  "marker": "{sample_link['marker']}",
  "status": "{sample_link['status']}",
  "line": {sample_link['line']},
  "column": {sample_link['column']},
  "source_line": {sample_link['source_line']},
  "note_id": "{sample_link['note_id']}",
  "note_line": {sample_note['line']},
  "note_text_clean": {json.dumps(sample_note['text_clean'][:120], ensure_ascii=False)}
}}
```
"""
    (links_dir / "README.md").write_text(text, encoding="utf-8", newline="\n")


def validate(global_obj, chapters, checks):
    issues = []
    stats = global_obj["statistics"]
    total_links = sum(len(ch["links"]) for ch in chapters)
    total_notes = sum(len(ch["notes"]) for ch in chapters)
    if total_links != stats["body_markers"]:
        issues.append(f"links 数量不一致: {total_links} != {stats['body_markers']}")
    if total_notes != stats["note_blocks"]:
        issues.append(f"notes 数量不一致: {total_notes} != {stats['note_blocks']}")
    if stats["resolved"] + stats["missing_definitions"] + stats["ambiguous"] != stats["body_markers"]:
        issues.append("resolved + missing + ambiguous != body_markers")
    link_ids = set()
    note_ids = set()
    for ch in chapters:
        for link in ch["links"]:
            if link["id"] in link_ids:
                issues.append(f"重复 link id: {link['id']}")
            link_ids.add(link["id"])
            if link["status"] == "ok" and link["note_id"] not in {n["id"] for n in ch["notes"]}:
                issues.append(f"link {link['id']} 指向不存在的注释 {link['note_id']}")
        for note in ch["notes"]:
            if note["id"] in note_ids:
                issues.append(f"重复 note id: {note['id']}")
            note_ids.add(note["id"])
            for occ in note["body_occurrences"]:
                if occ not in {l["id"] for l in ch["links"]}:
                    issues.append(f"note {note['id']} 的 body_occurrence {occ} 不存在")
    for key, value in checks.items():
        expected = {
            "links": stats["body_markers"],
            "notes": stats["note_blocks"],
            "chapters": stats["chapters"],
            "missing": stats["missing_definitions"],
            "broken_note_refs": 0,
        }[key]
        if value != expected:
            issues.append(f"SQLite {key}={value}，预期 {expected}")
    return issues


def main():
    if len(sys.argv) != 3:
        print("用法: python -I build_annotation_links.py <chapters_dir> <links_dir>")
        return 2
    chapters_dir = Path(sys.argv[1])
    links_dir = Path(sys.argv[2])
    links_dir.mkdir(parents=True, exist_ok=True)
    (links_dir / "by_chapter").mkdir(parents=True, exist_ok=True)

    rows = read_manifest(chapters_dir)
    chapters = [process_chapter(row, chapters_dir) for row in rows]
    chapters.sort(key=lambda c: c["index"])

    stats = {
        "chapters": len(chapters),
        "body_markers": sum(c["summary"]["body_markers"] for c in chapters),
        "resolved": sum(c["summary"]["resolved"] for c in chapters),
        "missing_definitions": sum(c["summary"]["missing_definitions"] for c in chapters),
        "ambiguous": sum(c["summary"]["ambiguous"] for c in chapters),
        "note_blocks": sum(c["summary"]["note_blocks"] for c in chapters),
        "unused_note_aliases": sum(c["summary"]["unused_note_aliases"] for c in chapters),
        "orphan_note_blocks": sum(c["summary"]["orphan_note_blocks"] for c in chapters),
    }

    source_file = ""
    note_path = chapters_dir / "_切分说明.txt"
    if note_path.exists():
        first = note_path.read_text(encoding="utf-8").splitlines()
        if first:
            source_file = first[0].split(": ", 1)[-1]

    global_obj = {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_file": source_file,
        "chapters_dir": str(chapters_dir),
        "coordinate_system": COORDINATES,
        "statistics": stats,
        "chapters": chapters,
    }
    write_json(links_dir / "annotations.json", global_obj)

    for ch in chapters:
        obj = {
            "schema_version": "1.0",
            "coordinate_system": COORDINATES,
            "chapter": ch,
        }
        write_json(links_dir / "by_chapter" / (Path(ch["file"]).stem + ".json"), obj)

    write_tsv(chapters, links_dir)
    db_path, checks = write_sqlite(chapters, links_dir)
    build_readme(links_dir, stats, chapters)

    issues = validate(global_obj, chapters, checks)
    report_lines = [
        "红楼梦注释链接索引自检",
        f"生成时间: {global_obj['generated_at']}",
        "",
        f"章节数: {stats['chapters']}",
        f"正文角标: {stats['body_markers']}",
        f"成功链接: {stats['resolved']}",
        f"缺定义: {stats['missing_definitions']}",
        f"歧义: {stats['ambiguous']}",
        f"注释块: {stats['note_blocks']}",
        f"未使用别名: {stats['unused_note_aliases']}",
        f"无正文位置的注释块: {stats['orphan_note_blocks']}",
        f"SQLite: {db_path.name}  checks={checks}",
        "",
        "结果: " + ("通过" if not issues else "发现问题"),
    ]
    if issues:
        report_lines += ["", "问题:"] + [f"- {x}" for x in issues]
    else:
        report_lines += ["", "所有链接、注释引用和 SQLite 计数一致。"]
    (links_dir / "validation_report.txt").write_text(
        "\n".join(report_lines) + "\n", encoding="utf-8", newline="\n"
    )

    print(f"完成：{stats['chapters']} 章，{stats['body_markers']} 个正文角标，"
          f"{stats['resolved']} 条链接，{stats['missing_definitions']} 个缺定义")
    print(f"输出目录: {links_dir}")
    print("自检:", "通过" if not issues else f"发现问题 {len(issues)} 项")
    for issue in issues[:20]:
        print(" -", issue)
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
