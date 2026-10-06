/* ============================================================
   RF Hub — 渲染 + lunr.js 全文搜索
   数据源：data/knowledge.json, data/news.json, data/academia.json
   全部本地加载，无外部 API 调用
   ============================================================ */

const DATA_FILES = {
  knowledge: 'data/knowledge.json',
  news: 'data/news.json',
  academia: 'data/academia.json',
  engineering: 'data/engineering.json',
};

const STATE = {
  knowledge: [],
  news: [],
  academia: [],
  engineering: { topics: [], industry: [], tools: [], news: [] },
  index: null,        // lunr 索引
  docMap: new Map(),  // id → 原文档（搜索结果回填用）
  activeTab: 'knowledge',
};

// ---------- 工具 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// D1: SF Symbols 风线条图标 sprite 引用（替换全部 emoji）
const ICONS = {
  wrench: 'icon-wrench', people: 'icon-people', calendar: 'icon-calendar',
  pen: 'icon-pen', book: 'icon-book', newspaper: 'icon-newspaper',
  graduation: 'icon-graduation', factory: 'icon-factory', ruler: 'icon-ruler',
  search: 'icon-search', refresh: 'icon-refresh', close: 'icon-close',
  satellite: 'icon-satellite',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}"><use href="assets/icons.svg#${ICONS[name] || 'icon-search'}"/></svg>`;

// D3: 新闻来源 → 品牌色映射（顶部 3px 色条 + 着色 source-chip）
const SOURCE_COLORS = {
  'arXiv': '#b31b1b', 'IEEE Spectrum': '#00629b', 'EDN': '#e8772e',
};
const sourceColor = (src) => {
  if (!src) return '#0071e3';
  if (SOURCE_COLORS[src]) return SOURCE_COLORS[src];
  // arXiv 子串匹配（eess.SP / eess / physics.app-ph 等都算 arXiv 系）
  if (/arxiv/i.test(src)) return SOURCE_COLORS['arXiv'];
  if (/ieee/i.test(src)) return SOURCE_COLORS['IEEE Spectrum'];
  if (/edn/i.test(src)) return SOURCE_COLORS['EDN'];
  return '#0071e3';
};

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  // 相对时间
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ---------- 后端按需抓取 ----------
// 本地 Flask 部署：调 /api/refresh 实时抓取写盘。
// GitHub Pages 静态托管：端点不存在，返回 {ok:false, static:true} 静默降级，
// 调用方据此提示"数据由 Actions 每小时更新"，不报红字错误。
async function refreshFromBackend() {
  try {
    const r = await fetch('/api/refresh', { cache: 'no-store' });
    if (!r.ok) return { ok: false, static: true };
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return { ok: false, static: true };
    return r.json();
  } catch {
    // fetch 抛错（Pages 上 /api/refresh 返回 index.html HTML，或网络断）
    return { ok: false, static: true };
  }
}

// D2: 骨架屏注入（8s 抓取期占位，真数据来时 innerHTML 自然擦掉）
const showSkeletons = () => {
  ['gridKnowledge', 'gridNews', 'gridAcademia',
   'gridEngTopics', 'gridEngIndustry', 'gridEngTools', 'gridEngNews'].forEach(id => {
    const g = document.getElementById(id);
    if (g) g.innerHTML = Array.from({ length: 6 }).map(() =>
      '<div class="skeleton-card"><div class="sk-line w40"></div><div class="sk-line w80"></div><div class="sk-line w60"></div></div>'
    ).join('');
  });
};

