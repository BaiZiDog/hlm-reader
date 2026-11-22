# 书源数据构建

公开仓库**不包含**《红楼梦》正文、注释或由它们生成的 `data.js` / `book.json`。
下面的流程用于处理你自己合法持有的源文件。

## 输入格式

`split_chapters.py` 面向一整本 UTF-8 纯文本，要求：

- 每回以 `第一回 ……`、`第二十一回 ……` 这样的回目行开头；
- 第十七、十八回可以合并为 `第十七回至第十八回 ……`；
- 回目行下面依次是正文、`* * *` 分隔线、本章注释/校记；
- 注释块以 `[1]`、`[2]` 或 `〔一〕`、`〔二〕` 开头，可跨多行；
- 目录页（连续紧邻的回目行）会被自动排除。

不同版本的排版可能不同。先检查 `chapters/_目录.tsv` 与 `chapters/_切分说明.txt`，确认切分结果。

## 1. 按回切分

在仓库根目录执行：

```bash
python -I tools/split_chapters.py "你的源文件.txt" chapters
```

输出：

```
chapters/
  _目录.tsv
  _切分说明.txt
  第001回 ....txt
  ...
```

第十七、十八回会合并成 `第017-018回 ....txt`，对应阅读器里的「第十七回至十八回」。

## 2. 建立角标与注释链接

```bash
python -I tools/build_annotation_links.py chapters links
```

输出 `links/annotations.json`、`annotations.tsv`、`notes.tsv`、`annotations.sqlite3` 和 `links/by_chapter/*.json`。工具会检查：

- 每个正文角标能否找到唯一定义；
- 缺定义角标（原书有角标但没有释义）保留位置并记录相邻校记；
- 注释块别名、跨行注释和正文位置是否一致。

查看 `links/validation_report.txt`，应当显示「结果: 通过」。

## 3. 生成阅读器数据

```bash
python -I tools/build_reader_data.py
```

输出：

- `reader/app/data.js`：界面直接加载的 `window.HLM_DATA`；
- `reader/app/book.json`：AI 工具和移动端导入使用的纯 JSON。

脚本会再次校验每回 SHA-256、角标总数和注释引用；任何不一致都会报错并停止。

## 4. 在移动端导入

把 `reader/app/book.json` 传到手机，打开阅读器的 PWA，选择「选择 book.json」即可。文件会存进本机 IndexedDB，不上传。

也可以在桌面版中导入；桌面版会把它写到 `%APPDATA%\红楼梦阅读器\book.json`，供 AI 主进程读取。

## 数据权利

正文、注释、校记和排版可能分别受到著作权保护。构建、使用和再分发前，请确认你对源文件拥有相应权利。项目的 MIT 许可证只覆盖程序代码，不覆盖书页数据。
