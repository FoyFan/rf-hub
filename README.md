# RF Hub — 射频知识中枢（本地站）

汇总 RF 学术前沿知识 + arXiv 论文新闻 + 院校 RF 前沿研究组 + 工程实践（工业界 / EDA 工具 / 行业新闻）的本地仪表盘站点。
本地 Flask 单文件后端（静态服务 + 按需抓取 `/api/refresh`）+ Python 抓取脚本，无外部 API 调用，数据全部落地本地 JSON。
界面采用苹果官网风格（纯白浅色主题、大字号标题、胶囊按钮、毛玻璃顶栏、滚动渐显）。

## 目录结构

```
rf-hub/
├── index.html              # 仪表盘首页（4 板块 + KPI 概览 + Tab 导航）
├── server.py               # 本地 Flask 后端（静态服务 + /api/refresh 按需抓取）
├── requirements.txt        # Python 依赖（Flask / feedparser / requests）
├── assets/
│   ├── style.css           # 苹果风浅色主题（纯白底 + 柔和阴影 + SF 字体栈）
│   ├── app.js              # 渲染 + lunr.js 全文搜索（4 板块统一索引）
│   └── vendor/lunr.min.js  # lunr.js 本地化（断网可用）
├── data/
│   ├── knowledge.json      # RF 知识库（学术前沿主题，手填）
│   ├── news.json           # arXiv RSS 抓取产出（脚本生成，学术新闻）
│   ├── academia.json       # 院校 / 实验室（手填）
│   └── engineering.json    # 工程实践（topics/industry/tools 手填 + news 脚本抓取）
├── scripts/
│   └── fetch_feeds.py      # 抓取脚本（被 server.py 复用，亦可单独跑）
├── .venv/                  # 独立 Python 环境（含 Flask + feedparser + requests）
└── README.md
```

## 快速开始

### 1. 起本地后端（一个命令同时提供静态服务 + 按需抓取）

```bash
cd rf-hub
.venv/bin/python server.py
```

然后浏览器打开 **http://localhost:8000**

> 单文件 Flask 后端同时承担静态文件服务（`/`、`/assets/`、`/data/`）和按需抓取端点（`/api/refresh`）。页面加载时自动调 `/api/refresh` 抓最新源写入 `data/*.json`，前端再读盘渲染——打开即最新，无需手动跑抓取脚本。

> 不要直接双击 `index.html` 打开——`file://` 协议下浏览器会拒绝加载本地 JSON，页面会显示"加载失败"。

### 2. 手动抓取（可选，调试用）

页面加载已自动抓取。如需在终端单独跑抓取（看进度日志、调试源站）：

```bash
.venv/bin/python scripts/fetch_feeds.py
```

会执行三个步骤：
- `[1/3]` 抓 arXiv eess.SP / eess 全站 / physics.app-ph → 写入 `data/news.json`
- `[2/3]` 抓学校动态（`ACADEMIA_FEEDS`，默认空，跳过）→ 写入 `data/academia_feed.json`
- `[3/3]` 抓 IEEE Spectrum / EDN → 写入 `data/engineering.json` 的 `news` 字段（保留手填的 topics/industry/tools）

脚本容错：单个源失败自动跳过，不影响其他源；engineering 抓取失败也不会覆盖手填数据。

### 3. 刷新新闻

任何时候点网页顶栏"刷新数据"按钮，前端会调 `/api/refresh` 触发后端抓取最新源，再读盘渲染。

## 四个板块说明

| 板块 | 数据来源 | 更新方式 |
|------|----------|----------|
| 知识库 | `data/knowledge.json`（手填） | 手动编辑 JSON |
| 新闻要点 | arXiv RSS 抓取（`FEEDS`） | 跑 `fetch_feeds.py` |
| 学校前沿 | `data/academia.json`（手填） | 手动编辑 JSON |
| 工程实践 | `data/engineering.json`（topics/industry/tools 手填 + news 脚本抓取） | 部分 `fetch_feeds.py`，部分手填 |

### 工程实践板块（4 个子分区）

`#panelEngineering` 内含 4 个子分区，渲染目标 grid 与数据来源：

