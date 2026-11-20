(() => {
  const state = {
    manifest: null,
    docsCache: new Map(),
    currentRoute: '',
    theme: localStorage.getItem('tech-kb-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  };

  const els = {
    siteTitle: document.getElementById('site-title'),
    siteSubtitle: document.getElementById('site-subtitle'),
    sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebar-backdrop'),
    sidebarNav: document.getElementById('sidebar-nav'),
    sidebarStats: document.getElementById('sidebar-stats'),
    docContainer: document.getElementById('doc-container'),
    tocAside: document.getElementById('toc-aside'),
    tocNav: document.getElementById('toc-nav'),
    themeToggle: document.getElementById('theme-toggle'),
    menuToggle: document.getElementById('menu-toggle'),
    searchTrigger: document.getElementById('search-trigger'),
    mobileSearchBtn: document.getElementById('mobile-search-btn'),
    searchModal: document.getElementById('search-modal'),
    searchInput: document.getElementById('search-input'),
    searchResults: document.getElementById('search-results'),
    lightbox: document.getElementById('lightbox'),
    lightboxBody: document.getElementById('lightbox-body'),
    lightboxCaption: document.getElementById('lightbox-caption'),
    lightboxClose: document.getElementById('lightbox-close'),
    lightboxZoomIn: document.getElementById('lightbox-zoom-in'),
    lightboxZoomOut: document.getElementById('lightbox-zoom-out'),
    lightboxZoomReset: document.getElementById('lightbox-zoom-reset'),
    lightboxZoomLabel: document.getElementById('lightbox-zoom-label'),
    hljsLight: document.getElementById('hljs-theme-light'),
    hljsDark: document.getElementById('hljs-theme-dark'),
  };

  const lbState = {
    zoom: 1,
    baseWidth: 800,
    baseHeight: 600,
    targetEl: null,
  };

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('tech-kb-theme', theme);
    if (els.hljsLight && els.hljsDark) {
      els.hljsLight.disabled = theme === 'dark';
      els.hljsDark.disabled = theme !== 'dark';
    }
    if (window.mermaid) {
      const isDark = theme === 'dark';
      window.mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'base' : 'default',
        themeVariables: isDark
          ? {
              darkMode: true,
              background: '#151821',
              primaryColor: '#1e293b',
              primaryTextColor: '#f1f5f9',
              primaryBorderColor: '#60a5fa',
              lineColor: '#94a3b8',
              secondaryColor: '#1e2436',
              tertiaryColor: '#1a2030',
              textColor: '#f1f5f9',
              nodeTextColor: '#f1f5f9',
              edgeLabelBackground: '#151821',
              clusterBkg: '#161b26',
              clusterBorder: '#334155',
            }
          : undefined,
        securityLevel: 'loose',
        flowchart: { curve: 'basis' },
      });
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusLabel(status) {
    if (status === 'done') return '已体系化';
    if (status === 'active') return '持续更新';
    return '框架 / 梳理中';
  }

  async function loadManifest() {
    const res = await fetch('./content/manifest.json?t=' + Date.now());
    if (!res.ok) throw new Error('无法加载 manifest.json');
    state.manifest = await res.json();
    if (state.manifest.site?.title) {
      els.siteTitle.textContent = state.manifest.site.title;
    }
    if (state.manifest.site?.subtitle) {
      els.siteSubtitle.textContent = state.manifest.site.subtitle;
    }
    renderSidebar();
  }

  function flattenDocs(docs, parent = null) {
    const out = [];
    for (const doc of docs || []) {
      out.push({ doc, parent });
      if (doc.children && doc.children.length) {
        out.push(...flattenDocs(doc.children, doc));
      }
    }
    return out;
  }

  function getAllDocs() {
    const list = [];
    for (const proj of state.manifest.projects || []) {
      for (const { doc, parent } of flattenDocs(proj.docs || [])) {
        list.push({ project: proj, doc, parent });
      }
    }
    return list;
  }

  function renderNavItems(projId, docs, activeRoute, isSub = false) {
    return (docs || []).map((doc) => {
      const docRoute = `${projId}/${doc.slug}`;
      const active = activeRoute === docRoute ? 'active' : '';
      const hasChildren = Array.isArray(doc.children) && doc.children.length > 0;
      if (!hasChildren) {
        if (isSub) {
          return `
            <li>
              <a class="nav-doc-link ${active}" href="#/${escapeHtml(docRoute)}">
                <span>${escapeHtml(doc.title)}</span>
                <span class="status-dot ${escapeHtml(doc.status || 'draft')}" title="${statusLabel(doc.status)}"></span>
              </a>
            </li>
          `;
        }
        return `
          <li class="nav-doc-item">
            <div class="nav-doc-row">
              <span class="nav-toggle-spacer" aria-hidden="true"></span>
              <a class="nav-doc-link ${active}" href="#/${escapeHtml(docRoute)}">
                <span>${escapeHtml(doc.title)}</span>
                <span class="status-dot ${escapeHtml(doc.status || 'draft')}" title="${statusLabel(doc.status)}"></span>
              </a>
            </div>
          </li>
        `;
      }
      return `
        <li class="nav-doc-item">
          <div class="nav-doc-row">
            <button class="nav-sub-toggle" type="button" aria-label="展开或折叠子页面">
              <svg class="nav-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <a class="nav-doc-link ${active}" href="#/${escapeHtml(docRoute)}">
              <span>${escapeHtml(doc.title)}</span>
              <span class="status-dot ${escapeHtml(doc.status || 'draft')}" title="${statusLabel(doc.status)}"></span>
            </a>
          </div>
          <ul class="nav-sub-list">
            ${renderNavItems(projId, doc.children, activeRoute, true)}
          </ul>
        </li>
      `;
    }).join('');
  }

  function renderSidebar() {
    const projects = state.manifest.projects || [];
    const totalDocs = projects.reduce((sum, p) => sum + flattenDocs(p.docs || []).length, 0);
    els.sidebarStats.textContent = `${projects.length} 个项目 · ${totalDocs} 篇知识文档`;

    const route = getCurrentRoute();
    let html = `
      <a class="nav-home-link ${route === '' ? 'active' : ''}" href="#/">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
        <span>总览与项目目录</span>
      </a>
    `;

    for (const proj of projects) {
      html += `
        <div class="nav-project" data-project="${escapeHtml(proj.id)}">
          <button class="nav-project-header" type="button">
            <span class="nav-project-title">
              <svg class="nav-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <span>${escapeHtml(proj.name)}</span>
            </span>
          </button>
          <ul class="nav-doc-list">
            ${renderNavItems(proj.id, proj.docs || [], route)}
          </ul>
        </div>
      `;
    }

    els.sidebarNav.innerHTML = html;

    els.sidebarNav.querySelectorAll('.nav-project-header').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('.nav-project').classList.toggle('collapsed');
      });
    });

    els.sidebarNav.querySelectorAll('.nav-sub-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('.nav-doc-item').classList.toggle('collapsed');
      });
    });

    els.sidebarNav.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', closeMobileSidebar);
    });
  }

  function getCurrentRoute() {
    const hash = window.location.hash || '#/';
    return hash.replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '');
  }

  async function fetchMarkdown(path) {
    if (state.docsCache.has(path)) return state.docsCache.get(path);
    const res = await fetch(`./content/${path}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`文档不存在：${path}`);
    const text = await res.text();
    state.docsCache.set(path, text);
    return text;
  }

  function slugifyHeading(text, index) {
    const base = text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    return base ? `${base}-${index}` : `section-${index}`;
  }

  function transformCallouts(container) {
    const types = {
      FOCUS: { cls: 'callout-focus', label: '重点讨论结论' },
      IMPORTANT: { cls: 'callout-focus', label: '重点讨论结论' },
      TIP: { cls: 'callout-tip', label: '工程实践建议' },
      WARNING: { cls: 'callout-warning', label: '易错点 / 避坑' },
      NOTE: { cls: 'callout-note', label: '背景说明' },
    };

    container.querySelectorAll('blockquote').forEach((bq) => {
      const firstP = bq.querySelector('p');
      if (!firstP) return;
      const match = firstP.innerHTML.match(/^\[!(FOCUS|IMPORTANT|TIP|WARNING|NOTE)\](?:\s+([^\n<]+))?(?:<br\s*\/?>|\n)?([\s\S]*)$/i);
      if (!match) return;
      const key = match[1].toUpperCase();
      const customTitle = match[2] ? match[2].trim() : '';
      const rest = (match[3] || '').trim();
      const cfg = types[key] || types.NOTE;

      const div = document.createElement('div');
      div.className = `callout ${cfg.cls}`;
      const titleEl = document.createElement('div');
      titleEl.className = 'callout-title';
      titleEl.textContent = customTitle || cfg.label;
      div.appendChild(titleEl);

      if (rest) {
        firstP.innerHTML = rest;
      } else {
        firstP.remove();
      }
      while (bq.firstChild) div.appendChild(bq.firstChild);
      bq.replaceWith(div);
    });
  }

  async function enhanceRenderedDom(container) {
    // Wrap tables
    container.querySelectorAll('table').forEach((table) => {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });

    // Callouts
    transformCallouts(container);

    // Code blocks & Mermaid
    const mermaidBlocks = [];
    container.querySelectorAll('pre > code').forEach((codeEl) => {
      const pre = codeEl.parentElement;
      const langClass = Array.from(codeEl.classList).find((c) => c.startsWith('language-'));
      const lang = langClass ? langClass.replace('language-', '') : 'text';

      if (lang === 'mermaid') {
        const card = document.createElement('div');
        card.className = 'mermaid-card';
        card.dataset.mermaidSrc = codeEl.textContent;
        card.innerHTML = `<div class="mermaid">${escapeHtml(codeEl.textContent)}</div>`;
        pre.replaceWith(card);
        mermaidBlocks.push(card);
        return;
      }

      if (window.hljs) {
        window.hljs.highlightElement(codeEl);
      }

      const wrap = document.createElement('div');
      wrap.className = 'code-block-wrap';
      const header = document.createElement('div');
      header.className = 'code-block-header';
      header.innerHTML = `<span>${escapeHtml(lang)}</span><button class="copy-btn" type="button">复制</button>`;
      const copyBtn = header.querySelector('.copy-btn');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(codeEl.textContent);
          copyBtn.textContent = '已复制';
          setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
        } catch {
          copyBtn.textContent = '复制失败';
        }
      });

      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(header);
      wrap.appendChild(pre);
    });

    // Render Mermaid
    if (mermaidBlocks.length && window.mermaid) {
      try {
        await window.mermaid.run({ nodes: mermaidBlocks.map((c) => c.querySelector('.mermaid')) });
        mermaidBlocks.forEach((card) => {
          card.addEventListener('click', () => {
            const svg = card.querySelector('svg');
            if (svg) openSvgLightbox(svg, '架构 / 流程图（支持滚轮滚动与顶部缩放）');
          });
        });
      } catch (err) {
        console.error('Mermaid render error:', err);
      }
    }

    // Images lightbox + caption
    container.querySelectorAll('img').forEach((img) => {
      if (img.alt) {
        const cap = document.createElement('div');
        cap.className = 'figure-caption';
        cap.textContent = img.alt;
        img.insertAdjacentElement('afterend', cap);
      }
      img.addEventListener('click', () => {
        openImgLightbox(img, img.alt || '图解预览（支持滚轮滚动与顶部缩放）');
      });
    });

    // Build TOC
    buildToc(container);
  }

  function buildToc(container) {
    const headings = Array.from(container.querySelectorAll('h2, h3'));
    if (!headings.length) {
      els.tocNav.innerHTML = '<div style="padding:4px 12px;font-size:12px;color:var(--text-muted)">暂无子目录</div>';
      return;
    }

    const links = headings.map((h, i) => {
      const id = slugifyHeading(h.textContent, i);
      h.id = id;
      const level = h.tagName === 'H3' ? 'level-3' : 'level-2';
      return `<a class="toc-link ${level}" href="javascript:void(0)" data-target="${escapeHtml(id)}">${escapeHtml(h.textContent)}</a>`;
    });

    els.tocNav.innerHTML = links.join('');
    els.tocNav.querySelectorAll('.toc-link').forEach((link) => {
      link.addEventListener('click', () => {
        const target = document.getElementById(link.dataset.target);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    const tocLinks = Array.from(els.tocNav.querySelectorAll('.toc-link'));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            tocLinks.forEach((l) => l.classList.toggle('active', l.dataset.target === entry.target.id));
            break;
          }
        }
      },
      { rootMargin: '-20px 0px -70% 0px', threshold: 0 }
    );
    headings.forEach((h) => observer.observe(h));
  }

  function renderProjectCardsHtml() {
    const projects = state.manifest.projects || [];
    if (!projects.length) return '';
    return `
      <div class="project-grid">
        ${projects.map((p) => `
          <div class="project-card">
            <div class="project-card-head">
              <h3>${escapeHtml(p.name)}</h3>
              <span class="badge ${escapeHtml(p.status || 'draft')}">${statusLabel(p.status)}</span>
            </div>
            <p>${escapeHtml(p.description || '')}</p>
            <div class="doc-badges">
              ${(p.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join('')}
            </div>
            <div class="project-card-links">
              ${(p.docs || []).map((d) => `
                <a href="#/${escapeHtml(p.id)}/${escapeHtml(d.slug)}">
                  <span>→ ${escapeHtml(d.title)}</span>
                  <span class="status-dot ${escapeHtml(d.status || 'draft')}"></span>
                </a>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function renderRoute() {
    if (!state.manifest) return;
    const route = getCurrentRoute();
    state.currentRoute = route;
    renderSidebar();

    els.docContainer.innerHTML = '<div class="loading-state">正在加载…</div>';
    window.scrollTo({ top: 0 });

    try {
      if (!route) {
        const md = await fetchMarkdown(state.manifest.home || 'home.md');
        const rendered = window.marked.parse(md);
        document.title = `${state.manifest.site?.title || 'Tech Notes'} · 首页`;
        els.docContainer.innerHTML = `
          <div class="markdown-body">
            ${rendered}
            <h2>项目专题索引</h2>
            ${renderProjectCardsHtml()}
          </div>
        `;
        await enhanceRenderedDom(els.docContainer);
        return;
      }

      const [projId, ...slugParts] = route.split('/');
      const slug = slugParts.join('/');
      const project = (state.manifest.projects || []).find((p) => p.id === projId);
      const flat = project ? flattenDocs(project.docs || []) : [];
      const foundIdx = flat.findIndex((item) => item.doc.slug === slug);
      const found = foundIdx >= 0 ? flat[foundIdx] : null;
      if (!project || !found) {
        els.docContainer.innerHTML = `<div class="error-state">未找到页面 <code>${escapeHtml(route)}</code>，<a href="#/">返回首页</a></div>`;
        return;
      }

      const { doc, parent } = found;
      const md = await fetchMarkdown(doc.file);
      const rendered = window.marked.parse(md);
      document.title = `${doc.title} · ${project.name} · ${state.manifest.site?.title || 'Tech Notes'}`;

      const prev = foundIdx > 0 ? flat[foundIdx - 1].doc : null;
      const next = foundIdx < flat.length - 1 ? flat[foundIdx + 1].doc : null;

      const subpagesHtml = (doc.children && doc.children.length)
        ? `
          <section class="subpage-section">
            <h2>本章节子页面</h2>
            <div class="subpage-grid">
              ${doc.children.map((c) => `
                <a class="subpage-card" href="#/${escapeHtml(project.id)}/${escapeHtml(c.slug)}">
                  <strong>${escapeHtml(c.title)} →</strong>
                  ${c.summary ? `<p>${escapeHtml(c.summary)}</p>` : ''}
                </a>
              `).join('')}
            </div>
          </section>
        `
        : '';

      els.docContainer.innerHTML = `
        <div class="doc-meta-bar">
          <div class="doc-breadcrumb">
            <a href="#/">首页</a>
            <span>/</span>
            <span>${escapeHtml(project.name)}</span>
            ${parent ? `<span>/</span><a href="#/${escapeHtml(project.id)}/${escapeHtml(parent.slug)}">${escapeHtml(parent.title)}</a>` : ''}
          </div>
          <h1 class="doc-title-main">${escapeHtml(doc.title)}</h1>
          ${doc.summary ? `<p class="doc-summary">${escapeHtml(doc.summary)}</p>` : ''}
          <div class="doc-badges">
            <span class="badge ${escapeHtml(doc.status || 'draft')}">${statusLabel(doc.status)}</span>
            ${doc.updatedAt ? `<span class="badge">更新于 ${escapeHtml(doc.updatedAt)}</span>` : ''}
            ${(doc.tags || []).map((t) => `<span class="badge accent">#${escapeHtml(t)}</span>`).join('')}
          </div>
        </div>
        <div class="markdown-body">${rendered}</div>
        ${subpagesHtml}
        ${(prev || next) ? `
          <nav class="doc-pager">
            ${prev ? `<a class="pager-link prev" href="#/${escapeHtml(project.id)}/${escapeHtml(prev.slug)}"><small>← 上一篇</small><strong>${escapeHtml(prev.title)}</strong></a>` : '<div></div>'}
            ${next ? `<a class="pager-link next" href="#/${escapeHtml(project.id)}/${escapeHtml(next.slug)}"><small>下一篇 →</small><strong>${escapeHtml(next.title)}</strong></a>` : ''}
          </nav>
        ` : ''}
      `;

      await enhanceRenderedDom(els.docContainer);
    } catch (err) {
      els.docContainer.innerHTML = `<div class="error-state">加载失败：${escapeHtml(err.message)}</div>`;
    }
  }

  // Search
  async function openSearch() {
    els.searchModal.hidden = false;
    els.searchInput.value = '';
    els.searchInput.focus();
    await runSearch('');
  }

  function closeSearch() {
    els.searchModal.hidden = true;
  }

  async function runSearch(query) {
    const q = query.trim().toLowerCase();
    const allDocs = getAllDocs();
    const matches = [];

    for (const { project, doc } of allDocs) {
      let body = '';
      try {
        body = await fetchMarkdown(doc.file);
      } catch {}
      const haystack = `${project.name} ${doc.title} ${doc.summary || ''} ${(doc.tags || []).join(' ')} ${body}`.toLowerCase();
      if (!q || haystack.includes(q)) {
        matches.push({ project, doc });
      }
    }

    if (!matches.length) {
      els.searchResults.innerHTML = `<div class="search-empty">未找到匹配 “${escapeHtml(query)}” 的知识点</div>`;
      return;
    }

    els.searchResults.innerHTML = matches.map(({ project, doc }) => `
      <a class="search-item" href="#/${escapeHtml(project.id)}/${escapeHtml(doc.slug)}">
        <div class="search-item-title">${escapeHtml(doc.title)}</div>
        <div class="search-item-meta">${escapeHtml(project.name)} · ${escapeHtml(doc.summary || statusLabel(doc.status))}</div>
      </a>
    `).join('');

    els.searchResults.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', closeSearch);
    });
  }

  // Lightbox
  function applyLightboxZoom() {
    if (!lbState.targetEl) return;
    const w = Math.max(120, Math.round(lbState.baseWidth * lbState.zoom));
    const h = Math.max(120, Math.round(lbState.baseHeight * lbState.zoom));
    lbState.targetEl.style.width = `${w}px`;
    lbState.targetEl.style.height = `${h}px`;
    if (lbState.targetEl.tagName.toLowerCase() === 'svg') {
      lbState.targetEl.setAttribute('width', String(w));
      lbState.targetEl.setAttribute('height', String(h));
    }
    if (els.lightboxZoomLabel) {
      els.lightboxZoomLabel.textContent = `${Math.round(lbState.zoom * 100)}%`;
    }
  }

  function openSvgLightbox(svg, caption) {
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    let bw = vb && vb.width > 0 ? vb.width : rect.width || 800;
    let bh = vb && vb.height > 0 ? vb.height : rect.height || 600;
    const clone = svg.cloneNode(true);
    clone.removeAttribute('style');
    if (!clone.getAttribute('viewBox')) {
      clone.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
    }
    const stage = document.createElement('div');
    stage.className = 'lightbox-stage';
    stage.appendChild(clone);
    els.lightboxBody.innerHTML = '';
    els.lightboxBody.appendChild(stage);
    els.lightboxCaption.textContent = caption || '';
    lbState.baseWidth = bw;
    lbState.baseHeight = bh;
    lbState.targetEl = clone;
    const availW = Math.min(window.innerWidth * 0.9, 1260) - 48;
    lbState.zoom = bw < availW * 0.7 ? Math.min(1.35, availW / bw) : 1;
    applyLightboxZoom();
    els.lightbox.hidden = false;
    els.lightboxBody.scrollTop = 0;
    els.lightboxBody.scrollLeft = 0;
    document.body.style.overflow = 'hidden';
  }

  function openImgLightbox(img, caption) {
    const rect = img.getBoundingClientRect();
    const bw = img.naturalWidth || rect.width || 800;
    const bh = img.naturalHeight || rect.height || 500;
    const clone = document.createElement('img');
    clone.src = img.src;
    clone.alt = img.alt || '';
    const stage = document.createElement('div');
    stage.className = 'lightbox-stage';
    stage.appendChild(clone);
    els.lightboxBody.innerHTML = '';
    els.lightboxBody.appendChild(stage);
    els.lightboxCaption.textContent = caption || '';
    lbState.baseWidth = bw;
    lbState.baseHeight = bh;
    lbState.targetEl = clone;
    const availW = Math.min(window.innerWidth * 0.9, 1260) - 48;
    lbState.zoom = bw > availW ? Math.max(0.5, availW / bw) : 1;
    applyLightboxZoom();
    els.lightbox.hidden = false;
    els.lightboxBody.scrollTop = 0;
    els.lightboxBody.scrollLeft = 0;
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lightboxBody.innerHTML = '';
    lbState.targetEl = null;
    document.body.style.overflow = '';
  }

  // Mobile sidebar
  function openMobileSidebar() {
    els.sidebar.classList.add('open');
    els.sidebarBackdrop.hidden = false;
  }
  function closeMobileSidebar() {
    els.sidebar.classList.remove('open');
    els.sidebarBackdrop.hidden = true;
  }

  // Events
  els.themeToggle.addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    renderRoute();
  });
  els.menuToggle.addEventListener('click', openMobileSidebar);
  els.sidebarBackdrop.addEventListener('click', closeMobileSidebar);
  els.searchTrigger.addEventListener('click', openSearch);
  els.mobileSearchBtn.addEventListener('click', openSearch);
  els.searchModal.addEventListener('click', (e) => {
    if (e.target === els.searchModal) closeSearch();
  });
  els.searchInput.addEventListener('input', (e) => runSearch(e.target.value));
  els.lightboxClose.addEventListener('click', closeLightbox);
  els.lightboxZoomIn?.addEventListener('click', () => {
    lbState.zoom = Math.min(3, +(lbState.zoom + 0.25).toFixed(2));
    applyLightboxZoom();
  });
  els.lightboxZoomOut?.addEventListener('click', () => {
    lbState.zoom = Math.max(0.4, +(lbState.zoom - 0.25).toFixed(2));
    applyLightboxZoom();
  });
  els.lightboxZoomReset?.addEventListener('click', () => {
    lbState.zoom = 1;
    applyLightboxZoom();
  });
  els.lightboxBody.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      lbState.zoom = Math.min(3, Math.max(0.4, +(lbState.zoom + delta).toFixed(2)));
      applyLightboxZoom();
    }
  }, { passive: false });
  els.lightbox.addEventListener('click', (e) => {
    if (e.target === els.lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    } else if (e.key === 'Escape') {
      closeSearch();
      closeLightbox();
      closeMobileSidebar();
    }
  });

  window.addEventListener('hashchange', renderRoute);

  // Boot
  applyTheme(state.theme);
  loadManifest().then(renderRoute).catch((err) => {
    els.docContainer.innerHTML = `<div class="error-state">初始化失败：${escapeHtml(err.message)}</div>`;
  });
})();
