#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RF Hub — 本地 Flask 后端（单文件）
=================================
同时承担两个职责：
  1. 静态文件服务（index.html / assets/ / data/）—— 取代 python3 -m http.server
  2. 按需抓取端点 /api/refresh —— 复用 scripts/fetch_feeds.py 的 main() 写盘

启动：
  cd rf-hub
  .venv/bin/python server.py
然后浏览器打开 http://localhost:8000

设计：
  - host=127.0.0.1 仅本机可达
  - debug=False 避免 Werkzeug reloader 双进程重复抓取
  - 复用 fetch_feeds.main()，不重复抓取逻辑
"""

import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, send_from_directory

ROOT = Path(__file__).resolve().parent

# 把 scripts/ 加入 sys.path 以 import fetch_feeds
sys.path.insert(0, str(ROOT / "scripts"))
import fetch_feeds  # noqa: E402  (sys.path 修改在 import 前)

app = Flask(__name__, static_folder=None)


@app.route("/api/refresh")
def api_refresh():
    """复用 fetch_feeds.main() 抓取最新源写盘，返回条目摘要。

    前端页面加载时和"刷新数据"按钮都会调这里。
    fetch_one 单源失败返回 []（容错已在 fetch_feeds 里实现），不影响整体。
    """
    try:
        # main() 把抓取结果写入 OUT_NEWS / OUT_ENGINEERING 并打印进度到 stdout
        fetch_feeds.main()
        # 读回条数做摘要
        news_count = 0
        eng_news_count = 0
        try:
            with open(fetch_feeds.OUT_NEWS, "r", encoding="utf-8") as f:
                news_count = len(json.load(f))
        except Exception:
            pass
        try:
            with open(fetch_feeds.OUT_ENGINEERING, "r", encoding="utf-8") as f:
                eng_news_count = len(json.load(f).get("news", []))
        except Exception:
            pass
        return jsonify({
            "ok": True,
            "news_count": news_count,
            "eng_news_count": eng_news_count,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "ok": False,
            "error": str(e),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }), 500


@app.route("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.route("/<path:path>")
def static_files(path):
    """覆盖 assets/ 与 data/。send_from_directory 内置路径穿越防护。"""
    return send_from_directory(ROOT, path)


if __name__ == "__main__":
    print("=" * 50)
    print("RF Hub — 本地后端 + 静态服务")
    print(f"根目录：{ROOT}")
    print("端点：")
    print("  /                首页（index.html）")
    print("  /api/refresh     按需抓取（复用 fetch_feeds.main()）")
    print("  /assets/...      静态资源")
    print("  /data/...        抓取产出 JSON")
    print("=" * 50)
    app.run(host="127.0.0.1", port=8000, debug=False)
