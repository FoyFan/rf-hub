#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RF Hub — 抓取脚本
=================
从公开 RSS 抓取 RF 相关学术前沿条目，写入 data/news.json。

数据源（默认）：
  - arXiv eess.SP (信号处理)  — 含 MIMO/信道/波束/通信物理层
  - arXiv eess.EE (电子学)    — 含电路/天线/RFIC/封装
  - arXiv physics:app-ph (应用物理) — 含超材料/太赫兹（可选）

特点：
  - 单源失败不影响整体（容错）
  - 不抓全文，只取摘要 + 链接 + 作者 + 时间
  - 输出结构对齐前端 app.js 期望的字段
  - 不做定时任务，手动运行

用法：
  cd rf-hub
  .venv/bin/python scripts/fetch_feeds.py

扩展学校/机构动态：
  在 FEEDS 列表里追加 (name, url, category) 三元组即可。
  若源是网页而非 RSS，需另写 parse_* 函数（见 parse_html_fallback）。
"""

import json
import re
import sys
import time
import html
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import requests

# ---------------- 配置 ----------------

FEEDS = [
    # (展示名, RSS URL, 分类标签)
    ("arXiv eess.SP", "http://export.arxiv.org/rss/eess.SP", "信号处理 / 通信物理层"),
    ("arXiv eess 全站", "http://export.arxiv.org/rss/eess", "电子学 / RFIC / 天线"),
    ("arXiv physics:app-ph", "http://export.arxiv.org/rss/physics.app-ph", "应用物理 / 超材料 / 太赫兹"),
]

# 工程类 RSS —— IEEE Spectrum / Microwave Journal / EDN 等
# 抓到的条目写入 engineering.json 的 news 字段，不与学术 news.json 混
# 注：URL 已实测可解析（2026-10）。如某源失效会自动跳过，不影响其他源
ENG_FEEDS = [
    ("IEEE Spectrum", "https://spectrum.ieee.org/rss", "IEEE 综合新闻"),
    ("EDN", "https://www.edn.com/feed", "EDN 电子设计新闻"),
]

# 学校动态扩展位 —— 列出有公开 RSS 或稳定页面的源
# 没有统一 RSS 的，留空数组并手动维护 academia.json
ACADEMIA_FEEDS = [
    # ("MIT RLE News", "https://www.rle.mit.edu/news/feed/", "MIT"),
    # ("Stanford SSI", "https://ssi.stanford.edu/feed", "Stanford"),
]

OUT_NEWS = Path(__file__).resolve().parent.parent / "data" / "news.json"
OUT_ACADEMIA = Path(__file__).resolve().parent.parent / "data" / "academia.json"
OUT_ENGINEERING = Path(__file__).resolve().parent.parent / "data" / "engineering.json"

TIMEOUT = 20
HEADERS = {
    "User-Agent": "RF-Hub/1.0 (local; mailto:user@example.com)",
    "Accept": "application/rss+xml, application/atom+xml, text/xml, */*",
}

MAX_ITEMS = 60  # 每个源最多保留条数，避免 JSON 过大

# ---------------- 工具 ----------------

def fetch(url):
    """下载 RSS 内容，返回文本。失败抛异常。"""
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    # arXiv RSS 偶尔有非标准字符，强制 utf-8
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text

def clean(text):
    """剥离 HTML 标签 + 反转实体。"""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def parse_date(entry):
    """feedparser 的多种日期字段兜底。"""
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        t = entry.get(key)
        if t:
            try:
                dt = datetime(*t[:6], tzinfo=timezone.utc)
                return dt.isoformat()
            except Exception:
                continue
    # 退回字符串
    return entry.get("published") or entry.get("updated") or ""

def parse_authors(entry):
    """作者列表 → 逗号串。arXiv 用 'authors' 列表或 'summary' 里隐含。"""
    authors = entry.get("authors", [])
    if authors:
        names = [a.get("name", "").strip() for a in authors if a.get("name")]
        if names:
            return ", ".join(names)[:200]
    return ""

def snippet_from(entry):
    """取摘要，截断。"""
    s = clean(entry.get("summary") or entry.get("description") or "")
    return s[:300]

# ---------------- 主流程 ----------------

def fetch_one(name, url, category):
    """抓单个 feed，返回条目列表。失败返回空列表并打印原因。"""
    items = []
    try:
        text = fetch(url)
    except Exception as e:
        print(f"  [!] {name} 下载失败：{e}", file=sys.stderr)
        return items

    parsed = feedparser.parse(text)
    if parsed.bozo and parsed.bozo_exception:
        # 非致命，feedparser 通常仍能解析
        print(f"  [-] {name} 解析告警：{parsed.bozo_exception}", file=sys.stderr)

    for entry in parsed.entries[:MAX_ITEMS]:
        title = clean(entry.get("title", "")).replace("\n", " ")
        link = entry.get("link", "")
        items.append({
            "title": title or "(无标题)",
            "source": name,
            "snippet": snippet_from(entry),
            "published": parse_date(entry),
            "authors": parse_authors(entry),
            "link": link,
            "category": category,
        })
    print(f"  [+] {name}: 抓到 {len(items)} 条")
    return items

def main():
    print("=" * 50)
    print("RF Hub — 抓取脚本")
    print(f"时间：{datetime.now().isoformat()}")
    print("=" * 50)

    all_news = []
    print("\n[1/3] 抓取 arXiv / 学术 RSS …")
    for name, url, cat in FEEDS:
        all_news.extend(fetch_one(name, url, cat))
        time.sleep(1)  # 礼貌延迟，避免被限流

    # 按时间倒排（最新的在前）
    def sort_key(it):
        d = it.get("published") or ""
        return d if isinstance(d, str) else ""
    all_news.sort(key=sort_key, reverse=True)

    # 截总数
    all_news = all_news[:200]

    OUT_NEWS.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_NEWS, "w", encoding="utf-8") as f:
        json.dump(all_news, f, ensure_ascii=False, indent=2)
    print(f"\n→ 写入 {OUT_NEWS}（共 {len(all_news)} 条）")

    # ---- 学校动态 ----
    print("\n[2/3] 抓取学校 / 机构动态 …")
    academia_items = []
    for name, url, uni in ACADEMIA_FEEDS:
        academia_items.extend(fetch_one(name, url, uni))

    if academia_items:
        # 转成 academia.json 期望的字段（uni/lab/focus/tags/link）
        out = []
        for it in academia_items:
            out.append({
                "uni": it.get("category", ""),
                "lab": it.get("source", ""),
                "focus": it.get("snippet", "")[:200],
                "tags": ["动态"],
                "link": it.get("link", ""),
            })
        # 不覆盖手填的 academia.json，而是合并写一个 academia_feed.json
        out_path = OUT_ACADEMIA.parent / "academia_feed.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print(f"→ 写入 {out_path}（共 {len(out)} 条，可在前端追加加载）")
    else:
        print("  （未配置学校 RSS，academia.json 保持手填，跳过）")

    # ---- 工程新闻 ----
    # 抓 ENG_FEEDS，写入 engineering.json 的 news 字段
    # 保留手填的 topics/industry/tools，只替换 news
    print("\n[3/3] 抓取工程 / 行业 RSS …")
    eng_news = []
    for name, url, cat in ENG_FEEDS:
        eng_news.extend(fetch_one(name, url, cat))
        time.sleep(1)
    eng_news.sort(key=sort_key, reverse=True)
    eng_news = eng_news[:120]

    # 读取现有 engineering.json，保留 topics/industry/tools，替换 news
    eng_data = {"topics": [], "industry": [], "tools": [], "news": []}
    if OUT_ENGINEERING.exists():
        try:
            with open(OUT_ENGINEERING, "r", encoding="utf-8") as f:
                existing = json.load(f)
            eng_data["topics"] = existing.get("topics", [])
            eng_data["industry"] = existing.get("industry", [])
            eng_data["tools"] = existing.get("tools", [])
            print(f"  已加载既有 engineering.json（topics={len(eng_data['topics'])}，"
                  f"industry={len(eng_data['industry'])}，tools={len(eng_data['tools'])}）")
        except Exception as e:
            print(f"  [!] 读取 engineering.json 失败，将只写 news 字段：{e}", file=sys.stderr)
    eng_data["news"] = eng_news

    with open(OUT_ENGINEERING, "w", encoding="utf-8") as f:
        json.dump(eng_data, f, ensure_ascii=False, indent=2)
    print(f"→ 写入 {OUT_ENGINEERING}（news 共 {len(eng_news)} 条，topics/industry/tools 保留）")

    print("\n完成。打开 index.html 查看最新内容。")
    print("提示：浏览器需通过本地服务器访问，否则 fetch() 会被 CORS 拦截：")
    print("  cd rf-hub && python3 -m http.server 8000")
    print("  然后浏览器打开 http://localhost:8000")

if __name__ == "__main__":
    main()