| 子分区 | 渲染目标 | 数据字段 | 更新方式 |
|--------|----------|----------|----------|
| 工程知识卡 | `#gridEngTopics` | `engineering.topics[]` | 手填 |
| 工业界实验室 | `#gridEngIndustry` | `engineering.industry[]` | 手填 |
| EDA 工具与教程 | `#gridEngTools` | `engineering.tools[]` | 手填 |
| 行业新闻 | `#gridEngNews` | `engineering.news[]` | `fetch_feeds.py` 抓取 |

### 4 张 KPI 概览卡

顶栏下方的 `.kpi-row` 展示 4 个统计数字：
- **知识库主题** → `knowledge.length`
- **工程实践** → `engineering.topics + industry + tools` 的总数
- **新闻要点** → `news.length` + 最新抓取时间
- **院校 / 实验室** → `academia.length`

### engineering.json 数据结构

```json
{
  "topics": [
    { "title": "...", "tags": ["..."], "desc": "...",
      "metrics": [{"k": "...", "v": "..."}], "tools": "...", "keyPeople": "..." }
  ],
  "industry": [
    { "company": "...", "lab": "...", "focus": "...",
      "tags": ["..."], "link": "..." }
  ],
  "tools": [
    { "name": "...", "category": "...", "use": "...",
      "tags": ["..."], "link": "..." }
  ],
  "news": [
    { "title": "...", "source": "...", "snippet": "...",
      "published": "ISO8601", "authors": "...", "link": "...", "category": "..." }
  ]
}
```

## 搜索

顶栏搜索框支持按标题 / 标签 / 来源 / 摘要全文检索，使用 lunr.js 在浏览器本地构建索引（覆盖全部 4 板块）。
中文查询走包含匹配兜底（lunr 默认对中文支持弱）。点搜索结果跳转到对应卡片并高亮。

### data-id 与搜索回填

每张卡片的 `data-id` 属性必须与 lunr 索引里的 `ref` 一致，搜索结果点击后才能 `querySelector([data-id="..."])` 找到并滚动到目标卡：

| 数据集 | id 模式 | 例 |
|--------|---------|------|
| knowledge | `knowledge-${i}` | `knowledge-0` |
| news | `news-${i}` | `news-3` |
| academia | `academia-${i}` | `academia-1` |
| engineering.topics | `engineering-topics-${i}` | `engineering-topics-0` |
| engineering.industry | `engineering-industry-${i}` | `engineering-industry-2` |
| engineering.tools | `engineering-tools-${i}` | `engineering-tools-5` |
| engineering.news | `engineering-news-${i}` | `engineering-news-7` |

工程板块用 `${type}-${sub}-${i}` 三段式确保 4 个子分区之间 id 不冲突。`app.js` 的 `buildIndex()` 接受 `sub` 参数生成对应 id，`renderEngineering()` 用同样的模式生成 `data-id`，搜索回填的 `querySelector` 因此能匹配全部 7 类卡片。

## 扩展指南

### 增加新的学术 RSS 源（→ news.json）

编辑 `scripts/fetch_feeds.py` 顶部的 `FEEDS` 列表：

```python
FEEDS = [
    ("arXiv eess.SP", "http://export.arxiv.org/rss/eess.SP", "信号处理 / 通信物理层"),
    ("arXiv eess 全站", "http://export.arxiv.org/rss/eess", "电子学 / RFIC / 天线"),
    # 新增：
    ("新源名", "https://example.com/rss", "分类标签"),
]
```

抓到的条目合并写入 `data/news.json`，字段：`title / source / snippet / published / authors / link / category`。

### 增加工程 / 行业 RSS 源（→ engineering.json 的 news 字段）

编辑 `ENG_FEEDS` 列表：

```python
ENG_FEEDS = [
    ("IEEE Spectrum", "https://spectrum.ieee.org/rss", "IEEE 综合新闻"),
    ("EDN", "https://www.edn.com/feed", "EDN 电子设计新闻"),
    # 新增：
    ("新源名", "https://example.com/feed", "分类标签"),
]
```

注：URL 已实测可解析（2026-10）。原 5 个候选源（IEEE Spectrum 的 `/feeds/topic/radio.xml` 与 `/electronics.xml`、Microwave Journal、Microwaves & RF、RF Journal）均失效（404 / 403 / DNS / SSL），已替换为上述 2 个稳定源。如某源再次失效，`fetch_one()` 的 try/except 会自动跳过，不影响其他源，也不会覆盖 `engineering.json` 里手填的 topics/industry/tools。

