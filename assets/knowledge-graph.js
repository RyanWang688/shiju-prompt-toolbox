/* Obsidian-style Knowledge Graph v2: Proportional Multi-Scale Constellations & Interactive Discovery. */
(() => {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortTitle = (s, maxLen = 22) => {
    const clean = String(s || '').replace(/[（(][^）)]*[）)]/g, '').trim();
    const base = clean || String(s || '');
    return base.length > maxLen ? base.slice(0, maxLen - 2) + '…' : base;
  };

  // Colorblind-safe cluster palettes calibrated for Dark (#0b0b0e) & Light (#fafaf9) backgrounds.
  const CLUSTER_PAL_DARK = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#2dd4bf', '#fb923c', '#93c5fd', '#c084fc'];
  const CLUSTER_PAL_LIGHT = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#db2777', '#0d9488', '#ea580c', '#0284c7', '#9333ea'];

  function createGraph() {
    let cfg = null;
    let active = false;
    let stageEl = null;
    let canvas = null;
    let ctx = null;
    let ro = null;

    // Viewport & DPR
    let width = 800;
    let height = 560;
    let dpr = 1;
    let isFullscreen = false;

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
    let conceptsMap = {};
    let hubSlotBySection = new Map(); // hub.id -> palette index inside its kind section

    // Spatial hash for fast hit-testing
    const HIT_CELL = 72;
    let hitGrid = new Map();
    let hitGridDirty = true;

    // Filter, layout & UI state
    let visibleKinds = new Set(['hub', 'skill', 'website', 'prompt']);
    let showHubs = true;
    let showNebulas = true;
    let showSemEdges = true;
    let labelMode = 'smart'; // 'smart' | 'minimal' | 'dense'
    let scopeCategory = '全部内容';
    let scopeTopic = '全部';
    let layoutMode = 'global'; // 'global' | 'section'
    let depthMode = 'all'; // 'all' | 'hop2' | 'hop1'
    let localShownIds = null; // Set<string> when depthMode !== 'all'
    let hubFilterQuery = '';
    let hubConceptFilter = 'all';
    let hitDropdownOpen = false;
    let legendSignature = '';

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

    // Animation loop (strict zero idle loop)
    let rafId = 0;
    let lastFrameTime = 0;
    let pulseStart = 0;
    let pulseActiveUntil = 0;
    let physicsEnergy = 0;
    let layoutMorphing = false;
    const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let ui = {};

    function palette() {
      const dark = cfg.getTheme() === 'dark';
      return dark ? {
        dark: true,
        bg: '#0b0b0e',
        dot: 'rgba(255,255,255,0.04)',
        strokeCut: '#0b0b0e',
        hubFill: '#16161d',
        hubStroke: '#ffd43b',
        hubText: '#f4f4f5',
        skill: '#a78bfa',
        website: '#38bdf8',
        prompt: '#fbbf24',
        cluster: CLUSTER_PAL_DARK,
        edgeTopic: 'rgba(255,255,255,0.065)',
        edgeSemWeak: 'rgba(255,255,255,0.07)',
        edgeSemStrong: 'rgba(255,255,255,0.16)',
        edgeActiveSem: '#ffd43b',
        edgeActiveTopic: 'rgba(167,139,250,0.68)',
        labelText: '#e4e4e7',
        labelMuted: '#a1a1aa',
        labelBg: 'rgba(14,14,19,0.88)',
        hubLabelBg: 'rgba(22,22,29,0.94)',
        hubLabelBorder: 'rgba(255,255,255,0.16)',
        edgeBadgeBg: 'rgba(24,24,31,0.94)',
        edgeBadgeBorder: 'rgba(255,212,59,0.42)',
        edgeBadgeText: '#fde68a',
        ring: '#ffd43b',
        hitRing: '#ffffff',
      } : {
        dark: false,
        bg: '#fafaf9',
        dot: 'rgba(25,25,25,0.055)',
        strokeCut: '#fafaf9',
        hubFill: '#ffd43b',
        hubStroke: '#191919',
        hubText: '#191919',
        skill: '#6d28d9',
        website: '#0369a1',
        prompt: '#d97706',
        cluster: CLUSTER_PAL_LIGHT,
        edgeTopic: 'rgba(25,25,25,0.075)',
        edgeSemWeak: 'rgba(25,25,25,0.07)',
        edgeSemStrong: 'rgba(25,25,25,0.17)',
        edgeActiveSem: '#d97706',
        edgeActiveTopic: 'rgba(109,40,217,0.58)',
        labelText: '#191919',
        labelMuted: '#52525b',
        labelBg: 'rgba(255,255,255,0.92)',
        hubLabelBg: 'rgba(255,255,255,0.96)',
        hubLabelBorder: 'rgba(25,25,25,0.18)',
        edgeBadgeBg: 'rgba(255,253,245,0.96)',
        edgeBadgeBorder: 'rgba(217,119,6,0.45)',
        edgeBadgeText: '#92400e',
        ring: '#191919',
        hitRing: '#d97706',
      };
    }

    function clusterColorForHub(hubId, pal) {
      const slot = hubSlotBySection.get(hubId);
      if (slot === undefined) return pal.hubStroke;
      return pal.cluster[slot % pal.cluster.length];
    }

    function nodeColor(n, pal) {
      if (n.isHub) {
        return layoutMode === 'section' ? clusterColorForHub(n.id, pal) : pal.hubFill;
      }
      if (layoutMode === 'section') {
        return clusterColorForHub(n.hub, pal);
      }
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

    function rebuildHitGrid() {
      hitGrid = new Map();
      for (const n of nodes) {
        const cx = Math.floor(n.x / HIT_CELL);
        const cy = Math.floor(n.y / HIT_CELL);
        const key = `${cx},${cy}`;
        let list = hitGrid.get(key);
        if (!list) {
          list = [];
          hitGrid.set(key, list);
        }
        list.push(n);
      }
      hitGridDirty = false;
    }

    function flyTo(wx, wy, targetZ, offsetForInspector = true) {
      const z = targetZ ?? clamp(Math.max(cam.z, 1.05), 0.42, 2.2);
      const offX = offsetForInspector && width > 720 && selectedId ? 158 / z : 0;
      const offY = offsetForInspector && width <= 720 && selectedId ? (height * 0.14) / z : 0;
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
        const tx = n.targetX ?? n.x;
        const ty = n.targetY ?? n.y;
        const pad = n.isHub ? Math.min(80, ((n.targetTr ?? n.curTr) || 40) * 0.35) : 14;
        if (tx - pad < minX) minX = tx - pad;
        if (tx + pad > maxX) maxX = tx + pad;
        if (ty - pad < minY) minY = ty - pad;
        if (ty + pad > maxY) maxY = ty + pad;
      }
      const isNarrow = width < 520;
      const inspOpenDesktop = selectedId && width > 720;
      const inspOpenMobile = selectedId && width <= 720;
      const spanX = Math.max(190, maxX - minX + (isNarrow ? 90 : 140));
      const spanY = Math.max(170, maxY - minY + (isNarrow ? 110 : 140));
      const padW = inspOpenDesktop ? Math.max(220, width - 380) : Math.max(170, width - (isNarrow ? 30 : 68));
      const padH = inspOpenMobile ? Math.max(150, height * 0.46) : Math.max(200, height - (isNarrow ? 105 : 108));
      const targetZ = clamp(Math.min(padW / spanX, padH / spanY), 0.22, depthMode === 'hop1' ? 1.25 : searchHits.size ? 1.35 : 1.02);
      const cx = (minX + maxX) * 0.5 + (inspOpenDesktop ? 158 / targetZ : 0);
      const cy = (minY + maxY) * 0.5 + (inspOpenMobile ? (height * 0.14) / targetZ : -6 / targetZ);
      if (instant || reduceMotion()) {
        cam.x = cx;
        cam.y = cy;
        cam.z = targetZ;
        camGoal.on = false;
        draw();
      } else {
        camGoal.x = cx;
        camGoal.y = cy;
        camGoal.z = targetZ;
        camGoal.on = true;
        wake();
      }
    }

    function isNodeShown(n) {
      if (localShownIds && !localShownIds.has(n.id)) return false;
      if (n.isHub) {
        if (!showHubs || !visibleKinds.has('hub')) return false;
        const list = adj.get(n.id) || [];
        return list.some(rel => isItemShown(rel.node));
      }
      return isItemShown(n);
    }

    function isItemShown(n) {
      if (localShownIds && !localShownIds.has(n.id)) return false;
      if (!visibleKinds.has(n.kind)) return false;
      if (!matchScopeIds.has(n.id)) return false;
      return true;
    }

    function computeLocalSet() {
      if (!selectedId || depthMode === 'all') {
        localShownIds = null;
        return;
      }
      const center = nodeById.get(selectedId);
      if (!center) {
        localShownIds = null;
        return;
      }
      const set = new Set([center.id]);
      const directItems = [];

      for (const rel of (adj.get(center.id) || [])) {
        if (rel.node.isHub) {
          if (showHubs) set.add(rel.node.id);
        } else if (visibleKinds.has(rel.node.kind) && matchScopeIds.has(rel.node.id)) {
          set.add(rel.node.id);
          directItems.push(rel.node);
        }
      }

      if (depthMode === 'hop2') {
        const candidates2 = new Map();
        for (const nb of directItems.slice(0, 20)) {
          for (const rel of (adj.get(nb.id) || [])) {
            const target = rel.node;
            if (target.isHub || set.has(target.id)) continue;
            if (!visibleKinds.has(target.kind) || !matchScopeIds.has(target.id)) continue;
            const sc = (rel.w || 0.3) + (target.imp || 0) * 0.35;
            if (!candidates2.has(target.id) || sc > candidates2.get(target.id)) {
              candidates2.set(target.id, sc);
            }
          }
        }
        [...candidates2.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 34)
          .forEach(([id]) => set.add(id));
      }
      localShownIds = set;
    }

    function applyLayoutTargets(instant = false) {
      computeLocalSet();
      const useSection = layoutMode === 'section';
      const sel = selectedId ? nodeById.get(selectedId) : null;

      // Default base coordinates (global vs section)
      for (const n of nodes) {
        n.targetX = useSection ? n.sx : n.gx;
        n.targetY = useSection ? n.sy : n.gy;
        if (n.isHub) n.targetTr = useSection ? n.str : n.gtr;
      }

      // Clean radial ego arrangement when viewing 1-hop neighborhood of a node
      if (depthMode === 'hop1' && sel && !sel.isHub && localShownIds) {
        sel.targetX = 0;
        sel.targetY = 0;
        const semNbs = (adj.get(sel.id) || [])
          .filter(r => r.k === 'r' && !r.node.isHub && localShownIds.has(r.node.id))
          .sort((a, b) => b.w - a.w);
        const hubsNbs = (adj.get(sel.id) || [])
          .filter(r => r.k === 't' && r.node.isHub && localShownIds.has(r.node.id));
        const ringR = clamp(128 + semNbs.length * 16, 132, 240);
        const nSem = semNbs.length;
        semNbs.forEach((rel, idx) => {
          const ang = -Math.PI * 0.5 + (2 * Math.PI * idx) / Math.max(1, nSem);
          const dist = ringR * (0.94 + (1 - rel.w) * 0.24);
          rel.node.targetX = Math.cos(ang) * dist * 1.18;
          rel.node.targetY = Math.sin(ang) * dist * 0.92;
        });
        hubsNbs.forEach((rel, idx) => {
          const ang = Math.PI * 0.5 + (idx - (hubsNbs.length - 1) * 0.5) * 0.65;
          const dist = ringR + 68;
          rel.node.targetX = Math.cos(ang) * dist * 1.1;
          rel.node.targetY = Math.sin(ang) * dist * 0.85;
        });
      } else if (depthMode === 'hop1' && sel && sel.isHub && localShownIds) {
        const cx = useSection ? sel.sx : sel.gx;
        const cy = useSection ? sel.sy : sel.gy;
        for (const n of nodes) {
          if (localShownIds.has(n.id)) {
            n.targetX -= cx;
            n.targetY -= cy;
          }
        }
      }

      const immediate = instant || reduceMotion();
      for (const n of nodes) {
        n.homeX = n.targetX;
        n.homeY = n.targetY;
        if (immediate) {
          n.x = n.targetX;
          n.y = n.targetY;
          n.vx = 0;
          n.vy = 0;
          if (n.isHub) n.curTr = n.targetTr;
        }
      }
      layoutMorphing = !immediate;
      hitGridDirty = true;
    }

    function buildModel() {
      const g = cfg.graphData;
      const itemsById = new Map(cfg.getItems().map(i => [i.id, i]));
      conceptsMap = g.concepts || {};
      nodes = [];
      nodeById = new Map();
      itemNodes = [];
      hubNodes = [];
      edges = [];
      adj = new Map();
      hubSlotBySection = new Map();

      const topicSeen = new Map();
      const slotCounters = new Map();
      for (const h of g.hubs) {
        topicSeen.set(h.topic, (topicSeen.get(h.topic) || 0) + 1);
        const slot = slotCounters.get(h.kind) || 0;
        slotCounters.set(h.kind, slot + 1);
        hubSlotBySection.set(h.id, slot);
      }
      dupHubTopics = new Set([...topicSeen.entries()].filter(([, c]) => c > 1).map(([t]) => t));

      for (const h of g.hubs) {
        const gx = h.x;
        const gy = h.y;
        const sx = h.sx ?? gx;
        const sy = h.sy ?? gy;
        const gtr = h.tr || 160;
        const str = h.str ?? gtr;
        const node = {
          id: h.id,
          isHub: true,
          kind: h.kind,
          topic: h.topic,
          count: h.count,
          gx, gy, sx, sy, gtr, str,
          curTr: gtr, targetTr: gtr,
          x: gx, y: gy, homeX: gx, homeY: gy, targetX: gx, targetY: gy,
          vx: 0, vy: 0,
          r: 13 + Math.min(10, Math.sqrt(h.count) * 1.1),
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
        const imp = n.imp ?? Math.min(1, (n.deg || 0) / 6);
        const gx = n.x;
        const gy = n.y;
        const sx = n.sx ?? gx;
        const sy = n.sy ?? gy;
        const node = {
          id: n.id,
          isHub: false,
          item,
          kind,
          hub: n.hub,
          deg: n.deg || 0,
          imp,
          concept: n.c || '',
          gx, gy, sx, sy,
          x: gx, y: gy, homeX: gx, homeY: gy, targetX: gx, targetY: gy,
          vx: 0, vy: 0,
          r: 4.3 + imp * 4.6,
          focusAlpha: 1,
        };
        nodes.push(node);
        itemNodes.push(node);
        nodeById.set(node.id, node);
        adj.set(node.id, []);
      }

      g.edges.forEach((e, idx) => {
        const a = nodeById.get(e.s);
        const b = nodeById.get(e.t);
        if (!a || !b) return;
        const edge = {
          idx,
          a, b,
          k: e.k,
          w: e.w || 0.4,
          rz: e.rz || '',
          re: e.re || '',
          curveSign: idx % 2 === 0 ? 1 : -1,
        };
        edges.push(edge);
        adj.get(a.id).push({ node: b, edge, w: edge.w, k: edge.k });
        adj.get(b.id).push({ node: a, edge, w: edge.w, k: edge.k });
      });

      for (const [, list] of adj) {
        list.sort((x, y) => (x.k === y.k ? y.w - x.w : x.k === 'r' ? -1 : 1));
      }
      hitGridDirty = true;
    }

    function hubDisplayLabel(h) {
      const base = cfg.tr(h.topic);
      if (layoutMode === 'section' || !dupHubTopics.has(h.topic)) return `${base} (${h.count})`;
      const sec = h.kind === 'skill' ? 'Skills' : h.kind === 'website' ? cfg.tr('网站') : cfg.tr('提示词');
      return `${sec}·${base} (${h.count})`;
    }

    function conceptLabel(cid) {
      const pair = conceptsMap[cid];
      if (!pair) return '';
      return cfg.getLang() === 'en' ? (pair[1] || pair[0]) : pair[0];
    }

    function buildUI() {
      stageEl.innerHTML = `
        <canvas class="graph-canvas"></canvas>
        <div class="graph-topbar">
          <div class="graph-legend" id="graphLegend" role="group" aria-label="节点图例"></div>
          <div class="graph-depth-switch" id="graphDepthSwitch" role="group" aria-label="按 1/2/0 切换深度" hidden>
            <button type="button" class="graph-depth-btn active" data-depth="all" data-gi="全图"></button>
            <button type="button" class="graph-depth-btn" data-depth="hop2" data-gi="2 跳"></button>
            <button type="button" class="graph-depth-btn" data-depth="hop1" data-gi="1 跳"></button>
          </div>
          <div class="graph-search-nav" id="graphSearchNav" hidden>
            <button type="button" class="graph-hit-trigger" id="graphHitTrigger" aria-expanded="false" aria-controls="graphHitList">
              <span class="graph-hit-label" id="graphHitLabel"></span>
              <span class="graph-hit-caret" aria-hidden="true">▾</span>
            </button>
            <button type="button" class="graph-btn" id="graphPrevHit" aria-label="上一个">‹</button>
            <button type="button" class="graph-btn" id="graphNextHit" aria-label="下一个">›</button>
            <div class="graph-hit-dropdown" id="graphHitList" hidden role="listbox" aria-label="命中列表"></div>
          </div>
          <div class="graph-top-right">
            <button type="button" class="graph-expand" id="graphExpand" aria-pressed="false" aria-label="展开全屏">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            </button>
            <button type="button" class="graph-gear" id="graphGear" aria-expanded="false" aria-controls="graphSettings" aria-label="图谱设置">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </div>
        <div class="graph-settings" id="graphSettings" hidden>
          <div class="graph-set-row"><span data-gi="显示主题中心"></span><input type="checkbox" id="optShowHubs" checked></div>
          <div class="graph-set-row"><span data-gi="显示簇光晕"></span><input type="checkbox" id="optShowNebulas" checked></div>
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
        <div class="graph-hint" data-gi="快捷键：滚轮缩放，点击节点聚焦，1/2/0 切局部子网"></div>
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
        depthSwitch: stageEl.querySelector('#graphDepthSwitch'),
        controls: stageEl.querySelector('#graphControls'),
        searchNav: stageEl.querySelector('#graphSearchNav'),
        hitTrigger: stageEl.querySelector('#graphHitTrigger'),
        hitLabel: stageEl.querySelector('#graphHitLabel'),
        hitList: stageEl.querySelector('#graphHitList'),
        prevHit: stageEl.querySelector('#graphPrevHit'),
        nextHit: stageEl.querySelector('#graphNextHit'),
        expand: stageEl.querySelector('#graphExpand'),
        gear: stageEl.querySelector('#graphGear'),
        settings: stageEl.querySelector('#graphSettings'),
        optShowHubs: stageEl.querySelector('#optShowHubs'),
        optShowNebulas: stageEl.querySelector('#optShowNebulas'),
        optShowSem: stageEl.querySelector('#optShowSem'),
        optResetLayout: stageEl.querySelector('#optResetLayout'),
        inspector: stageEl.querySelector('#graphInspector'),
        tooltip: stageEl.querySelector('#graphTooltip'),
        zoomIn: stageEl.querySelector('#graphZoomIn'),
        zoomOut: stageEl.querySelector('#graphZoomOut'),
        reset: stageEl.querySelector('#graphReset'),
      };

      bindEvents();
      rebuildLegend(true);
      translateUI();
    }

    function rebuildLegend(force = false) {
      if (!ui.legend) return;
      const pal = palette();
      const lang = cfg.getLang();
      const secKind = (cfg.sectionKind || { Skills: 'skill', 提示词: 'prompt', 实用网站: 'website' })[scopeCategory];
      const sig = `${layoutMode}|${secKind || 'all'}|${lang}|${pal.dark ? 'd' : 'l'}|${scopeTopic}|${matchScopeIds.size}`;
      if (!force && legendSignature === sig) {
        updateLegendActiveStates();
        return;
      }
      legendSignature = sig;

      if (layoutMode === 'section' && secKind) {
        const secHubs = hubNodes.filter(h => h.kind === secKind);
        const pills = secHubs.map(h => {
          const liveCount = (adj.get(h.id) || []).filter(r => !r.node.isHub && matchScopeIds.has(r.node.id)).length;
          if (!liveCount) return '';
          const c = clusterColorForHub(h.id, pal);
          return `<button type="button" class="graph-pill active" data-ghub="${esc(h.id)}"><i class="dot" style="background:${esc(c)}"></i><span>${esc(cfg.tr(h.topic))}</span><small class="graph-pill-n">${liveCount}</small></button>`;
        }).join('');
        ui.legend.innerHTML = `${pills}<span class="graph-stat" id="graphStat"></span>`;
      } else {
        ui.legend.innerHTML = `
          <button type="button" class="graph-pill ${visibleKinds.has('hub') ? 'active' : ''}" data-gkind="hub"><i class="dot dot-hub"></i><span data-gi="主题中心">${esc(cfg.tr('主题中心'))}</span></button>
          <button type="button" class="graph-pill ${visibleKinds.has('skill') ? 'active' : ''}" data-gkind="skill"><i class="dot dot-skill"></i><span>Skills</span></button>
          <button type="button" class="graph-pill ${visibleKinds.has('website') ? 'active' : ''}" data-gkind="website"><i class="dot dot-website"></i><span data-gi="实用网站">${esc(cfg.tr('实用网站'))}</span></button>
          <button type="button" class="graph-pill ${visibleKinds.has('prompt') ? 'active' : ''}" data-gkind="prompt"><i class="dot dot-prompt"></i><span data-gi="提示词">${esc(cfg.tr('提示词'))}</span></button>
          <span class="graph-stat" id="graphStat"></span>
        `;
      }
      ui.stat = stageEl.querySelector('#graphStat');
      updateLegendActiveStates();
      updateStats();
    }

    function updateLegendActiveStates() {
      if (!ui.legend) return;
      if (layoutMode === 'section') {
        const selNode = selectedId ? nodeById.get(selectedId) : null;
        const activeHubId = selNode ? (selNode.isHub ? selNode.id : selNode.hub) : null;
        ui.legend.querySelectorAll('[data-ghub]').forEach(btn => {
          const on = !activeHubId || btn.dataset.ghub === activeHubId;
          btn.classList.toggle('active', on);
          btn.classList.toggle('is-focused', btn.dataset.ghub === selectedId);
          btn.setAttribute('aria-pressed', String(btn.dataset.ghub === selectedId));
        });
      } else {
        ui.legend.querySelectorAll('[data-gkind]').forEach(btn => {
          btn.classList.toggle('active', visibleKinds.has(btn.dataset.gkind));
        });
      }
    }

    function updateDepthControls() {
      if (!ui.depthSwitch) return;
      const show = !!selectedId && !!nodeById.get(selectedId);
      ui.depthSwitch.hidden = !show;
      ui.depthSwitch.querySelectorAll('[data-depth]').forEach(b => {
        const activeBtn = b.dataset.depth === depthMode;
        b.classList.toggle('active', activeBtn);
        b.setAttribute('aria-pressed', String(activeBtn));
      });
    }

    function translateUI() {
      if (!ui.legend) return;
      rebuildLegend(true);
      stageEl.querySelectorAll('[data-gi]').forEach(el => {
        el.textContent = cfg.tr(el.dataset.gi);
      });
      ui.legend.setAttribute('aria-label', cfg.tr('节点图例'));
      ui.depthSwitch.setAttribute('aria-label', cfg.tr('按 1/2/0 切换深度'));
      ui.controls.setAttribute('aria-label', cfg.tr('缩放控制'));
      ui.inspector.setAttribute('aria-label', cfg.tr('节点详情'));
      ui.zoomIn.setAttribute('aria-label', cfg.tr('放大'));
      ui.zoomOut.setAttribute('aria-label', cfg.tr('缩小'));
      ui.reset.setAttribute('aria-label', cfg.tr('重置视图'));
      ui.gear.setAttribute('aria-label', cfg.tr('图谱设置'));
      ui.expand.setAttribute('aria-label', cfg.tr(isFullscreen ? '退出全屏' : '展开全屏'));
      ui.prevHit.setAttribute('aria-label', cfg.tr('上一个'));
      ui.nextHit.setAttribute('aria-label', cfg.tr('下一个'));
      ui.hitList.setAttribute('aria-label', cfg.tr('命中列表'));
      updateStats();
      updateSearchNav();
      updateDepthControls();
      if (selectedId) renderInspector();
    }

    function updateStats() {
      if (!ui.stat) return;
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

    function closeHitDropdown() {
      hitDropdownOpen = false;
      if (ui.hitList) ui.hitList.hidden = true;
      ui.hitTrigger?.setAttribute('aria-expanded', 'false');
    }

    function renderHitDropdown() {
      if (!ui.hitList) return;
      const pal = palette();
      ui.hitList.innerHTML = searchOrdered.slice(0, 30).map((n, idx) => {
        const dotColor = nodeColor(n, pal);
        const cur = idx === searchHitIdx;
        const badge = n.item.kind === 'skill'
          ? cfg.tr(cfg.topicsFor(n.item)[0] || 'Skills')
          : n.item.kind === 'website'
            ? cfg.tr('网站')
            : cfg.tr('提示词');
        return `<button type="button" class="graph-hit-item${cur ? ' active' : ''}" role="option" aria-selected="${cur}" data-hit-idx="${idx}"><i class="dot" style="background:${esc(dotColor)}"></i><span class="ghi-title">${esc(cfg.tx(n.item, 'title'))}</span><small class="ghi-badge">${esc(badge)}</small></button>`;
      }).join('');
    }

    function updateSearchNav() {
      if (!ui.searchNav) return;
      if (!searchQuery || !searchOrdered.length) {
        ui.searchNav.hidden = true;
        closeHitDropdown();
        return;
      }
      ui.searchNav.hidden = false;
      const cur = searchOrdered[searchHitIdx] || searchOrdered[0];
      const t = cur ? shortTitle(cfg.tx(cur.item, 'title'), 18) : '';
      ui.hitLabel.textContent = `${cfg.tr('命中 {n} 个节点').replace('{n}', searchOrdered.length)} · ${searchHitIdx + 1}/${searchOrdered.length}「${t}」`;
      ui.hitTrigger.setAttribute('aria-label', cfg.tr(hitDropdownOpen ? '收起命中列表' : '展开命中列表'));
      if (hitDropdownOpen) renderHitDropdown();
    }

    function setDepthMode(nextDepth, doFit = true) {
      if (!['all', 'hop2', 'hop1'].includes(nextDepth)) return;
      if (!selectedId && nextDepth !== 'all') return;
      depthMode = nextDepth;
      applyLayoutTargets(false);
      updateDepthControls();
      updateStats();
      if (selectedId) renderInspector();
      if (doFit) {
        if (depthMode !== 'all') {
          fitNodes([...(localShownIds || [])].map(id => nodeById.get(id)).filter(Boolean), false);
        } else {
          const sel = nodeById.get(selectedId);
          if (sel) flyTo(sel.targetX, sel.targetY, sel.isHub ? 0.92 : 1.32, true);
        }
      }
      wake();
    }

    function selectNode(id, doFly = true) {
      const prevId = selectedId;
      selectedId = id;
      stageEl?.classList.toggle('has-inspector', !!id);
      if (prevId !== id) {
        hubFilterQuery = '';
        hubConceptFilter = 'all';
      }
      if (!id) {
        const hadLocal = depthMode !== 'all';
        depthMode = 'all';
        if (hadLocal) applyLayoutTargets(false);
        ui.inspector.hidden = true;
        ui.inspector.innerHTML = '';
        updateLegendActiveStates();
        updateDepthControls();
        updateStats();
        if (hadLocal) fitNodes(itemNodes.filter(isItemShown), false);
        wake();
        return;
      }
      const n = nodeById.get(id);
      if (!n) return;
      if (depthMode !== 'all') {
        applyLayoutTargets(false);
      }
      updateLegendActiveStates();
      updateDepthControls();
      updateStats();
      renderInspector();
      if (doFly) {
        if (depthMode !== 'all') {
          fitNodes([...(localShownIds || [])].map(xid => nodeById.get(xid)).filter(Boolean), false);
        } else if (n.isHub) {
          // Frame the entire cluster when selecting a hub
          const members = (adj.get(n.id) || [])
            .filter(r => !r.node.isHub && isItemShown(r.node))
            .map(r => r.node);
          if (members.length >= 2) {
            fitNodes([n, ...members], false);
          } else {
            flyTo(n.targetX ?? n.x, n.targetY ?? n.y, clamp(Math.max(cam.z, 0.9), 0.7, 1.35), true);
          }
        } else {
          flyTo(n.targetX ?? n.x, n.targetY ?? n.y, clamp(Math.max(cam.z, 1.28), 0.95, 2.1), true);
        }
      } else {
        wake();
      }
    }

    function filterAndRenderHubRows(n, allMembers) {
      const listEl = ui.inspector.querySelector('.gi-rels');
      const countEl = ui.inspector.querySelector('.gi-hub-count');
      if (!listEl) return;
      const pal = palette();
      const q = hubFilterQuery.trim().toLowerCase();
      const shown = allMembers.filter(m => {
        if (hubConceptFilter !== 'all' && m.node.concept !== hubConceptFilter) return false;
        if (!q) return true;
        const hay = `${cfg.tx(m.node.item, 'title')} ${cfg.tx(m.node.item, 'tags') || ''} ${cfg.tx(m.node.item, 'description') || ''}`.toLowerCase();
        return hay.includes(q);
      });
      if (countEl) countEl.textContent = String(shown.length);
      listEl.innerHTML = shown.length ? shown.map(m => {
        const cText = m.node.concept ? conceptLabel(m.node.concept) : cfg.tr(m.node.kind === 'skill' ? 'Skill' : m.node.kind === 'website' ? '网站' : '提示词');
        const dotC = nodeColor(m.node, pal);
        return `
          <button type="button" class="graph-rel-item" data-gjump="${esc(m.node.id)}">
            <span class="gi-rel-main"><i class="gi-sim-dot" style="background:${esc(dotC)}"></i><span class="gi-rel-name">${esc(cfg.tx(m.node.item, 'title'))}</span></span>
            <small class="gi-rel-reason">${esc(cText)}</small>
          </button>
        `;
      }).join('') : `<div class="gi-empty-rel">${esc(cfg.tr('暂无匹配条目'))}</div>`;
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
      const pal = palette();

      if (n.isHub) {
        // Ignore depth restriction when enumerating hub members so full cluster list stays browseable
        const members = (adj.get(n.id) || [])
          .filter(x => !x.node.isHub && visibleKinds.has(x.node.kind) && matchScopeIds.has(x.node.id))
          .sort((a, b) => (b.node.imp - a.node.imp) || (b.node.deg - a.node.deg));
        const sectionName = n.kind === 'skill' ? 'Skills' : n.kind === 'website' ? '实用网站' : '提示词';
        const notePair = cfg.categoryNotes?.[sectionName + '/' + n.topic];
        const note = notePair ? notePair[lang === 'en' ? 1 : 0] : '';

        // Compute top sub-concept clusters inside this hub
        const conceptCounts = new Map();
        for (const m of members) {
          if (m.node.concept) {
            conceptCounts.set(m.node.concept, (conceptCounts.get(m.node.concept) || 0) + 1);
          }
        }
        const subConcepts = [...conceptCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 7);

        const subChipsHtml = subConcepts.length >= 2 ? `
          <div class="gi-subchips" role="group" aria-label="${esc(cfg.tr('主题簇'))}">
            <button type="button" class="gi-subchip${hubConceptFilter === 'all' ? ' active' : ''}" data-gconcept="all">${esc(cfg.tr('全部'))} (${members.length})</button>
            ${subConcepts.map(([cid, cnt]) => `<button type="button" class="gi-subchip${hubConceptFilter === cid ? ' active' : ''}" data-gconcept="${esc(cid)}">${esc(conceptLabel(cid))} (${cnt})</button>`).join('')}
          </div>
        ` : '';

        const filterInputHtml = members.length > 8 ? `
          <div class="gi-filter-wrap">
            <input type="search" id="giFilterInput" class="gi-filter-input" value="${esc(hubFilterQuery)}" placeholder="${esc(cfg.tr('在当前主题内筛选…'))}" aria-label="${esc(cfg.tr('在当前主题内筛选…'))}">
          </div>
        ` : '';

        const hubColor = clusterColorForHub(n.id, pal);
        const isClusterFocused = depthMode === 'hop1' && selectedId === n.id;

        ui.inspector.innerHTML = `
          <div class="gi-head">
            <span class="gi-badge${layoutMode === 'section' ? '' : ' gi-hub'}"><i class="gi-hub-dot" style="${layoutMode === 'section' ? `background:${esc(hubColor)};width:8px;height:8px;opacity:1` : ''}"></i>${esc(cfg.tr('主题中心'))} · ${esc(cfg.tr(sectionName))}</span>
            <button type="button" class="graph-close" data-gact="close" aria-label="${esc(cfg.tr('关闭面板'))}">×</button>
          </div>
          <div class="gi-scroll">
            <h3 class="gi-title">${esc(cfg.tr(n.topic))} <small class="gi-title-n">(${members.length})</small></h3>
            ${note ? `<p class="gi-desc">${esc(note)}</p>` : ''}
            ${subChipsHtml}
            ${filterInputHtml}
            <div class="gi-sec-label">${esc(cfg.tr('关联内容'))} (<span class="gi-hub-count">${members.length}</span>)</div>
            <div class="gi-rels"></div>
          </div>
          <div class="gi-foot">
            <button type="button" class="graph-btn gi-local-btn" data-glocal="${esc(n.id)}">${esc(cfg.tr(isClusterFocused ? '退出聚焦' : '聚焦簇子网'))}</button>
            <button type="button" class="primary gi-primary" data-ggrid="${esc(sectionName)}:${esc(n.topic)}">${esc(cfg.tr('在卡片视图中浏览'))}</button>
          </div>
        `;
        ui.inspector.hidden = false;
        stageEl?.classList.add('has-inspector');
        filterAndRenderHubRows(n, members);

        const fi = ui.inspector.querySelector('#giFilterInput');
        if (fi) {
          fi.oninput = () => {
            hubFilterQuery = fi.value;
            filterAndRenderHubRows(n, members);
          };
        }
        return;
      }

      const item = n.item;
      const title = cfg.tx(item, 'title');
      const desc = cfg.tx(item, 'description') || cfg.tr('一条新收录的灵感。');
      const tags = cfg.tx(item, 'tags') || '';
      const cover = cfg.coverOf(item) || (item.preview?.type === 'image' && /^assets\/[a-zA-Z0-9_./-]+$/.test(item.preview.src) && !item.preview.src.includes('..') ? item.preview.src : '');
      const kindLabel = item.kind === 'website' ? cfg.tr('网站') : item.kind === 'skill' ? cfg.tr(item.resourceType || 'Skill') : cfg.tr('提示词');

      // Always show up to 10 semantic neighbors regardless of local hop view
      const rels = (adj.get(n.id) || [])
        .filter(x => x.k === 'r' && !x.node.isHub && visibleKinds.has(x.node.kind) && matchScopeIds.has(x.node.id))
        .slice(0, 10);
      const hubs = (adj.get(n.id) || []).filter(x => x.k === 't' && x.node.isHub);

      const links = cfg.resourceLinks(item);
      const visitHtml = links.length
        ? `<a class="visit-site gi-visit" href="${esc(links[0].url)}" target="_blank" rel="noopener noreferrer">${esc(cfg.tr('访问官网'))} ↗</a>`
        : '';
      const isHop1 = depthMode === 'hop1';
      const cLabel = n.concept ? conceptLabel(n.concept) : '';

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
          <div class="gi-action-row">
            <button type="button" class="graph-btn gi-local-btn${isHop1 ? ' is-active' : ''}" data-gdepth-toggle="hop1">${esc(cfg.tr(isHop1 ? '返回全图' : '1 跳局部图谱'))}</button>
            ${cLabel ? `<span class="gi-concept-tag">${esc(cLabel)}</span>` : ''}
          </div>
          <div class="gi-depth-seg" role="group" aria-label="${esc(cfg.tr('按 1/2/0 切换深度'))}">
            <button type="button" class="graph-seg-btn${depthMode === 'all' ? ' active' : ''}" data-depth="all">${esc(cfg.tr('全图'))}</button>
            <button type="button" class="graph-seg-btn${depthMode === 'hop2' ? ' active' : ''}" data-depth="hop2">${esc(cfg.tr('2 跳'))}</button>
            <button type="button" class="graph-seg-btn${depthMode === 'hop1' ? ' active' : ''}" data-depth="hop1">${esc(cfg.tr('1 跳'))}</button>
          </div>
          ${hubs.length ? `<div class="gi-hubs">${hubs.map(h => `<button type="button" class="graph-rel-item gi-hub-chip" data-gjump="${esc(h.node.id)}"># ${esc(cfg.tr(h.node.topic))}</button>`).join('')}</div>` : ''}
          <div class="gi-sec-label">${esc(cfg.tr('关联内容'))} (${rels.length})</div>
          <div class="gi-rels">
            ${rels.length ? rels.map(r => {
              const dotC = nodeColor(r.node, pal);
              return `
                <button type="button" class="graph-rel-item" data-gjump="${esc(r.node.id)}">
                  <span class="gi-rel-main"><i class="gi-sim-dot" style="background:${esc(dotC)}"></i><span class="gi-rel-name">${esc(cfg.tx(r.node.item, 'title'))}</span></span>
                  <small class="gi-rel-reason">${esc(lang === 'en' ? (r.edge.re || r.edge.rz) : (r.edge.rz || r.edge.re))}</small>
                </button>
              `;
            }).join('') : `<div class="gi-empty-rel">${esc(cfg.tr('暂无强语义直连，点击上方主题可查看同类内容。'))}</div>`}
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
      if (hitGridDirty) rebuildHitGrid();
      const w = screenToWorld(sx, sy);
      const gx = Math.floor(w.x / HIT_CELL);
      const gy = Math.floor(w.y / HIT_CELL);
      const invZ = 1 / cam.z;
      let best = null;
      let bestDist = Infinity;

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = hitGrid.get(`${gx + dx},${gy + dy}`);
          if (!list) continue;
          for (const n of list) {
            if (!isNodeShown(n)) continue;
            const hitR = (n.r * (n.id === selectedId || n.id === hoverId ? 1.35 : 1.0)) + Math.max(8, 13 * invZ);
            const rx = w.x - n.x;
            const ry = w.y - n.y;
            const d2 = rx * rx + ry * ry;
            if (d2 <= hitR * hitR && d2 < bestDist) {
              best = n;
              bestDist = d2;
            }
          }
        }
      }
      return best;
    }

    function edgeBezierPoints(e, p1, p2) {
      const mx = (p1.x + p2.x) * 0.5;
      const my = (p1.y + p2.y) * 0.5;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const bend = e.curveSign * Math.min(34, len * 0.11);
      const cx = mx + (-dy / len) * bend;
      const cy = my + (dx / len) * bend;
      const bx = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
      const by = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;
      return { cx, cy, bx, by, len };
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
        const { bx, by } = edgeBezierPoints(e, p1, p2);
        const d = Math.min(
          distPointToSeg(sx, sy, p1.x, p1.y, bx, by),
          distPointToSeg(sx, sy, bx, by, p2.x, p2.y)
        );
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      return best;
    }

    function stepPhysics(dt) {
      let moved = false;

      if (layoutMorphing) {
        const kMorph = 1 - Math.exp(-11 * dt);
        let maxErr = 0;
        for (const n of nodes) {
          if (n === dragNode) continue;
          const dx = n.targetX - n.x;
          const dy = n.targetY - n.y;
          const err = Math.hypot(dx, dy);
          if (err > 0.35) {
            n.x = lerp(n.x, n.targetX, kMorph);
            n.y = lerp(n.y, n.targetY, kMorph);
            if (err > maxErr) maxErr = err;
          } else {
            n.x = n.targetX;
            n.y = n.targetY;
          }
          if (n.isHub) {
            n.curTr = lerp(n.curTr, n.targetTr, kMorph);
            if (Math.abs(n.curTr - n.targetTr) > 0.5) maxErr = Math.max(maxErr, 2);
          }
        }
        hitGridDirty = true;
        if (maxErr > 0.35) moved = true;
        else layoutMorphing = false;
      }

      if (!dragNode && physicsEnergy <= 0.015) return moved;
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

      if (!layoutMorphing) {
        for (const n of nodes) {
          if (n === dragNode) continue;
          if (Math.abs(n.x - n.homeX) > 0.2 || Math.abs(n.y - n.homeY) > 0.2 || Math.abs(n.vx) > 0.02 || Math.abs(n.vy) > 0.02) {
            n.vx = (n.vx + (n.homeX - n.x) * kHome * (dt * 60 * 0.45)) * 0.82;
            n.vy = (n.vy + (n.homeY - n.y) * kHome * (dt * 60 * 0.45)) * 0.82;
            n.x += n.vx;
            n.y += n.vy;
            const sp = Math.hypot(n.vx, n.vy) + Math.hypot(n.homeX - n.x, n.homeY - n.y) * 0.05;
            if (sp > maxV) maxV = sp;
            hitGridDirty = true;
          }
        }
      }

      physicsEnergy = maxV;
      return moved || !!dragNode || physicsEnergy > 0.015;
    }

    function draw(now = performance.now()) {
      if (!ctx || !active) return;
      const pal = palette();
      const lang = cfg.getLang();
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background + subtle dot grid
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, width, height);

      const step = 38 * cam.z;
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
      const isPulsing = hasSearch && !reduceMotion() && now < pulseActiveUntil;
      const pulsePhase = isPulsing ? (0.5 + 0.5 * Math.sin((now - pulseStart) * 0.0045)) : 1;

      // 1. Soft constellation nebulas around visible topic hubs
      if (showNebulas && showHubs && depthMode === 'all' && cam.z < 1.9) {
        const zoomFade = cam.z > 1.35 ? clamp(1 - (cam.z - 1.35) / 0.55, 0, 1) : 1;
        for (const h of hubNodes) {
          if (!isNodeShown(h)) continue;
          const p = worldToScreen(h.x, h.y);
          const screenR = h.curTr * cam.z;
          if (p.x + screenR < -20 || p.x - screenR > width + 20 || p.y + screenR < -20 || p.y - screenR > height + 20) {
            continue;
          }
          const baseColor = layoutMode === 'section'
            ? clusterColorForHub(h.id, pal)
            : (h.kind === 'skill' ? pal.skill : h.kind === 'website' ? pal.website : pal.prompt);
          const focusMul = focusShown ? (focusId === h.id ? 1.45 : 0.25) : 1;

          ctx.save();
          ctx.globalAlpha = 0.095 * zoomFade * focusMul;
          const grad = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, screenR * 1.05);
          grad.addColorStop(0, baseColor);
          grad.addColorStop(0.6, baseColor);
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, screenR * 1.05, 0, Math.PI * 2);
          ctx.fill();

          if (cam.z >= 0.26) {
            ctx.globalAlpha = (focusShown && focusId === h.id ? 0.38 : 0.16) * zoomFade;
            ctx.strokeStyle = baseColor;
            ctx.lineWidth = focusShown && focusId === h.id ? 1.4 : 1;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, screenR * 0.96, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // 2. Curved Bezier edges with macro LOD and active highlight list
      const zoomEdgeFactor = clamp((cam.z - 0.35) / 0.75, 0.25, 1);
      const highlightedSemEdges = [];
      for (const e of edges) {
        if (e.k === 'r' && !showSemEdges) continue;
        if (e.k === 't' && !showHubs) continue;
        if (!isNodeShown(e.a) || !isNodeShown(e.b)) continue;

        const isConnected = focusShown && (e.a.id === focusId || e.b.id === focusId);
        const isEdgeHovered = hoverEdge === e;
        const p1 = worldToScreen(e.a.x, e.a.y);
        const p2 = worldToScreen(e.b.x, e.b.y);
        if (Math.max(p1.x, p2.x) < -40 || Math.min(p1.x, p2.x) > width + 40 || Math.max(p1.y, p2.y) < -40 || Math.min(p1.y, p2.y) > height + 40) {
          continue;
        }

        const bz = edgeBezierPoints(e, p1, p2);
        let alpha = 1;
        if (focusShown) {
          alpha = (isConnected || isEdgeHovered) ? 1 : (e.k === 't' ? 0.04 : 0.08);
        } else if (hasSearch) {
          alpha = (searchHits.has(e.a.id) || searchHits.has(e.b.id)) ? 0.85 : 0.11;
        } else if (e.k === 't') {
          alpha = 0.065 + zoomEdgeFactor * 0.05;
        } else {
          alpha = (e.w >= 0.42 ? 0.18 : 0.08) + zoomEdgeFactor * (e.w >= 0.42 ? 0.22 : 0.12);
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.quadraticCurveTo(bz.cx, bz.cy, p2.x, p2.y);

        if (isConnected || isEdgeHovered) {
          if (e.k === 'r') {
            const c1 = nodeColor(e.a, pal);
            const c2 = nodeColor(e.b, pal);
            if (c1 !== c2 && bz.len > 6) {
              const gLine = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
              gLine.addColorStop(0, c1);
              gLine.addColorStop(0.5, pal.edgeActiveSem);
              gLine.addColorStop(1, c2);
              ctx.strokeStyle = gLine;
            } else {
              ctx.strokeStyle = pal.edgeActiveSem;
            }
            ctx.lineWidth = isEdgeHovered ? 2.8 : 2.1;
            highlightedSemEdges.push({ e, bz });
          } else {
            ctx.strokeStyle = pal.edgeActiveTopic;
            ctx.lineWidth = 1.35;
          }
        } else {
          ctx.strokeStyle = e.k === 'r' ? (e.w >= 0.42 ? pal.edgeSemStrong : pal.edgeSemWeak) : pal.edgeTopic;
          ctx.lineWidth = e.k === 'r' ? (0.85 + e.w * 0.55) : 0.7;
        }
        ctx.stroke();
        ctx.restore();
      }

      // 3. Layered nodes (ambient aura, clean knockout border, core fill, bookmark ring)
      let animatingFocus = false;
      for (const n of nodes) {
        if (!isNodeShown(n)) continue;
        let targetAlpha = 1;
        if (focusShown) {
          targetAlpha = focusNeighbors.has(n.id) ? 1 : 0.14;
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
        if (p.x < -55 || p.x > width + 55 || p.y < -55 || p.y > height + 55) continue;

        const isSel = n.id === selectedId;
        const isHov = n.id === hoverId;
        const isHit = hasSearch && searchHits.has(n.id);
        const col = nodeColor(n, pal);
        const drawR = clamp(n.r * Math.pow(cam.z, 0.70), n.isHub ? 7.5 : 3.4, 24) * (isSel || isHov ? 1.28 : isHit ? 1.18 : 1);

        ctx.save();
        ctx.globalAlpha = n.focusAlpha;

        // Subtle aura on focus, hit, or high-importance landmark nodes
        if (isSel || isHov || isHit || (!n.isHub && n.imp >= 0.76 && n.focusAlpha > 0.5)) {
          const haloR = drawR + (isSel ? 8 : isHit ? 5.5 + 3 * pulsePhase : isHov ? 5.5 : 4.5);
          ctx.beginPath();
          ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
          if (isSel || isHov || isHit) {
            ctx.strokeStyle = isHit && !isSel ? pal.hitRing : pal.ring;
            ctx.lineWidth = isSel ? 2.2 : 1.5;
            ctx.globalAlpha = n.focusAlpha * (isHit && !isSel ? 0.55 + 0.35 * pulsePhase : 0.85);
            ctx.stroke();
          } else {
            ctx.fillStyle = col;
            ctx.globalAlpha = n.focusAlpha * 0.16;
            ctx.fill();
          }
          ctx.globalAlpha = n.focusAlpha;
        }

        // Core node circle with crisp background knockout rim
        ctx.beginPath();
        ctx.arc(p.x, p.y, drawR, 0, Math.PI * 2);
        ctx.fillStyle = n.isHub && layoutMode === 'section' && pal.dark ? '#181820' : col;
        ctx.fill();

        if (n.isHub) {
          ctx.lineWidth = isSel || isHov ? 2.8 : 2.1;
          ctx.strokeStyle = layoutMode === 'section' ? col : pal.hubStroke;
          ctx.stroke();
        } else {
          ctx.lineWidth = (n.item && n.item.favorite) || isSel || isHov ? 1.7 : 1.25;
          ctx.strokeStyle = n.item?.favorite ? '#ffd43b' : (isSel || isHov ? pal.ring : pal.strokeCut);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 4. Safe viewport boxes + non-overlapping node labels & inline edge reason badges
      const placed = [];
      const topSafe = width < 720 ? (ui.searchNav?.hidden ? 52 : 96) : 56;
      const rightSafe = (width > 720 && selectedId && !ui.inspector?.hidden) ? width - 356 : width - 8;
      const bottomSafe = (width <= 720 && selectedId && !ui.inspector?.hidden) ? Math.round(height * 0.48) - 10 : height - 10;

      const collides = (lx, ly, bw, bh, margin = 4) => {
        if (lx < 6 || lx + bw > rightSafe + (width > 720 && selectedId ? 0 : 0) || ly < topSafe || ly + bh > bottomSafe) {
          // If completely outside or inside inspector zone, reject
          if (width > 720 && selectedId && lx + bw > rightSafe && ly < height - 50) return true;
        }
        for (const r of placed) {
          if (lx < r.r + margin && lx + bw + margin > r.l && ly < r.b + margin && ly + bh + margin > r.t) {
            return true;
          }
        }
        return false;
      };

      const tryPlaceLabel = (n, priority) => {
        if (!n || !isNodeShown(n) || n.focusAlpha < 0.25) return;
        const p = worldToScreen(n.x, n.y);
        if (p.x < 6 || p.x > width - 6 || p.y < topSafe || p.y > bottomSafe) return;

        const text = n.isHub ? hubDisplayLabel(n) : shortTitle(cfg.tx(n.item, 'title'));
        const compact = width < 480;
        const fontSize = n.isHub ? (compact ? 10.5 : 11.5) : (priority <= 1 ? (compact ? 11 : 12) : 11);
        ctx.font = `${n.isHub || priority <= 1 ? '600' : '500'} ${fontSize}px "Segoe UI","Microsoft YaHei",sans-serif`;
        const tw = ctx.measureText(text).width;
        const padX = n.isHub ? (compact ? 6 : 8) : 6;
        const boxW = Math.min(Math.max(80, rightSafe - 16), tw + padX * 2);
        const boxH = fontSize + 7;
        const drawR = clamp(n.r * Math.pow(cam.z, 0.70), n.isHub ? 7.5 : 3.4, 24);
        const maxLeft = Math.max(6, (priority >= 2 && width > 720 && selectedId ? rightSafe : width - 6) - boxW);
        const lx = clamp(p.x - boxW * 0.5, 6, maxLeft);
        const ly = clamp(p.y - drawR - boxH - 6, topSafe, Math.max(topSafe, bottomSafe - boxH));

        if (collides(lx, ly, boxW, boxH, 5)) return;
        placed.push({ l: lx, t: ly, r: lx + boxW, b: ly + boxH });

        ctx.save();
        ctx.globalAlpha = clamp(n.focusAlpha, 0, 1);
        ctx.fillStyle = n.isHub ? pal.hubLabelBg : pal.labelBg;
        ctx.beginPath();
        const cr = n.isHub ? 999 : 6;
        ctx.roundRect ? ctx.roundRect(lx, ly, boxW, boxH, cr) : ctx.rect(lx, ly, boxW, boxH);
        ctx.fill();
        if (n.isHub || priority === 0) {
          ctx.strokeStyle = priority === 0 ? pal.ring : (layoutMode === 'section' ? clusterColorForHub(n.id, pal) : pal.hubLabelBorder);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.fillStyle = n.isHub ? pal.hubText : (priority <= 2 ? pal.labelText : pal.labelMuted);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, lx + boxW * 0.5, ly + boxH * 0.5 + 0.5, boxW - 4);
        ctx.restore();
      };

      // Priority 0: Hovered + Selected nodes
      if (focusShown) tryPlaceLabel(focusNode, 0);
      if (hoverId && hoverId !== selectedId) tryPlaceLabel(nodeById.get(hoverId), 0);
      if (selectedId && selectedId !== hoverId) tryPlaceLabel(nodeById.get(selectedId), 0);

      // Priority 1: Direct neighbors of focused node + search hits
      for (const hid of focusNeighbors) {
        if (hid !== focusId) tryPlaceLabel(nodeById.get(hid), 1);
      }
      if (hasSearch) {
        for (const n of searchOrdered.slice(0, 24)) tryPlaceLabel(n, 1);
      }

      // Inline non-overlapping relationship reason badges along focused edges
      if (focusShown && highlightedSemEdges.length) {
        highlightedSemEdges
          .sort((a, b) => b.e.w - a.e.w)
          .slice(0, depthMode === 'hop1' ? 8 : 5)
          .forEach(({ e, bz }) => {
            const reason = lang === 'en' ? (e.re || e.rz) : (e.rz || e.re);
            if (!reason || bz.len < 52) return;
            const label = shortTitle(reason, 16);
            ctx.font = '600 10px "Segoe UI","Microsoft YaHei",sans-serif';
            const rw = ctx.measureText(label).width + 12;
            const rh = 18;
            const rx = clamp(bz.bx - rw * 0.5, 6, Math.max(6, rightSafe - rw));
            const ry = clamp(bz.by - rh * 0.5, topSafe, Math.max(topSafe, bottomSafe - rh));
            if (collides(rx, ry, rw, rh, 6)) return;
            placed.push({ l: rx, t: ry, r: rx + rw, b: ry + rh });

            ctx.save();
            ctx.fillStyle = pal.edgeBadgeBg;
            ctx.strokeStyle = pal.edgeBadgeBorder;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(rx, ry, rw, rh, 999) : ctx.rect(rx, ry, rw, rh);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = pal.edgeBadgeText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, rx + rw * 0.5, ry + rh * 0.5 + 0.5, rw - 6);
            ctx.restore();
          });
      }

      // Priority 2: Topic hubs
      for (const h of hubNodes) tryPlaceLabel(h, 2);

      // Priority 3: Semantic landmarks + zoom-revealed item labels
      if (labelMode !== 'minimal') {
        const sortedItems = [...itemNodes].sort((a, b) => (b.imp - a.imp) || (b.deg - a.deg));
        if (labelMode === 'dense') {
          for (const n of sortedItems) tryPlaceLabel(n, 3);
        } else {
          // Always surface top 2 landmarks per visible hub at macro zoom, then progressive reveal on zoom
          const perHubShown = new Map();
          for (const n of sortedItems) {
            if (!isItemShown(n)) continue;
            const c = perHubShown.get(n.hub) || 0;
            const isLandmark = c < (layoutMode === 'section' ? 3 : 2) && cam.z >= 0.36;
            const zoomThreshold = cam.z >= 1.45 ? 0 : cam.z >= 0.98 ? 0.35 : cam.z >= 0.72 ? 0.62 : 99;
            if (isLandmark || n.imp >= zoomThreshold || matchScopeIds.size <= 24) {
              tryPlaceLabel(n, isLandmark ? 2 : 3);
              perHubShown.set(n.hub, c + 1);
            }
          }
        }
      }

      ctx.restore();
      return animatingFocus || isPulsing;
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
          const con = node.concept ? ` · ${conceptLabel(node.concept)}` : '';
          ui.tooltip.innerHTML = `<b>${esc(title)}</b><span>${esc(cat)}${esc(con)}</span>`;
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

    function setFullscreen(next) {
      isFullscreen = !!next;
      stageEl.classList.toggle('is-fullscreen', isFullscreen);
      document.body.classList.toggle('graph-fullscreen', isFullscreen);
      ui.expand?.setAttribute('aria-pressed', String(isFullscreen));
      ui.expand?.setAttribute('aria-label', cfg.tr(isFullscreen ? '退出全屏' : '展开全屏'));
      requestAnimationFrame(() => {
        resize();
        fitNodes(searchOrdered.length ? searchOrdered : itemNodes.filter(isItemShown), false);
      });
    }

    function bindEvents() {
      canvas.addEventListener('pointerdown', e => {
        if (e.button > 0 && e.pointerType === 'mouse') return;
        ui.settings.hidden = true;
        ui.gear.setAttribute('aria-expanded', 'false');
        closeHitDropdown();
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
          hitGridDirty = true;
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
        const hubBtn = e.target.closest('[data-ghub]');
        if (hubBtn) {
          const hid = hubBtn.dataset.ghub;
          if (selectedId === hid) {
            selectNode(null, false);
            fitNodes(itemNodes.filter(isItemShown), false);
          } else {
            selectNode(hid, true);
          }
          return;
        }
        const kindBtn = e.target.closest('[data-gkind]');
        if (!kindBtn) return;
        const k = kindBtn.dataset.gkind;
        if (visibleKinds.has(k) && visibleKinds.size > 1) {
          visibleKinds.delete(k);
          kindBtn.classList.remove('active');
        } else {
          visibleKinds.add(k);
          kindBtn.classList.add('active');
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

      ui.depthSwitch.addEventListener('click', e => {
        const b = e.target.closest('[data-depth]');
        if (b) setDepthMode(b.dataset.depth, true);
      });

      ui.hitTrigger.onclick = () => {
        if (!searchOrdered.length) return;
        hitDropdownOpen = !hitDropdownOpen;
        ui.hitList.hidden = !hitDropdownOpen;
        ui.hitTrigger.setAttribute('aria-expanded', String(hitDropdownOpen));
        ui.hitTrigger.setAttribute('aria-label', cfg.tr(hitDropdownOpen ? '收起命中列表' : '展开命中列表'));
        if (hitDropdownOpen) renderHitDropdown();
      };

      ui.hitList.addEventListener('click', e => {
        const row = e.target.closest('[data-hit-idx]');
        if (!row) return;
        const idx = Number(row.dataset.hitIdx);
        if (!Number.isInteger(idx) || !searchOrdered[idx]) return;
        searchHitIdx = idx;
        closeHitDropdown();
        updateSearchNav();
        selectNode(searchOrdered[idx].id, true);
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

      ui.expand.onclick = () => setFullscreen(!isFullscreen);

      ui.gear.onclick = () => {
        closeHitDropdown();
        const nextOpen = ui.settings.hidden;
        ui.settings.hidden = !nextOpen;
        ui.gear.setAttribute('aria-expanded', String(nextOpen));
      };
      ui.optShowHubs.onchange = () => {
        showHubs = ui.optShowHubs.checked;
        if (showHubs) visibleKinds.add('hub'); else visibleKinds.delete('hub');
        ui.legend.querySelector('[data-gkind="hub"]')?.classList.toggle('active', showHubs);
        if (depthMode !== 'all') applyLayoutTargets(false);
        wake();
      };
      ui.optShowNebulas.onchange = () => {
        showNebulas = ui.optShowNebulas.checked;
        wake();
      };
      ui.optShowSem.onchange = () => {
        showSemEdges = ui.optShowSem.checked;
        if (depthMode !== 'all') applyLayoutTargets(false);
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
        depthMode = 'all';
        applyLayoutTargets(false);
        updateDepthControls();
        fitNodes(itemNodes.filter(isItemShown), false);
        wake();
      };

      ui.zoomIn.onclick = () => {
        flyTo(cam.x, cam.y, clamp(cam.z * 1.35, 0.20, 4.5), false);
      };
      ui.zoomOut.onclick = () => {
        flyTo(cam.x, cam.y, clamp(cam.z / 1.35, 0.20, 4.5), false);
      };
      ui.reset.onclick = () => {
        if (depthMode !== 'all' && localShownIds) {
          fitNodes([...localShownIds].map(id => nodeById.get(id)).filter(Boolean), false);
        } else {
          fitNodes(searchOrdered.length ? searchOrdered : itemNodes.filter(isItemShown), false);
        }
      };

      ui.inspector.addEventListener('click', e => {
        const closeBtn = e.target.closest('[data-gact="close"]');
        if (closeBtn) {
          selectNode(null, false);
          return;
        }
        const conBtn = e.target.closest('[data-gconcept]');
        if (conBtn) {
          hubConceptFilter = conBtn.dataset.gconcept;
          ui.inspector.querySelectorAll('[data-gconcept]').forEach(b => b.classList.toggle('active', b === conBtn));
          const n = nodeById.get(selectedId);
          if (n && n.isHub) {
            const members = (adj.get(n.id) || [])
              .filter(x => !x.node.isHub && visibleKinds.has(x.node.kind) && matchScopeIds.has(x.node.id))
              .sort((a, b) => (b.node.imp - a.node.imp) || (b.node.deg - a.node.deg));
            filterAndRenderHubRows(n, members);
          }
          return;
        }
        const depthBtn = e.target.closest('[data-depth]');
        if (depthBtn) {
          setDepthMode(depthBtn.dataset.depth, true);
          return;
        }
        const toggleLocal = e.target.closest('[data-gdepth-toggle]');
        if (toggleLocal) {
          setDepthMode(depthMode === 'hop1' ? 'all' : 'hop1', true);
          return;
        }
        const clusterFocus = e.target.closest('[data-glocal]');
        if (clusterFocus) {
          setDepthMode(depthMode === 'hop1' ? 'all' : 'hop1', true);
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
          if (isFullscreen) setFullscreen(false);
          const [sec, top] = gridBtn.dataset.ggrid.split(':');
          cfg.jumpToGridTopic(sec, top);
        }
      });

      document.addEventListener('keydown', e => {
        if (!active) return;
        const tag = (e.target?.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
        if (e.key === 'Escape') {
          if (hitDropdownOpen) { closeHitDropdown(); return; }
          if (!ui.settings.hidden) {
            ui.settings.hidden = true;
            ui.gear.setAttribute('aria-expanded', 'false');
            return;
          }
          if (depthMode !== 'all' && !document.getElementById('detail')?.open) {
            setDepthMode('all', true);
            return;
          }
          if (selectedId && !document.getElementById('detail')?.open) {
            selectNode(null, false);
            return;
          }
          if (isFullscreen && !document.getElementById('detail')?.open) {
            setFullscreen(false);
          }
          return;
        }
        if (typing) return;
        if (e.key === '[' && searchOrdered.length) {
          e.preventDefault();
          ui.prevHit.click();
        } else if (e.key === ']' && searchOrdered.length) {
          e.preventDefault();
          ui.nextHit.click();
        } else if (selectedId && (e.key === '1' || e.key === '2' || e.key === '0')) {
          e.preventDefault();
          setDepthMode(e.key === '1' ? 'hop1' : e.key === '2' ? 'hop2' : 'all', true);
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          ui.reset.click();
        } else if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          ui.zoomIn.click();
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          ui.zoomOut.click();
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
          fitNodes(searchOrdered.length ? searchOrdered : itemNodes.filter(isItemShown), true);
          wake();
        } else {
          if (isFullscreen) setFullscreen(false);
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
          lastFrameTime = 0;
          if (ui.tooltip) ui.tooltip.hidden = true;
          closeHitDropdown();
          if (ui.settings) {
            ui.settings.hidden = true;
            ui.gear?.setAttribute('aria-expanded', 'false');
          }
        }
      },

      syncFilter({ category, topic, query, scopeItems }) {
        const prevMode = layoutMode;
        const prevCat = scopeCategory;
        const prevQuery = searchQuery;

        scopeCategory = category;
        scopeTopic = topic;
        searchQuery = (query || '').trim().toLowerCase();
        layoutMode = ['Skills', '实用网站', '提示词'].includes(category) ? 'section' : 'global';

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
          if (searchQuery !== prevQuery) {
            pulseStart = performance.now();
            pulseActiveUntil = pulseStart + 2800;
          }
        } else {
          pulseActiveUntil = 0;
        }

        const catChanged = prevCat !== category || prevMode !== layoutMode;
        if (catChanged && selectedId && nodeById.get(selectedId) && !matchScopeIds.has(selectedId)) {
          selectedId = null;
          depthMode = 'all';
          stageEl?.classList.remove('has-inspector');
          ui.inspector.hidden = true;
        }

        if (catChanged || prevMode !== layoutMode) {
          applyLayoutTargets(!active);
          if (layoutMode === 'section' && topic && topic !== '全部' && !searchQuery) {
            const secKind = (cfg.sectionKind || { Skills: 'skill', 提示词: 'prompt', 实用网站: 'website' })[category];
            const targetHubId = secKind ? `hub:${secKind}:${topic}` : '';
            if (targetHubId && nodeById.has(targetHubId)) {
              selectedId = targetHubId;
              stageEl?.classList.add('has-inspector');
            }
          }
        }

        if (selectedId && nodeById.get(selectedId) && !isNodeShown(nodeById.get(selectedId))) {
          selectNode(null, false);
        } else if (selectedId) {
          renderInspector();
        }

        rebuildLegend(catChanged);
        updateStats();
        updateSearchNav();
        updateDepthControls();

        if (active) {
          if (searchOrdered.length && searchOrdered.length <= 24) {
            fitNodes(searchOrdered, false);
          } else if (!searchQuery) {
            fitNodes(itemNodes.filter(isItemShown), catChanged && !reduceMotion() ? false : false);
          }
          wake();
        }
      },

      focusTopMatch() {
        if (!searchOrdered.length) return;
        searchHitIdx = 0;
        closeHitDropdown();
        updateSearchNav();
        selectNode(searchOrdered[0].id, true);
      },

      refreshTheme() {
        rebuildLegend(true);
        if (selectedId) renderInspector();
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