// ---------- 加载数据 ----------
async function loadAll() {
  showSkeletons();  // D2: 抓取期立即显骨架，避免空网格

  const results = await Promise.allSettled(
    Object.entries(DATA_FILES).map(([k, path]) =>
      fetch(path).then(r => {
        if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
        return r.json();
      }).then(json => [k, json])
    )
  );

  const errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const [key, json] = r.value;
      if (key === 'engineering') {
        // engineering.json 是对象，含 topics/industry/tools/news 四个子数组
        STATE.engineering = {
          topics: json.topics || [],
          industry: json.industry || [],
          tools: json.tools || [],
          news: json.news || [],
        };
      } else {
        STATE[key] = Array.isArray(json) ? json : (json.items || []);
      }
    } else {
      errors.push(r.reason.message);
    }
  }

  // 状态条
  const sb = $('#statusBar');
  const st = $('#statusText');
  const sm = $('#statusMeta');
  if (errors.length) {
    sb.classList.add('err');
    st.textContent = `部分数据加载失败：${errors.join('; ')}`;
  } else {
    st.textContent = '全部数据已本地加载';
  }
  const newsLatest = STATE.news[0]?.published || STATE.news[0]?.date;
  sm.textContent = newsLatest ? `新闻最新：${fmtDate(newsLatest)}` : '';

  // KPI
  const engTotal = STATE.engineering.topics.length
    + STATE.engineering.industry.length
    + STATE.engineering.tools.length;
  $('#kpiKnowledge').textContent = STATE.knowledge.length;
  $('#kpiNews').textContent = STATE.news.length;
  $('#kpiAcademia').textContent = STATE.academia.length;
  $('#kpiEngineering').textContent = engTotal;
  $('#kpiNewsSub').textContent = newsLatest ? `最新抓取：${fmtDate(newsLatest)}` : '最新抓取：—';

  // Tab 计数
  $('#tabCountKnowledge').textContent = STATE.knowledge.length;
  $('#tabCountNews').textContent = STATE.news.length;
  $('#tabCountAcademia').textContent = STATE.academia.length;
  $('#tabCountEngineering').textContent = engTotal + STATE.engineering.news.length;

  buildIndex();
  renderAll();
}

// ---------- 构建 lunr 索引 ----------
function buildIndex() {
  const docs = [];
  const push = (arr, type, sub) => arr.forEach((it, i) => {
    // id 形如 "knowledge-0" / "engineering-topics-0" / "engineering-tools-0"
    const id = sub ? `${type}-${sub}-${i}` : `${type}-${i}`;
    const doc = {
      id,
      type,
      title: it.title || it.name || '(无标题)',
      snippet: it.snippet || it.desc || it.abstract || it.focus || '',
      tags: (it.tags || []).join(' '),
      source: it.source || it.uni || it.company || it.lab || '',
      _ref: it,
    };
    STATE.docMap.set(id, doc);
    docs.push(doc);
  });
  push(STATE.knowledge, 'knowledge');
  push(STATE.news, 'news');
  push(STATE.academia, 'academia');
  push(STATE.engineering.topics, 'engineering', 'topics');
  push(STATE.engineering.industry, 'engineering', 'industry');
  push(STATE.engineering.tools, 'engineering', 'tools');
  push(STATE.engineering.news, 'engineering', 'news');

  try {
    STATE.index = lunr(function () {
      this.ref('id');
      this.field('title', { boost: 3 });
      this.field('tags', { boost: 2 });
      this.field('source', { boost: 2 });
      this.field('snippet');
      docs.forEach(d => this.add(d));
    });
  } catch (e) {
    console.error('lunr 索引构建失败', e);
  }
}

// ---------- 渲染 ----------
function renderAll() {
  renderKnowledge();
  renderNews();
  renderAcademia();
  renderEngineering();
}

