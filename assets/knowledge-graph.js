/* Obsidian-style Knowledge Graph Renderer & Physics Engine (zero external deps). */
(() => {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortTitle = s => {
    const clean = String(s || '').replace(/[（(][^）)]*[）)]/g, '').trim();
    const base = clean || String(s || '');
    return base.length > 24 ? base.slice(0, 22) + '…' : base;
  };

  function createGraph() {
    let cfg = null;
    let active = false;
    let stageEl = null;
    let canvas = null;
    let ctx = null;
    let ro = null;

    // Viewport & DPR
    let width = 800;
    let height = 540;
    let dpr = 1;

    // Camera state + animated target
    const cam = { x: 0, y: 0, z: 0.62 };
    const camGoal = { x: 0, y: 0, z: 0.62, on: false };

    // Graph model
    let nodes = [];
    let nodeById = new Map();
    let itemNodes = [];
    let hubNodes = [];
    let edges = [];
    let adj = new Map();
    let dupHubTopics = new Set();

    // Filter & UI state
    let visibleKinds = new Set(['hub', 'skill', 'website', 'prompt']);
    let showHubs = true;
    let showSemEdges = true;
    let labelMode = 'smart'; // 'smart' | 'minimal' | 'dense'
    let scopeCategory = '全部内容';
    let scopeTopic = '全部';
    let searchQuery = '';
    let searchHits = new Set();
    let searchOrdered = [];
    let searchHitIdx = 0;
    let matchScopeIds = new Set();

    // Interaction state
    let hoverId = null;
    let hoverEdge = null;
    let selectedId = null;
    let dragNode = null;
    let draggingCanvas = false;
    let lastPointer = { x: 0, y: 0 };
    let movedDist = 0;
    let activePointers = new Map();
    let pinchPrevDist = 0;

    // Animation loop
    let rafId = 0;
    let lastFrameTime = 0;
    let pulseStart = 0;
    let physicsEnergy = 0;
    const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let ui = {};

    function palette() {
      const dark = cfg.getTheme() === 'dark';
      return dark ? {
        bg: '#0b0b0e',
        dot: 'rgba(255,255,255,0.045)',
        hubFill: '#18181f',
        hubStroke: '#ffd43b',
        hubText: '#ededef',
        skill: '#a78bfa',
        website: '#38bdf8',
        prompt: '#fbbf24',
        edgeTopic: 'rgba(255,255,255,0.065)',
        edgeSem: 'rgba(255,255,255,0.12)',
        edgeActiveSem: '#ffd43b',
        edgeActiveTopic: 'rgba(167,139,250,0.65)',
        labelText: '#e4e4e7',
        labelMuted: '#a1a1aa',
        labelBg: 'rgba(11,11,14,0.84)',
        hubLabelBg: 'rgba(24,24,31,0.92)',
        hubLabelBorder: 'rgba(255,212,59,0.45)',
        ring: '#ffd43b',
        hitRing: '#ffffff',
      } : {
        bg: '#fafaf9',
        dot: 'rgba(25,25,25,0.065)',
        hubFill: '#ffd43b',
        hubStroke: '#191919',
        hubText: '#191919',
        skill: '#7c3aed',
        website: '#0284c7',
        prompt: '#d97706',
        edgeTopic: 'rgba(25,25,25,0.075)',
        edgeSem: 'rgba(25,25,25,0.13)',
        edgeActiveSem: '#d97706',
        edgeActiveTopic: 'rgba(124,58,237,0.55)',
        labelText: '#191919',
        labelMuted: '#595959',
        labelBg: 'rgba(250,250,249,0.9)',
        hubLabelBg: 'rgba(255,255,255,0.94)',
        hubLabelBorder: 'rgba(25,25,25,0.22)',
        ring: '#191919',
        hitRing: '#d97706',
      };
    }

    function nodeColor(n, pal) {
      if (n.isHub) return pal.hubFill;
      if (n.kind === 'skill') return pal.skill;
      if (n.kind === 'website') return pal.website;
      return pal.prompt;
    }

    function worldToScreen(wx, wy) {
      return {
        x: (wx - cam.x) * cam.z + width * 0.5,
        y: (wy - cam.y) * cam.z + height * 0.5,
      };
    }

    function screenToWorld(sx, sy) {
      return {
        x: (sx - width * 0.5) / cam.z + cam.x,
        y: (sy - height * 0.5) / cam.z + cam.y,
      };
    }

    function flyTo(wx, wy, targetZ, offsetForInspector = true) {
      const z = targetZ ?? clamp(Math.max(cam.z, 1.05), 0.45, 2.2);
      const offX = offsetForInspector && width > 720 && selectedId ? 155 / z : 0;
      const offY = offsetForInspector && width <= 720 && selectedId ? (height * 0.16) / z : 0;
      camGoal.x = wx + offX;
      camGoal.y = wy + offY;
      camGoal.z = z;
      if (reduceMotion()) {
        cam.x = camGoal.x;
        cam.y = camGoal.y;
        cam.z = camGoal.z;
        camGoal.on = false;
        draw();
      } else {
        camGoal.on = true;
        wake();
      }
    }

    function fitNodes(list, instant = false) {
      const vis = (list || []).filter(isNodeShown);
      if (!vis.length) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of vis) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
      const isNarrow = width < 520;
      const spanX = Math.max(180, maxX - minX + (isNarrow ? 110 : 180));
      const spanY = Math.max(160, maxY - minY + (isNarrow ? 120 : 170));
      const padW = selectedId && width > 720 ? Math.max(200, width - 370) : Math.max(160, width - (isNarrow ? 34 : 72));
      const padH = Math.max(180, height - (isNarrow ? 96 : 112));
      const targetZ = clamp(Math.min(padW / spanX, padH / spanY), 0.20, searchHits.size ? 1.45 : 1.08);
      const cx = (minX + maxX) * 0.5 + (selectedId && width > 720 ? 155 / targetZ : 0);
      const cy = (minY + maxY) * 0.5 - (isNarrow ? 14 / targetZ : 0);
      if (instant || reduceMotion()) {
        cam.x = cx; cam.y = cy; cam.z = targetZ; camGoal.on = false;
        draw();
      } else {
        camGoal.x = cx; camGoal.y = cy; camGoal.z = targetZ; camGoal.on = true;
        wake();
      }
    }

    function isNodeShown(n) {
      if (n.isHub) {
        if (!showHubs || !visibleKinds.has('hub')) return false;
        const list = adj.get(n.id) || [];
        return list.some(rel => isItemShown(rel.node));
      }
      return isItemShown(n);
    }

    function isItemShown(n) {
      if (!visibleKinds.has(n.kind)) return false;
      if (!matchScopeIds.has(n.id)) return false;
      return true;
    }

    function buildModel() {
      const g = cfg.graphData;
      const itemsById = new Map(cfg.getItems().map(i => [i.id, i]));
      nodes = [];
      nodeById = new Map();
      itemNodes = [];
      hubNodes = [];
      edges = [];
      adj = new Map();

      const topicSeen = new Map();
      for (const h of g.hubs) {
        topicSeen.set(h.topic, (topicSeen.get(h.topic) || 0) + 1);
      }
      dupHubTopics = new Set([...topicSeen.entries()].filter(([, c]) => c > 1).map(([t]) => t));

      for (const h of g.hubs) {
        const node = {
          id: h.id,
          isHub: true,
          kind: h.kind,
          topic: h.topic,
          count: h.count,
          x: h.x,
          y: h.y,
          homeX: h.x,
          homeY: h.y,
          vx: 0,
          vy: 0,
          r: 12 + Math.min(10, Math.sqrt(h.count) * 1.15),
          focusAlpha: 1,
        };
        nodes.push(node);
        hubNodes.push(node);
        nodeById.set(node.id, node);
        adj.set(node.id, []);
      }

      for (const n of g.nodes) {
        const item = itemsById.get(n.id);
        if (!item) continue;
        const kind = cfg.kindOf(item);
        const node = {
          id: n.id,
          isHub: false,
          item,
          kind,
          hub: n.hub,
          deg: n.deg || 0,
          x: n.x,
          y: n.y,
          homeX: n.x,
          homeY: n.y,
          vx: 0,
          vy: 0,
          r: 4.5 + Math.min(4.2, (n.deg || 0) * 0.55),
          focusAlpha: 1,
        };
        nodes.push(node);
        itemNodes.push(node);
        nodeById.set(node.id, node);
        adj.set(node.id, []);
      }

      for (const e of g.edges) {
        const a = nodeById.get(e.s);
        const b = nodeById.get(e.t);
        if (!a || !b) continue;
        const edge = { a, b, k: e.k, w: e.w || 0.4, rz: e.rz || '', re: e.re || '' };
        edges.push(edge);
        adj.get(a.id).push({ node: b, edge, w: edge.w, k: edge.k });
        adj.get(b.id).push({ node: a, edge, w: edge.w, k: edge.k });
      }

      for (const [, list] of adj) {
        list.sort((x, y) => (x.k === y.k ? y.w - x.w : x.k === 'r' ? -1 : 1));
      }
    }

    function hubDisplayLabel(h) {
      const base = cfg.tr(h.topic);
      if (!dupHubTopics.has(h.topic)) return `${base} (${h.count})`;
      const sec = h.kind === 'skill' ? 'Skills' : h.kind === 'website' ? cfg.tr('网站') : cfg.tr('提示词');
      return `${sec}·${base} (${h.count})`;
    }

    function buildUI() {
      stageEl.innerHTML = `
        <canvas class="graph-canvas"></canvas>
        <div class="graph-topbar">
          <div class="graph-legend" id="graphLegend" role="group" aria-label="节点图例">
            <button type="button" class="graph-pill active" data-gkind="hub"><i class="dot dot-hub"></i><span data-gi="主题中心"></span></button>
            <button type="button" class="graph-pill active" data-gkind="skill"><i class="dot dot-skill"></i><span>Skills</span></button>
            <button type="button" class="graph-pill active" data-gkind="website"><i class="dot dot-website"></i><span data-gi="实用网站"></span></button>
            <button type="button" class="graph-pill active" data-gkind="prompt"><i class="dot dot-prompt"></i><span data-gi="提示词"></span></button>
            <span class="graph-stat" id="graphStat"></span>
          </div>
          <div class="graph-search-nav" id="graphSearchNav" hidden>
            <span class="graph-hit-label" id="graphHitLabel"></span>
            <button type="button" class="graph-btn" id="graphPrevHit" aria-label="上一个">‹</button>
            <button type="button" class="graph-btn" id="graphNextHit" aria-label="下一个">›</button>
          </div>
          <div class="graph-top-right">
            <button type="button" class="graph-gear" id="graphGear" aria-expanded="false" aria-controls="graphSettings" aria-label="图谱设置">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </div>
        <div class="graph-settings" id="graphSettings" hidden>
          <div class="graph-set-row"><span data-gi="显示主题中心"></span><input type="checkbox" id="optShowHubs" checked></div>
          <div class="graph-set-row"><span data-gi="显示语义连线"></span><input type="checkbox" id="optShowSem" checked></div>
          <div class="graph-set-col">
            <span data-gi="标签显示"></span>
            <div class="graph-seg" role="group">
              <button type="button" class="graph-seg-btn active" data-lmode="smart" data-gi="智能"></button>
              <button type="button" class="graph-seg-btn" data-lmode="minimal" data-gi="极简"></button>
              <button type="button" class="graph-seg-btn" data-lmode="dense" data-gi="详细"></button>
            </div>
          </div>
          <div class="graph-set-actions">
            <button type="button" class="graph-btn" id="optResetLayout" data-gi="还原布局"></button>
          </div>
        </div>
        <aside class="graph-inspector" id="graphInspector" hidden aria-label="节点详情"></aside>
        <div class="graph-tooltip" id="graphTooltip" hidden></div>
        <div class="graph-hint" data-gi="拖拽节点探索关系，滚轮缩放，点击查看详情"></div>
        <div class="graph-controls" id="graphControls" role="group" aria-label="缩放控制">
          <button type="button" class="graph-btn" id="graphZoomIn" aria-label="放大">+</button>
          <button type="button" class="graph-btn" id="graphZoomOut" aria-label="缩小">−</button>
          <button type="button" class="graph-btn" id="graphReset" aria-label="重置视图">⌖</button>
        </div>
      `;

      canvas = stageEl.querySelector('.graph-canvas');
      ctx = canvas.getContext('2d');
      ui = {
        legend: stageEl.querySelector('#graphLegend'),
        controls: stageEl.querySelector('#graphControls'),
        stat: stageEl.querySelector('#graphStat'),
        searchNav: stageEl.querySelector('#graphSearchNav'),
        hitLabel: stageEl.querySelector('#graphHitLabel'),
        prevHit: stageEl.querySelector('#graphPrevHit'),
        nextHit: stageEl.querySelector('#graphNextHit'),
        gear: stageEl.querySelector('#graphGear'),
        settings: stageEl.querySelector('#graphSettings'),
        optShowHubs: stageEl.querySelector('#optShowHubs'),
        optShowSem: stageEl.querySelector('#optShowSem'),
        optResetLayout: stageEl.querySelector('#optResetLayout'),
        inspector: stageEl.querySelector('#graphInspector'),
        tooltip: stageEl.querySelector('#graphTooltip'),
        zoomIn: stageEl.querySelector('#graphZoomIn'),
        zoomOut: stageEl.querySelector('#graphZoomOut'),
        reset: stageEl.querySelector('#graphReset'),
      };

      bindEvents();
      translateUI();
    }

    function translateUI() {
      if (!ui.stat) return;
      stageEl.querySelectorAll('[data-gi]').forEach(el => {
        el.textContent = cfg.tr(el.dataset.gi);
      });
      ui.legend.setAttribute('aria-label', cfg.tr('节点图例'));
      ui.controls.setAttribute('aria-label', cfg.tr('缩放控制'));
      ui.inspector.setAttribute('aria-label', cfg.tr('节点详情'));
      ui.zoomIn.setAttribute('aria-label', cfg.tr('放大'));
      ui.zoomOut.setAttribute('aria-label', cfg.tr('缩小'));
      ui.reset.setAttribute('aria-label', cfg.tr('重置视图'));
      ui.gear.setAttribute('aria-label', cfg.tr('图谱设置'));
      ui.prevHit.setAttribute('aria-label', cfg.tr('上一个'));
      ui.nextHit.setAttribute('aria-label', cfg.tr('下一个'));
      updateStats();
      updateSearchNav();
      if (selectedId) renderInspector();
    }

    function updateStats() {
      const visItems = itemNodes.filter(isItemShown);
      const visSet = new Set(visItems.map(n => n.id));
      let visEdges = 0;
      for (const e of edges) {
        if (e.k === 'r' && showSemEdges && visSet.has(e.a.id) && visSet.has(e.b.id)) visEdges++;
      }
      ui.stat.textContent = cfg.tr('{n} 节点 · {e} 关联')
        .replace('{n}', visItems.length)
        .replace('{e}', visEdges);
    }

    function updateSearchNav() {
      if (!searchQuery || !searchOrdered.length) {
        ui.searchNav.hidden = true;
        return;
      }
      ui.searchNav.hidden = false;
      const cur = searchOrdered[searchHitIdx] || searchOrdered[0];
      const t = cur ? shortTitle(cfg.tx(cur.item, 'title')) : '';
      ui.hitLabel.textContent = `${cfg.tr('命中 {n} 个节点').replace('{n}', searchOrdered.length)} · ${searchHitIdx + 1}/${searchOrdered.length}「${t}」`;
    }

    function selectNode(id, doFly = true) {
      selectedId = id;
      stageEl?.classList.toggle('has-inspector', !!id);
      if (!id) {
        ui.inspector.hidden = true;
        ui.inspector.innerHTML = '';
        wake();
        return;
      }
      const n = nodeById.get(id);
      if (!n) return;
      renderInspector();
      if (doFly) {
        flyTo(n.x, n.y, n.isHub ? clamp(Math.max(cam.z, 0.9), 0.7, 1.4) : clamp(Math.max(cam.z, 1.32), 1.0, 2.1), true);
      } else {
        wake();
      }
    }

    function renderInspector() {
      if (!selectedId) {
        ui.inspector.hidden = true;
        stageEl?.classList.remove('has-inspector');
        return;
      }
      const n = nodeById.get(selectedId);
      if (!n) {
        ui.inspector.hidden = true;
        stageEl?.classList.remove('has-inspector');
        return;
      }
      const lang = cfg.getLang();

      if (n.isHub) {
        const members = (adj.get(n.id) || [])
          .filter(x => !x.node.isHub && isItemShown(x.node))
          .sort((a, b) => b.node.deg - a.node.deg)
          .slice(0, 8);
        const sectionName = n.kind === 'skill' ? 'Skills' : n.kind === 'website' ? '实用网站' : '提示词';
        const notePair = cfg.categoryNotes?.[sectionName + '/' + n.topic];
        const note = notePair ? notePair[lang === 'en' ? 1 : 0] : '';
        ui.inspector.innerHTML = `
          <div class="gi-head">
            <span class="gi-badge gi-hub">${esc(cfg.tr('主题中心'))} · ${esc(cfg.tr(sectionName))}</span>
            <button type="button" class="graph-close" data-gact="close" aria-label="${esc(cfg.tr('关闭面板'))}">×</button>
          </div>
          <div class="gi-scroll">
            <h3 class="gi-title">${esc(cfg.tr(n.topic))}</h3>
            ${note ? `<p class="gi-desc">${esc(note)}</p>` : ''}
            <div class="gi-sec-label">${esc(cfg.tr('关联内容'))} (${members.length})</div>
            <div class="gi-rels">
              ${members.map(m => `
                <button type="button" class="graph-rel-item" data-gjump="${esc(m.node.id)}">
                  <span class="gi-rel-name">${esc(cfg.tx(m.node.item, 'title'))}</span>
                  <small class="gi-rel-reason">${esc(cfg.tr(m.node.kind === 'skill' ? 'Skill' : m.node.kind === 'website' ? '网站' : '提示词'))}</small>
                </button>
              `).join('')}
            </div>
          </div>
          <div class="gi-foot">
            <button type="button" class="primary gi-primary" data-ggrid="${esc(sectionName)}:${esc(n.topic)}">${esc(cfg.tr('在卡片视图中浏览'))}</button>
          </div>
        `;
        ui.inspector.hidden = false;
        stageEl?.classList.add('has-inspector');
        return;
      }

      const item = n.item;
      const title = cfg.tx(item, 'title');
      const desc = cfg.tx(item, 'description') || cfg.tr('一条新收录的灵感。');
      const tags = cfg.tx(item, 'tags') || '';
      const cover = cfg.coverOf(item) || (item.preview?.type === 'image' && /^assets\/[a-zA-Z0-9_./-]+$/.test(item.preview.src) && !item.preview.src.includes('..') ? item.preview.src : '');
      const kindLabel = item.kind === 'website' ? cfg.tr('网站') : item.kind === 'skill' ? cfg.tr(item.resourceType || 'Skill') : cfg.tr('提示词');

      const rels = (adj.get(n.id) || [])
        .filter(x => x.k === 'r' && isItemShown(x.node))
        .slice(0, 6);
      const hubs = (adj.get(n.id) || []).filter(x => x.k === 't' && x.node.isHub);

      const links = cfg.resourceLinks(item);
      const visitHtml = links.length
        ? `<a class="visit-site gi-visit" href="${esc(links[0].url)}" target="_blank" rel="noopener noreferrer">${esc(cfg.tr('访问官网'))} ↗</a>`
        : '';

      ui.inspector.innerHTML = `
        <div class="gi-head">
          <span class="gi-badge">${esc(kindLabel)} · ${esc(cfg.tr(item.category))}</span>
          <div class="gi-head-acts">
            <button type="button" class="graph-btn gi-fav" data-gfav="${esc(item.id)}" aria-pressed="${!!item.favorite}" aria-label="${esc(cfg.tr(item.favorite ? '取消收藏' : '收藏'))}">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6.5 3.8h11a1 1 0 0 1 1 1v15.4l-6.5-4.3-6.5 4.3V4.8a1 1 0 0 1 1-1z"/></svg>
            </button>
            <button type="button" class="graph-close" data-gact="close" aria-label="${esc(cfg.tr('关闭面板'))}">×</button>
          </div>
        </div>
        <div class="gi-scroll">
          ${cover ? `<div class="gi-cover"><img src="${esc(cover)}" alt="${esc(title)}" loading="lazy"></div>` : ''}
          <h3 class="gi-title">${esc(title)}</h3>
          <p class="gi-desc">${esc(desc)}</p>
          ${tags ? `<div class="gi-tags">${esc(tags)}</div>` : ''}
          ${hubs.length ? `<div class="gi-hubs">${hubs.map(h => `<button type="button" class="graph-rel-item gi-hub-chip" data-gjump="${esc(h.node.id)}"># ${esc(cfg.tr(h.node.topic))}</button>`).join('')}</div>` : ''}
          <div class="gi-sec-label">${esc(cfg.tr('关联内容'))} (${rels.length})</div>
          <div class="gi-rels">
            ${rels.length ? rels.map(r => `
              <button type="button" class="graph-rel-item" data-gjump="${esc(r.node.id)}">
                <span class="gi-rel-name">${esc(cfg.tx(r.node.item, 'title'))}</span>
                <small class="gi-rel-reason">${esc(lang === 'en' ? (r.edge.re || r.edge.rz) : (r.edge.rz || r.edge.re))}</small>
              </button>
            `).join('') : `<div class="gi-empty-rel">${esc(cfg.tr('暂无强语义直连，点击上方主题可查看同类内容。'))}</div>`}
          </div>
        </div>
        <div class="gi-foot">
          <button type="button" class="primary gi-primary" data-gdetail="${esc(item.id)}">${esc(cfg.tr('查看完整详情'))}</button>
          ${visitHtml}
        </div>
      `;
      ui.inspector.hidden = false;
      stageEl?.classList.add('has-inspector');
    }

    function resize() {
      if (!stageEl || !canvas) return;
      const rect = stageEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = rect.width;
      height = rect.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      draw();
    }

    function hitNodeAt(sx, sy) {
      const w = screenToWorld(sx, sy);
      let best = null;
      let bestDist = Infinity;
      const invZ = 1 / cam.z;
      for (let idx = nodes.length - 1; idx >= 0; idx--) {
        const n = nodes[idx];
        if (!isNodeShown(n)) continue;
        const hitR = (n.r * (n.id === selectedId || n.id === hoverId ? 1.35 : 1.0)) + Math.max(8, 12 * invZ);
        const dx = w.x - n.x;
        const dy = w.y - n.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= hitR * hitR && d2 < bestDist) {
          best = n;
          bestDist = d2;
        }
      }
      return best;
    }

    function distPointToSeg(px, py, ax, ay, bx, by) {
      const abx = bx - ax, aby = by - ay;
      const len2 = abx * abx + aby * aby;
      if (!len2) return Math.hypot(px - ax, py - ay);
      const t = clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
      return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
    }

    function hitEdgeAt(sx, sy) {
      if (!showSemEdges) return null;
      let best = null;
      let bestD = 9;
      for (const e of edges) {
        if (e.k !== 'r' || !e.rz) continue;
        if (!isItemShown(e.a) || !isItemShown(e.b)) continue;
        const p1 = worldToScreen(e.a.x, e.a.y);
        const p2 = worldToScreen(e.b.x, e.b.y);
        const d = distPointToSeg(sx, sy, p1.x, p1.y, p2.x, p2.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      return best;
    }

    function stepPhysics(dt) {
      if (!dragNode && physicsEnergy <= 0.015) return false;
      const kHome = 0.045;
      const kSpring = 0.14;
      let maxV = 0;

      if (dragNode) {
        const neighbors = adj.get(dragNode.id) || [];
        for (const rel of neighbors) {
          const nb = rel.node;
          if (!isNodeShown(nb) || nb === dragNode) continue;
          const dx = dragNode.x - nb.x;
          const dy = dragNode.y - nb.y;
          const dist = Math.hypot(dx, dy) + 0.01;
          const targetDist = rel.k === 't' ? 115 : 74;
          if (dist > targetDist) {
            const pull = (dist - targetDist) * kSpring * (rel.k === 'r' ? 0.55 : 0.35) / dist;
            nb.vx += dx * pull;
            nb.vy += dy * pull;
          }
        }
      }

      for (const n of nodes) {
        if (n === dragNode) continue;
        if (Math.abs(n.x - n.homeX) > 0.2 || Math.abs(n.y - n.homeY) > 0.2 || Math.abs(n.vx) > 0.02 || Math.abs(n.vy) > 0.02) {
          n.vx = (n.vx + (n.homeX - n.x) * kHome * (dt * 60 * 0.45)) * 0.82;
          n.vy = (n.vy + (n.homeY - n.y) * kHome * (dt * 60 * 0.45)) * 0.82;
          n.x += n.vx;
          n.y += n.vy;
          const sp = Math.hypot(n.vx, n.vy) + Math.hypot(n.homeX - n.x, n.homeY - n.y) * 0.05;
          if (sp > maxV) maxV = sp;
        }
      }

      physicsEnergy = maxV;
      return !!dragNode || physicsEnergy > 0.015;
    }

    function draw(now = performance.now()) {
      if (!ctx || !active) return;
      const pal = palette();
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, width, height);

      const step = 36 * cam.z;
      if (step >= 12) {
        const ox = ((-cam.x * cam.z + width * 0.5) % step + step) % step;
        const oy = ((-cam.y * cam.z + height * 0.5) % step + step) % step;
        ctx.fillStyle = pal.dot;
        for (let x = ox; x < width; x += step) {
          for (let y = oy; y < height; y += step) {
            ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
          }
        }
      }

      const focusId = hoverId || selectedId;
      const focusNode = focusId ? nodeById.get(focusId) : null;
      const focusShown = focusNode && isNodeShown(focusNode);
      const focusNeighbors = new Set();
      if (focusShown) {
        focusNeighbors.add(focusId);
        for (const rel of (adj.get(focusId) || [])) {
          if ((rel.k === 'r' && showSemEdges) || (rel.k === 't' && showHubs)) {
            if (isNodeShown(rel.node)) focusNeighbors.add(rel.node.id);
          }
        }
      }
      const hasSearch = searchQuery.length > 0 && searchHits.size > 0;
      const pulsePhase = hasSearch && !reduceMotion() ? (0.5 + 0.5 * Math.sin((now - pulseStart) * 0.0045)) : 1;

      for (const e of edges) {
        if (e.k === 'r' && !showSemEdges) continue;
        if (e.k === 't' && !showHubs) continue;
        if (!isNodeShown(e.a) || !isNodeShown(e.b)) continue;

        const isConnected = focusShown && (e.a.id === focusId || e.b.id === focusId);
        const isEdgeHovered = hoverEdge === e;
        const p1 = worldToScreen(e.a.x, e.a.y);
        const p2 = worldToScreen(e.b.x, e.b.y);
        if (Math.max(p1.x, p2.x) < -20 || Math.min(p1.x, p2.x) > width + 20 || Math.max(p1.y, p2.y) < -20 || Math.min(p1.y, p2.y) > height + 20) {
          continue;
        }

        let alpha = 1;
        if (focusShown) {
          alpha = (isConnected || isEdgeHovered) ? 1 : 0.14;
        } else if (hasSearch) {
          alpha = (searchHits.has(e.a.id) || searchHits.has(e.b.id)) ? 0.9 : 0.16;
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        if (isConnected || isEdgeHovered) {
          ctx.strokeStyle = e.k === 'r' ? pal.edgeActiveSem : pal.edgeActiveTopic;
          ctx.lineWidth = e.k === 'r' ? 2.1 : 1.4;
        } else {
          ctx.strokeStyle = e.k === 'r' ? pal.edgeSem : pal.edgeTopic;
          ctx.lineWidth = e.k === 'r' ? 1.05 : 0.75;
        }
        ctx.stroke();
        ctx.restore();
      }

      let animatingFocus = false;
      for (const n of nodes) {
        if (!isNodeShown(n)) continue;
        let targetAlpha = 1;
        if (focusShown) {
          targetAlpha = focusNeighbors.has(n.id) ? 1 : 0.13;
        } else if (hasSearch) {
          targetAlpha = (searchHits.has(n.id) || (n.isHub && (adj.get(n.id) || []).some(r => searchHits.has(r.node.id)))) ? 1 : 0.16;
        }
        if (reduceMotion()) {
          n.focusAlpha = targetAlpha;
        } else {
          n.focusAlpha = lerp(n.focusAlpha, targetAlpha, 0.22);
          if (Math.abs(n.focusAlpha - targetAlpha) > 0.015) animatingFocus = true;
        }

        const p = worldToScreen(n.x, n.y);
        if (p.x < -50 || p.x > width + 50 || p.y < -50 || p.y > height + 50) continue;

        const isSel = n.id === selectedId;
        const isHov = n.id === hoverId;
        const isHit = hasSearch && searchHits.has(n.id);
        const drawR = clamp(n.r * Math.pow(cam.z, 0.72), n.isHub ? 7 : 3.2, 26) * (isSel || isHov ? 1.28 : isHit ? 1.18 : 1);

        ctx.save();
        ctx.globalAlpha = n.focusAlpha;

        if (isSel || isHov || isHit) {
          ctx.beginPath();
          const haloR = drawR + (isSel ? 7 : isHit ? 5 + 3 * pulsePhase : 5);
          ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
          ctx.strokeStyle = isHit && !isSel ? pal.hitRing : pal.ring;
          ctx.lineWidth = isSel ? 2.2 : 1.6;
          ctx.globalAlpha = n.focusAlpha * (isHit && !isSel ? 0.55 + 0.35 * pulsePhase : 0.85);
          ctx.stroke();
          ctx.globalAlpha = n.focusAlpha;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, drawR, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor(n, pal);
        ctx.fill();

        if (n.isHub) {
          ctx.lineWidth = isSel || isHov ? 2.6 : 1.8;
          ctx.strokeStyle = pal.hubStroke;
          ctx.stroke();
        } else if (isSel || isHov || (n.item && n.item.favorite)) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = n.item?.favorite ? '#ffd43b' : pal.ring;
          ctx.stroke();
        }
        ctx.restore();
      }

      // Smart non-overlapping labels clamped safely inside viewport
      const placed = [];
      const topSafe = width < 720 ? 58 : 54;
      const tryPlaceLabel = (n, priority) => {
        if (!isNodeShown(n) || n.focusAlpha < 0.25) return;
        const p = worldToScreen(n.x, n.y);
        if (p.x < 6 || p.x > width - 6 || p.y < topSafe || p.y > height - 8) return;

        const text = n.isHub ? hubDisplayLabel(n) : shortTitle(cfg.tx(n.item, 'title'));
        const compact = width < 480;
        const fontSize = n.isHub ? (compact ? 10.5 : 12) : (priority <= 1 ? (compact ? 11 : 12) : 11);
        ctx.font = `${n.isHub || priority <= 1 ? '600' : '500'} ${fontSize}px "Segoe UI","Microsoft YaHei",sans-serif`;
        const tw = ctx.measureText(text).width;
        const padX = n.isHub ? (compact ? 6 : 8) : 5;
        const boxW = Math.min(width - 16, tw + padX * 2);
        const boxH = fontSize + 7;
        const drawR = clamp(n.r * Math.pow(cam.z, 0.72), n.isHub ? 7 : 3.2, 26);
        const lx = clamp(p.x - boxW * 0.5, 6, Math.max(6, width - boxW - 6));
        const ly = clamp(p.y - drawR - boxH - 6, topSafe, Math.max(topSafe, height - boxH - 8));

        const padMargin = 4;
        for (const r of placed) {
          if (lx < r.r + padMargin && lx + boxW + padMargin > r.l && ly < r.b + padMargin && ly + boxH + padMargin > r.t) {
            return;
          }
        }
        placed.push({ l: lx, t: ly, r: lx + boxW, b: ly + boxH });

        ctx.save();
        ctx.globalAlpha = clamp(n.focusAlpha, 0, 1);
        ctx.fillStyle = n.isHub ? pal.hubLabelBg : pal.labelBg;
        ctx.beginPath();
        const cr = n.isHub ? 999 : 6;
        ctx.roundRect ? ctx.roundRect(lx, ly, boxW, boxH, cr) : ctx.rect(lx, ly, boxW, boxH);
        ctx.fill();
        if (n.isHub || priority === 0) {
          ctx.strokeStyle = priority === 0 ? pal.ring : pal.hubLabelBorder;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.fillStyle = n.isHub ? pal.hubText : (priority <= 2 ? pal.labelText : pal.labelMuted);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, lx + boxW * 0.5, ly + boxH * 0.5 + 0.5, boxW - 4);
        ctx.restore();
      };

      if (focusShown) tryPlaceLabel(focusNode, 0);
      if (hoverId && hoverId !== selectedId && nodeById.get(hoverId)) tryPlaceLabel(nodeById.get(hoverId), 0);
      if (selectedId && selectedId !== hoverId && nodeById.get(selectedId)) tryPlaceLabel(nodeById.get(selectedId), 0);
      for (const hid of focusNeighbors) {
        if (hid !== focusId) tryPlaceLabel(nodeById.get(hid), 1);
      }
      if (hasSearch) {
        for (const n of searchOrdered.slice(0, 24)) tryPlaceLabel(n, 1);
      }
      for (const h of hubNodes) tryPlaceLabel(h, 2);

      if (labelMode !== 'minimal') {
        const degCut = labelMode === 'dense' ? (cam.z >= 0.72 ? 0 : 3) : (cam.z >= 1.55 ? 0 : cam.z >= 1.05 ? 3 : 6);
        if (cam.z >= 0.85 || labelMode === 'dense' || matchScopeIds.size <= 35) {
          const sorted = [...itemNodes].sort((a, b) => b.deg - a.deg);
          for (const n of sorted) {
            if (n.deg >= degCut || matchScopeIds.size <= 25) tryPlaceLabel(n, 3);
          }
        }
      }

      ctx.restore();
      return animatingFocus || (hasSearch && !reduceMotion());
    }

    function frame(now) {
      rafId = 0;
      if (!active) return;
      const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 1 / 60;
      lastFrameTime = now;

      let keepGoing = false;
      if (camGoal.on) {
        const k = 1 - Math.exp(-10 * dt);
        cam.x = lerp(cam.x, camGoal.x, k);
        cam.y = lerp(cam.y, camGoal.y, k);
        cam.z = lerp(cam.z, camGoal.z, k);
        if (Math.hypot(camGoal.x - cam.x, camGoal.y - cam.y) < 0.35 && Math.abs(camGoal.z - cam.z) < 0.004) {
          cam.x = camGoal.x;
          cam.y = camGoal.y;
          cam.z = camGoal.z;
          camGoal.on = false;
        } else {
          keepGoing = true;
        }
      }

      if (stepPhysics(dt)) keepGoing = true;
      if (draw(now)) keepGoing = true;

      if (keepGoing) {
        rafId = requestAnimationFrame(frame);
      } else {
        lastFrameTime = 0;
      }
    }

    function wake() {
      if (!active || rafId) return;
      rafId = requestAnimationFrame(frame);
    }

    function updateTooltip(sx, sy, node, edge) {
      if (!ui.tooltip) return;
      if (dragNode || draggingCanvas || (!node && !edge)) {
        ui.tooltip.hidden = true;
        return;
      }
      if (node && node.id === selectedId) {
        ui.tooltip.hidden = true;
        return;
      }
      const lang = cfg.getLang();
      if (node) {
        if (node.isHub) {
          ui.tooltip.innerHTML = `<b># ${esc(cfg.tr(node.topic))}</b><span>${esc(cfg.tr('{n} 条').replace('{n}', node.count))}</span>`;
        } else {
          const title = cfg.tx(node.item, 'title');
          const cat = cfg.tr(node.item.category);
          ui.tooltip.innerHTML = `<b>${esc(title)}</b><span>${esc(cat)}</span>`;
        }
      } else if (edge) {
        const reason = lang === 'en' ? (edge.re || edge.rz) : (edge.rz || edge.re);
        ui.tooltip.innerHTML = `<b>${esc(reason)}</b><span>${esc(shortTitle(cfg.tx(edge.a.item, 'title')))} ↔ ${esc(shortTitle(cfg.tx(edge.b.item, 'title')))}</span>`;
      }
      ui.tooltip.hidden = false;
      const tx = clamp(sx + 14, 12, Math.max(12, width - 250));
      const ty = clamp(sy + 14, 58, Math.max(58, height - 72));
      ui.tooltip.style.transform = `translate(${tx}px, ${ty}px)`;
    }

    function bindEvents() {
      canvas.addEventListener('pointerdown', e => {
        if (e.button > 0 && e.pointerType === 'mouse') return;
        ui.settings.hidden = true;
        ui.gear.setAttribute('aria-expanded', 'false');
        canvas.setPointerCapture(e.pointerId);
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        lastPointer = { x: e.clientX, y: e.clientY };
        movedDist = 0;

        if (activePointers.size === 2) {
          const pts = [...activePointers.values()];
          pinchPrevDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          dragNode = null;
          draggingCanvas = false;
          return;
        }

        const hit = hitNodeAt(sx, sy);
        if (hit) {
          dragNode = hit;
          camGoal.on = false;
          canvas.style.cursor = 'grabbing';
          wake();
        } else {
          draggingCanvas = true;
          camGoal.on = false;
          canvas.style.cursor = 'grabbing';
        }
      });

      canvas.addEventListener('pointermove', e => {
        if (activePointers.has(e.pointerId)) {
          activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }

        if (activePointers.size === 2) {
          const pts = [...activePointers.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (pinchPrevDist > 0 && dist > 0) {
            const factor = dist / pinchPrevDist;
            const rect = canvas.getBoundingClientRect();
            const midX = (pts[0].x + pts[1].x) * 0.5 - rect.left;
            const midY = (pts[0].y + pts[1].y) * 0.5 - rect.top;
            const before = screenToWorld(midX, midY);
            cam.z = clamp(cam.z * factor, 0.20, 4.5);
            const after = screenToWorld(midX, midY);
            cam.x += before.x - after.x;
            cam.y += before.y - after.y;
            wake();
          }
          pinchPrevDist = dist;
          return;
        }

        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        if (dragNode) {
          const dx = e.clientX - lastPointer.x;
          const dy = e.clientY - lastPointer.y;
          movedDist += Math.hypot(dx, dy);
          lastPointer = { x: e.clientX, y: e.clientY };
          const w = screenToWorld(sx, sy);
          dragNode.x = w.x;
          dragNode.y = w.y;
          dragNode.homeX = lerp(dragNode.homeX, w.x, 0.28);
          dragNode.homeY = lerp(dragNode.homeY, w.y, 0.28);
          physicsEnergy = 1;
          updateTooltip(sx, sy, null, null);
          wake();
          return;
        }

        if (draggingCanvas) {
          const dx = e.clientX - lastPointer.x;
          const dy = e.clientY - lastPointer.y;
          movedDist += Math.hypot(dx, dy);
          lastPointer = { x: e.clientX, y: e.clientY };
          cam.x -= dx / cam.z;
          cam.y -= dy / cam.z;
          updateTooltip(sx, sy, null, null);
          wake();
          return;
        }

        if (e.pointerType === 'mouse') {
          const hit = hitNodeAt(sx, sy);
          const edge = hit ? null : hitEdgeAt(sx, sy);
          const nextHover = hit ? hit.id : null;
          if (nextHover !== hoverId || edge !== hoverEdge) {
            hoverId = nextHover;
            hoverEdge = edge;
            canvas.style.cursor = hit ? 'pointer' : edge ? 'help' : 'grab';
            wake();
          }
          updateTooltip(sx, sy, hit, edge);
        }
      });

      const endPointer = e => {
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) pinchPrevDist = 0;

        if (dragNode || draggingCanvas) {
          const wasClick = movedDist < 6;
          const clickedNode = dragNode;
          dragNode = null;
          draggingCanvas = false;
          canvas.style.cursor = hoverId ? 'pointer' : 'grab';
          if (wasClick) {
            if (clickedNode) {
              selectNode(clickedNode.id, true);
            } else {
              selectNode(null, false);
            }
          }
          wake();
        }
      };

      canvas.addEventListener('pointerup', endPointer);
      canvas.addEventListener('pointercancel', endPointer);
      canvas.addEventListener('pointerleave', () => {
        if (hoverId || hoverEdge) {
          hoverId = null;
          hoverEdge = null;
          updateTooltip(0, 0, null, null);
          wake();
        }
      });

      canvas.addEventListener('dblclick', e => {
        const rect = canvas.getBoundingClientRect();
        const hit = hitNodeAt(e.clientX - rect.left, e.clientY - rect.top);
        if (hit && !hit.isHub) cfg.openDetail(hit.item);
      });

      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const before = screenToWorld(sx, sy);
        const factor = Math.exp(-e.deltaY * 0.0014);
        camGoal.on = false;
        cam.z = clamp(cam.z * factor, 0.20, 4.5);
        const after = screenToWorld(sx, sy);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        wake();
      }, { passive: false });

      ui.legend.addEventListener('click', e => {
        const b = e.target.closest('[data-gkind]');
        if (!b) return;
        const k = b.dataset.gkind;
        if (visibleKinds.has(k) && visibleKinds.size > 1) {
          visibleKinds.delete(k);
          b.classList.remove('active');
        } else {
          visibleKinds.add(k);
          b.classList.add('active');
        }
        if (k === 'hub') {
          showHubs = visibleKinds.has('hub');
          ui.optShowHubs.checked = showHubs;
        }
        if (selectedId && nodeById.get(selectedId) && !isNodeShown(nodeById.get(selectedId))) {
          selectNode(null, false);
        }
        updateStats();
        wake();
      });

      ui.prevHit.onclick = () => {
        if (!searchOrdered.length) return;
        searchHitIdx = (searchHitIdx - 1 + searchOrdered.length) % searchOrdered.length;
        updateSearchNav();
        selectNode(searchOrdered[searchHitIdx].id, true);
      };
      ui.nextHit.onclick = () => {
        if (!searchOrdered.length) return;
        searchHitIdx = (searchHitIdx + 1) % searchOrdered.length;
        updateSearchNav();
        selectNode(searchOrdered[searchHitIdx].id, true);
      };

      ui.gear.onclick = () => {
        const nextOpen = ui.settings.hidden;
        ui.settings.hidden = !nextOpen;
        ui.gear.setAttribute('aria-expanded', String(nextOpen));
      };
      ui.optShowHubs.onchange = () => {
        showHubs = ui.optShowHubs.checked;
        if (showHubs) visibleKinds.add('hub'); else visibleKinds.delete('hub');
        ui.legend.querySelector('[data-gkind="hub"]')?.classList.toggle('active', showHubs);
        wake();
      };
      ui.optShowSem.onchange = () => {
        showSemEdges = ui.optShowSem.checked;
        updateStats();
        wake();
      };
      ui.settings.addEventListener('click', e => {
        const seg = e.target.closest('[data-lmode]');
        if (!seg) return;
        labelMode = seg.dataset.lmode;
        ui.settings.querySelectorAll('[data-lmode]').forEach(b => b.classList.toggle('active', b === seg));
        wake();
      });
      ui.optResetLayout.onclick = () => {
        for (const n of nodes) {
          const orig = n.isHub
            ? cfg.graphData.hubs.find(h => h.id === n.id)
            : cfg.graphData.nodes.find(x => x.id === n.id);
          if (orig) {
            n.homeX = orig.x;
            n.homeY = orig.y;
          }
        }
        physicsEnergy = 1;
        fitNodes(nodes, false);
        wake();
      };

      ui.zoomIn.onclick = () => {
        flyTo(cam.x, cam.y, clamp(cam.z * 1.35, 0.20, 4.5), false);
      };
      ui.zoomOut.onclick = () => {
        flyTo(cam.x, cam.y, clamp(cam.z / 1.35, 0.20, 4.5), false);
      };
      ui.reset.onclick = () => {
        fitNodes(searchOrdered.length ? searchOrdered : nodes, false);
      };

      ui.inspector.addEventListener('click', e => {
        const closeBtn = e.target.closest('[data-gact="close"]');
        if (closeBtn) {
          selectNode(null, false);
          return;
        }
        const jumpBtn = e.target.closest('[data-gjump]');
        if (jumpBtn) {
          selectNode(jumpBtn.dataset.gjump, true);
          return;
        }
        const detailBtn = e.target.closest('[data-gdetail]');
        if (detailBtn) {
          const n = nodeById.get(detailBtn.dataset.gdetail);
          if (n && !n.isHub) cfg.openDetail(n.item);
          return;
        }
        const favBtn = e.target.closest('[data-gfav]');
        if (favBtn) {
          cfg.toggleFavoriteById(favBtn.dataset.gfav);
          return;
        }
        const gridBtn = e.target.closest('[data-ggrid]');
        if (gridBtn) {
          const [sec, top] = gridBtn.dataset.ggrid.split(':');
          cfg.jumpToGridTopic(sec, top);
        }
      });

      document.addEventListener('keydown', e => {
        if (!active || e.key !== 'Escape') return;
        if (!ui.settings.hidden) {
          ui.settings.hidden = true;
          ui.gear.setAttribute('aria-expanded', 'false');
        } else if (selectedId && !document.getElementById('detail')?.open) {
          selectNode(null, false);
        }
      });
    }

    return {
      init(options) {
        cfg = options;
        stageEl = options.stageEl;
        buildModel();
        buildUI();
        ro = new ResizeObserver(() => active && resize());
        ro.observe(stageEl);
      },

      setActive(on) {
        active = !!on;
        if (active) {
          resize();
          fitNodes(searchOrdered.length ? searchOrdered : nodes, true);
          wake();
        } else {
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
          lastFrameTime = 0;
          if (ui.tooltip) ui.tooltip.hidden = true;
          if (ui.settings) {
            ui.settings.hidden = true;
            ui.gear?.setAttribute('aria-expanded', 'false');
          }
        }
      },

      syncFilter({ category, topic, query, scopeItems }) {
        scopeCategory = category;
        scopeTopic = topic;
        searchQuery = (query || '').trim().toLowerCase();

        const itemsById = new Map(cfg.getItems().map(i => [i.id, i]));
        matchScopeIds = new Set((scopeItems || []).map(i => i.id));

        for (const n of itemNodes) {
          const latest = itemsById.get(n.id);
          if (latest) n.item = latest;
        }

        searchHits = new Set();
        searchOrdered = [];
        if (searchQuery) {
          const scored = [];
          for (const n of itemNodes) {
            if (!isItemShown(n)) continue;
            const s = cfg.searchScore(n.item, searchQuery);
            if (s > 0) {
              searchHits.add(n.id);
              scored.push({ n, s });
            }
          }
          scored.sort((a, b) => b.s - a.s);
          searchOrdered = scored.map(x => x.n);
          searchHitIdx = 0;
          pulseStart = performance.now();
        }

        if (selectedId && nodeById.get(selectedId) && !isNodeShown(nodeById.get(selectedId))) {
          selectNode(null, false);
        } else if (selectedId) {
          renderInspector();
        }

        updateStats();
        updateSearchNav();

        if (active) {
          if (searchOrdered.length && searchOrdered.length <= 25) {
            fitNodes(searchOrdered, false);
          } else if (!searchQuery) {
            fitNodes(itemNodes.filter(isItemShown), false);
          }
          wake();
        }
      },

      focusTopMatch() {
        if (!searchOrdered.length) return;
        searchHitIdx = 0;
        updateSearchNav();
        selectNode(searchOrdered[0].id, true);
      },

      refreshTheme() {
        if (active) wake();
      },

      refreshLanguage() {
        translateUI();
        if (active) wake();
      },

      refreshItems(latestItems) {
        const map = new Map(latestItems.map(i => [i.id, i]));
        for (const n of itemNodes) {
          if (map.has(n.id)) n.item = map.get(n.id);
        }
        if (selectedId) renderInspector();
        if (active) wake();
      },
    };
  }

  window.ShijuGraph = createGraph();
})();