抓到的条目合并写入 `data/engineering.json` 的 `news` 字段，不与学术 `news.json` 混。
脚本读取既有 `engineering.json`、保留 topics/industry/tools、只替换 news 字段后写回。

### 增加学校动态

`ACADEMIA_FEEDS` 列表里追加三元组 `(展示名, RSS URL, 院校名)`。默认空数组——学校官网大多无 RSS。
若学校官网没有 RSS，最实用的做法是手动维护 `data/academia.json`——已在文件里放了 8 个标杆条目作模板，照格式加即可。

### 增加 / 修改工程知识卡 / 实验室 / 工具

编辑 `data/engineering.json` 的对应数组：

```jsonc
// topics（工程知识卡，同 knowledge 卡结构）
{ "title": "...", "tags": ["..."], "desc": "...",
  "metrics": [{"k": "...", "v": "..."}], "tools": "...", "keyPeople": "..." }

// industry（工业界实验室）
{ "company": "...", "lab": "...", "focus": "...",
  "tags": ["..."], "link": "..." }

// tools（EDA 工具与教程）
{ "name": "...", "category": "...", "use": "...",
  "tags": ["..."], "link": "..." }
```

### 增加 / 修改知识库主题

编辑 `data/knowledge.json`，每条主题字段：

```json
{
  "title": "主题名",
  "tags": ["标签1", "标签2"],
  "desc": "一句话概述",
  "metrics": [{"k": "指标名", "v": "典型值"}],
  "tools": "仿真工具",
  "keyPeople": "代表人物"
}
```

## 已知约束（如实说明）

- **IEEE Xplore 没有公开 RSS**，需机构授权的 IEEE API，本脚本不抓。IEEE Spectrum 的网页 RSS（`/rss`）可用，已纳入 `ENG_FEEDS`。
- **arXiv `eess.EE` 无独立 RSS**（已合并到 eess 全站），脚本用 `eess` 全站 + `physics.app-ph` 替代覆盖。
- **学校官网大多无 RSS**，且页面结构各异，长期维护成本高，故 academia 板块以手填为主。
- **Microwave Journal / Microwaves & RF / RF Journal 等行业源 RSS 不稳定**（403 / SSL 证书域名不匹配 / 域名不解析），已剔除。如发现稳定源可加进 `ENG_FEEDS`。
- **arXiv RSS 不含全文 PDF**，只取摘要 + 链接，点标题跳 arXiv 详情页。
- 抓取不做定时任务，手动跑——避免后台常驻进程。

## 环境说明

- Python 3.14（系统自带）
- 依赖：`Flask`、`feedparser`、`requests`，已装在 `.venv`，不污染系统 Python（避开 macOS PEP 668）
  - 安装：`.venv/bin/pip install -r requirements.txt`
- 前端依赖：仅 `lunr.js`（已本地化到 `assets/vendor/lunr.min.js`，断网可用）

## 常见问题

**Q: 打开页面显示"加载失败"**
A: 后端没起。跑 `.venv/bin/python server.py`，然后浏览器开 `http://localhost:8000`。不要用 `file://` 直接打开 index.html。

**Q: 打开页面显示"后端不可达：…（加载缓存数据…）"**
A: `server.py` 没跑或已退出。起服务后刷新页面即可。前端会回退到上次抓取的缓存 JSON，不会白屏。

**Q: 抓取脚本报 `ConnectionError`**
A: 网络问题或源站限流。脚本已加 1 秒礼貌延迟。隔几分钟重试。单个源失败不影响其他源。

**Q: 搜索中文无结果**
A: lunr 对中文支持弱，已加包含匹配兜底。如果还是没结果，说明 JSON 里确实没那个词——检查 `data/*.json` 内容。

**Q: `engineering.json` 的 news 字段空了**
A: 两个 `ENG_FEEDS` 源都抓失败（网络或源站下线）。脚本会写 `news: []` 但保留 topics/industry/tools。检查网络后重跑 `fetch_feeds.py` 或点"刷新数据"按钮。若源永久失效，找替代 RSS 加进 `ENG_FEEDS`。

**Q: 想加自动定时刷新**
A: 用 cron 或 launchd 跑 `fetch_feeds.py`，或直接 cron 调 `curl http://localhost:8000/api/refresh`。但本设计有意不内置定时，避免后台常驻。