// D3: 第一张卡 card--feature；emoji → icon()
function renderKnowledge() {
  const grid = $('#gridKnowledge');
  if (!STATE.knowledge.length) {
    grid.innerHTML = emptyState('book', '知识库为空');
    return;
  }
  grid.innerHTML = STATE.knowledge.map((k, i) => `
    <article class="card knowledge-card ${i === 0 ? 'card--feature' : ''}" data-id="knowledge-${i}">
      <div class="tags">
        ${(k.tags || []).map((t, j) => `<span class="tag-chip ${j === 0 ? 'accent' : ''}">${escapeHtml(t)}</span>`).join('')}
      </div>
      <h3>${escapeHtml(k.title)}</h3>
      <div class="desc">${escapeHtml(k.desc || '')}</div>
      ${k.metrics ? `
        <ul class="metrics">
          ${(k.metrics || []).map(m => `<li><b>${escapeHtml(m.k)}</b>: ${escapeHtml(m.v)}</li>`).join('')}
        </ul>` : ''}
      <div class="meta-row">
        ${k.tools ? `<span>${icon('wrench')} ${escapeHtml(k.tools)}</span>` : ''}
        ${k.keyPeople ? `<span>${icon('people')} ${escapeHtml(k.keyPeople)}</span>` : ''}
      </div>
    </article>
  `).join('');
}

// D3: source-chip + --source-color 内联 + 第一张卡 card--feature
function renderNews() {
  const grid = $('#gridNews');
  if (!STATE.news.length) {
    grid.innerHTML = emptyState('newspaper', '暂无新闻。点右上"刷新数据"抓取最新源。');
    return;
  }
  grid.innerHTML = STATE.news.map((n, i) => `
    <article class="card news-card ${i === 0 ? 'card--feature' : ''}" data-id="news-${i}" style="--source-color:${sourceColor(n.source)}">
      <span class="source-chip">${icon('newspaper')}${escapeHtml(n.source || '来源')}</span>
      <h3>${n.link ? `<a href="${escapeHtml(n.link)}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>` : escapeHtml(n.title)}</h3>
      <div class="desc">${escapeHtml(n.snippet || n.abstract || '')}</div>
      <div class="meta-row">
        <span class="date">${icon('calendar')} ${escapeHtml(fmtDate(n.published || n.date))}</span>
        ${n.authors ? `<span>${icon('pen')} ${escapeHtml(n.authors)}</span>` : ''}
      </div>
    </article>
  `).join('');
}

// D3: 第一张卡 card--feature（无现有 emoji）
function renderAcademia() {
  const grid = $('#gridAcademia');
  if (!STATE.academia.length) {
    grid.innerHTML = emptyState('graduation', '院校数据为空');
    return;
  }
  grid.innerHTML = STATE.academia.map((a, i) => `
    <article class="card uni-card ${i === 0 ? 'card--feature' : ''}" data-id="academia-${i}">
      <div class="uni-name">${a.link ? `<a href="${escapeHtml(a.link)}" target="_blank" rel="noopener">${escapeHtml(a.uni)}</a>` : escapeHtml(a.uni)}</div>
      <div class="lab">${escapeHtml(a.lab)}</div>
      <div class="focus">${escapeHtml(a.focus || '')}</div>
      <div class="tags">
        ${(a.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}
      </div>
    </article>
  `).join('');
}

// D3: 签名改为 iconName，内部用 icon(iconName,'ic-lg')
function emptyState(iconName, msg) {
  return `<div class="empty" style="grid-column:1/-1"><div class="big">${icon(iconName, 'ic-lg')}</div><div>${escapeHtml(msg)}</div></div>`;
}

// D4: 工程子导航（sticky pill nav + scroll-spy）
const ENG_SUBS = [
  { id: 'eng-topics', label: '工程知识卡' },
  { id: 'eng-industry', label: '工业界实验室' },
  { id: 'eng-tools', label: 'EDA 工具与教程' },
  { id: 'eng-news', label: '行业新闻' },
];
let _engScrollSpy = null;  // idempotent cache
function renderEngSubnav() {
  let nav = $('#engSubnav');
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'engSubnav';
    nav.className = 'eng-subnav';
    // 插到工程面板第一个子分区前
    const firstSub = $('#eng-topics');
    if (firstSub) firstSub.parentNode.insertBefore(nav, firstSub);
  }
  nav.innerHTML = ENG_SUBS.map(s => `<a href="#${s.id}" data-target="${s.id}">${escapeHtml(s.label)}</a>`).join('');
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    const t = document.getElementById(a.dataset.target);
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}
function initEngScrollSpy() {
  if (_engScrollSpy) return;  // idempotent
  const nav = $('#engSubnav');
  if (!nav) return;
  const links = [...nav.querySelectorAll('a')];
  const targets = ENG_SUBS.map(s => document.getElementById(s.id)).filter(Boolean);
  if (!targets.length) return;
  _engScrollSpy = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const id = e.target.id;
        links.forEach(l => l.classList.toggle('active', l.dataset.target === id));
      }
    });
  }, { threshold: 0.5, rootMargin: '-64px 0px -60% 0px' });
  targets.forEach(t => _engScrollSpy.observe(t));
}

// ---------- 工程实践板块（4 个子分区） ----------
function renderEngineering() {
  const eng = STATE.engineering;

  // D4: 子导航（只在工程面板渲染时注入）
  renderEngSubnav();

  // 1) 工程知识卡（同 knowledge 卡：标题/标签/desc/metrics/tools/keyPeople）
  const gridT = $('#gridEngTopics');
  if (!eng.topics.length) {
    gridT.innerHTML = emptyState('wrench', '工程知识卡为空');
  } else {
    gridT.innerHTML = eng.topics.map((k, i) => `
      <article class="card knowledge-card ${i === 0 ? 'card--feature' : ''}" data-id="engineering-topics-${i}">
        <div class="tags">
          ${(k.tags || []).map((t, j) => `<span class="tag-chip ${j === 0 ? 'accent' : ''}">${escapeHtml(t)}</span>`).join('')}
        </div>
        <h3>${escapeHtml(k.title)}</h3>
        <div class="desc">${escapeHtml(k.desc || '')}</div>
        ${k.metrics ? `
          <ul class="metrics">
            ${(k.metrics || []).map(m => `<li><b>${escapeHtml(m.k)}</b>: ${escapeHtml(m.v)}</li>`).join('')}
          </ul>` : ''}
        <div class="meta-row">
          ${k.tools ? `<span>${icon('wrench')} ${escapeHtml(k.tools)}</span>` : ''}
          ${k.keyPeople ? `<span>${icon('people')} ${escapeHtml(k.keyPeople)}</span>` : ''}
        </div>
      </article>
    `).join('');
  }

  // 2) 工业界实验室（同 uni-card：company/lab/focus/tags/link）
  const gridI = $('#gridEngIndustry');
  if (!eng.industry.length) {
    gridI.innerHTML = emptyState('factory', '工业界实验室为空');
  } else {
    gridI.innerHTML = eng.industry.map((c, i) => `
      <article class="card uni-card ${i === 0 ? 'card--feature' : ''}" data-id="engineering-industry-${i}">
        <div class="uni-name">${c.link ? `<a href="${escapeHtml(c.link)}" target="_blank" rel="noopener">${escapeHtml(c.company)}</a>` : escapeHtml(c.company)}</div>
        <div class="lab">${escapeHtml(c.lab || '')}</div>
        <div class="focus">${escapeHtml(c.focus || '')}</div>
        <div class="tags">
          ${(c.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}
        </div>
      </article>
    `).join('');
  }

  // 3) EDA 工具与教程（name/category/use/tags/link）
  const gridG = $('#gridEngTools');
  if (!eng.tools.length) {
    gridG.innerHTML = emptyState('ruler', '工具数据为空');
  } else {
    gridG.innerHTML = eng.tools.map((t, i) => `
      <article class="card ${i === 0 ? 'card--feature' : ''}" data-id="engineering-tools-${i}">
        <div class="tags">
          ${(t.tags || []).map((tg, j) => `<span class="tag-chip ${j === 0 ? 'accent' : ''}">${escapeHtml(tg)}</span>`).join('')}
        </div>
        <h3>${t.link ? `<a href="${escapeHtml(t.link)}" target="_blank" rel="noopener">${escapeHtml(t.name)}</a>` : escapeHtml(t.name)}</h3>
        <div class="desc"><b style="color:var(--text)">${escapeHtml(t.category || '')}</b> — ${escapeHtml(t.use || '')}</div>
      </article>
    `).join('');
  }

  // 4) 行业新闻（同 news-card，含 source-chip + --source-color）
  const gridN = $('#gridEngNews');
  if (!eng.news.length) {
    gridN.innerHTML = emptyState('newspaper', '暂无工程新闻。运行 fetch_feeds.py 抓取 IEEE / Microwave Journal 等源。');
  } else {
    gridN.innerHTML = eng.news.map((n, i) => `
      <article class="card news-card ${i === 0 ? 'card--feature' : ''}" data-id="engineering-news-${i}" style="--source-color:${sourceColor(n.source)}">
        <span class="source-chip">${icon('newspaper')}${escapeHtml(n.source || '来源')}</span>
        <h3>${n.link ? `<a href="${escapeHtml(n.link)}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>` : escapeHtml(n.title)}</h3>
        <div class="desc">${escapeHtml(n.snippet || n.abstract || '')}</div>
        <div class="meta-row">
          <span class="date">${icon('calendar')} ${escapeHtml(fmtDate(n.published || n.date))}</span>
        </div>
      </article>
    `).join('');
  }
}

// ---------- 搜索 ----------
function runSearch(q) {
  const sr = $('#searchResults');
  const body = $('#srBody');
  const head = $('#srHead');

  if (!q || !q.trim()) {
    sr.classList.remove('shown');
    return;
  }
  if (!STATE.index) {
    head.textContent = '索引未就绪';
    sr.classList.add('shown');
    body.innerHTML = '';
    return;
  }

  let results = [];
  try {
    // lunr 默认对中文支持弱，做兜底：先 lunr 模糊匹配，无结果时再做包含搜索
    results = STATE.index.search(q);
    if (!results.length) {
      const lower = q.toLowerCase();
      STATE.docMap.forEach((doc, id) => {
        const hay = (doc.title + ' ' + doc.snippet + ' ' + doc.tags + ' ' + doc.source).toLowerCase();
        if (hay.includes(lower)) results.push({ ref: id, score: 0.1 });
      });
    }
  } catch (e) {
    // 查询语法错误时退化为包含搜索
    const lower = q.toLowerCase();
    STATE.docMap.forEach((doc, id) => {
      const hay = (doc.title + ' ' + doc.snippet + ' ' + doc.tags).toLowerCase();
      if (hay.includes(lower)) results.push({ ref: id, score: 0.1 });
    });
  }

  head.textContent = `找到 ${results.length} 条结果 · "${q}"`;
  if (!results.length) {
    body.innerHTML = `<div class="empty"><div class="big">${icon('search', 'ic-lg')}</div><div>无匹配结果</div></div>`;
  } else {
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    body.innerHTML = results.slice(0, 30).map(r => {
      const doc = STATE.docMap.get(r.ref);
      if (!doc) return '';
      const title = escapeHtml(doc.title).replace(re, '<mark>$1</mark>');
      const snip = escapeHtml(doc.snippet.slice(0, 140)).replace(re, '<mark>$1</mark>');
      return `
        <div class="sr-item" data-ref="${r.ref}">
          <div class="sr-title">${title} <span class="tag-chip" style="margin-left:6px">${doc.type}</span></div>
          <div class="sr-snippet">${snip}…</div>
        </div>`;
    }).join('');
  }
  sr.classList.add('shown');
}

// ---------- Tab 切换 ----------
function switchTab(name) {
  STATE.activeTab = name;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel' + name[0].toUpperCase() + name.slice(1)));
  // D5: 进工程面板时确保 scroll-spy 已初始化
  if (name === 'engineering') initEngScrollSpy();
}

// ---------- 刷新按钮（调 /api/refresh 后端抓取，再 loadAll 读盘） ----------
function onRefresh() {
  const icon = $('#refreshIcon');
  const st = $('#statusText');
  const sb = $('#statusBar');
  icon.classList.add('spin');
  sb.classList.remove('err');
  st.textContent = '正在抓取最新源…';

  refreshFromBackend()
    .then(summary => {
      if (summary.ok) {
        st.textContent = `抓取完成：学术 ${summary.news_count} 条 / 工程 ${summary.eng_news_count} 条`;
      } else if (summary.static) {
        // GitHub Pages 静态托管：无 /api/refresh，数据由 Actions 每小时更新
        st.textContent = '静态站点：数据由 GitHub Actions 每小时自动刷新';
      } else {
        sb.classList.add('err');
        st.textContent = `抓取失败：${summary.error || '未知错误'}`;
      }
    })
    .catch(err => {
      sb.classList.add('err');
      st.textContent = `后端不可达：${err.message}（加载缓存数据…）`;
    })
    .finally(() => loadAll().then(() => icon.classList.remove('spin')));
}

// D6: 滚动渐显（IntersectionObserver 触发 .fade-in .in-view）
const observeFadeIn = () => {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.hero, .section-head, .kpi-row, .subsection-head, .grid').forEach(el => {
    el.classList.add('fade-in');
    io.observe(el);
  });
};

// D7: Hero 视差（subtle，rAF 节流，prefers-reduced-motion 禁用）
const initHeroParallax = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const h1 = document.querySelector('.hero h1');
  if (!h1) return;
  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    if (y < 400) h1.style.transform = `translateY(${y * 0.15}px)`;
    else h1.style.transform = '';
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
};

// ---------- 事件绑定 ----------
document.addEventListener('DOMContentLoaded', () => {
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  const si = $('#searchInput');
  const sc = $('#searchClear');
  let debounce;
  si.addEventListener('input', () => {
    sc.style.display = si.value ? 'block' : 'none';
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(si.value.trim()), 180);
  });
  sc.addEventListener('click', () => {
    si.value = '';
    sc.style.display = 'none';
    runSearch('');
    si.focus();
  });

  // 点击搜索结果跳到对应 Tab 并滚动
  $('#srBody').addEventListener('click', (e) => {
    const item = e.target.closest('.sr-item');
    if (!item) return;
    const doc = STATE.docMap.get(item.dataset.ref);
    if (!doc) return;
    switchTab(doc.type);
    const el = document.querySelector(`[data-id="${doc.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'box-shadow 0.3s, border-color 0.3s';
      el.style.boxShadow = '0 0 0 2px var(--accent)';
      el.style.borderColor = 'var(--accent)';
      setTimeout(() => { el.style.boxShadow = ''; el.style.borderColor = ''; }, 1600);
    }
    $('#searchResults').classList.remove('shown');
  });

  $('#refreshBtn').addEventListener('click', onRefresh);

  // D6 + D7: 滚动渐显 + Hero 视差
  observeFadeIn();
  initHeroParallax();

  // 页面加载时 refresh-first：先调 /api/refresh 抓最新源，再 loadAll() 读盘
  // GitHub Pages 静态托管时降级为读静态 JSON（已由 Actions 抓取落盘）
  const icon = $('#refreshIcon');
  const st = $('#statusText');
  const sb = $('#statusBar');
  icon.classList.add('spin');
  st.textContent = '正在抓取最新源…';

  refreshFromBackend()
    .then(summary => {
      if (summary.ok) {
        st.textContent = `抓取完成：学术 ${summary.news_count} 条 / 工程 ${summary.eng_news_count} 条`;
      } else if (summary.static) {
        // 静态站点：数据由 Actions 每小时更新，loadAll 直接读静态 JSON
        st.textContent = '加载中…（站点数据由 GitHub Actions 每小时刷新）';
        sb.classList.remove('err');
      } else {
        sb.classList.add('err');
        st.textContent = `抓取失败：${summary.error || '未知错误'}（加载缓存数据…）`;
      }
    })
    .catch(err => {
      sb.classList.add('err');
      st.textContent = `后端不可达：${err.message}（加载缓存数据…）`;
    })
    .finally(() => {
      loadAll().finally(() => icon.classList.remove('spin'));
    });
});
