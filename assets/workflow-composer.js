/* Shiju Workflow Studio: Evidence-ranked Project Stack Composer (zero external deps). */
(() => {
  'use strict';

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function createWorkflowStudio() {
    let cfg = null;
    let hostEl = null;
    let active = false;
    let indexById = new Map();
    let currentQuery = '';
    let currentRecipes = [];
    let openSwapKey = null; // `${recipeIdx}:${stepIdx}`
    let openShieldIdx = null;

    const RECIPE_PROFILES = [
      {
        badgeZh: '方案 01 · 优先推荐',
        badgeEn: 'Stack 01 · Recommended',
        subZh: '按需求相关性优先排序，只组合有匹配证据的条目',
        subEn: 'Ranked by relevance, using only items with matching evidence',
        kindBoost: { s: 1.18, w: 1.05, p: 0.92 },
      },
      {
        badgeZh: '方案 02 · 替代组合',
        badgeEn: 'Stack 02 · Pro Alternative',
        subZh: '优先尝试不同的核心工具；缺少合适条目的阶段保持空缺',
        subEn: 'Try another core tool; leave unsupported stages unfilled',
        kindBoost: { s: 1.22, w: 1.0, p: 0.95 },
      },
      {
        badgeZh: '方案 03 · 轻量组合',
        badgeEn: 'Stack 03 · Agile & Visual',
        subZh: '相关性优先，在同等匹配下略优先网站与提示词',
        subEn: 'Relevance first, with a small preference for websites and prompts',
        kindBoost: { s: 1.02, w: 1.18, p: 1.15 },
      },
    ];

    const STOP = new Set('ai a an the i we my our to for of in on with and or from is it want need make build create use tool tools project workflow learn learning study 学习 我想 想要 需要 一个 一些 帮我 工具 项目 工作 流程 可以 如何 怎么 进行 自动 智能 推荐 搭配 使用 实现'.split(' '));
    const normalize = text => String(text || '').normalize('NFKC').toLowerCase();
    function hasTerm(text, term) {
      if (/^[a-z0-9_.+-]+$/.test(term)) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(text);
      }
      return text.includes(term);
    }
    function tokenizeQuery(query) {
      const q = normalize(query), tokens = new Set();
      for (const word of q.match(/[a-z0-9][a-z0-9_.+-]*/g) || []) if (!STOP.has(word) && word.length > 1) tokens.add(word);
      for (const dom of cfg.workflowData.domains || []) for (const kw of dom.kws) {
        if (!STOP.has(kw) && hasTerm(q, kw)) tokens.add(kw);
      }
      const clean = q.replace(/我想要?|想要|需要|帮我|请问|如何|怎么|学习|使用|一个|一些|工具|项目|工作流|推荐|搭配|进行|可以/g, ' ');
      for (const seg of clean.match(/[\u4e00-\u9fff]{2,}/g) || []) {
        if (seg.length <= 8) tokens.add(seg);
        for (let n = 2; n <= 3; n++) for (let i = 0; i <= seg.length - n; i++) {
          const t = seg.slice(i, i + n);
          if (!STOP.has(t) && !/[的与和或及并了在我想要需个把为地得]/.test(t)) tokens.add(t);
        }
      }
      return [...tokens];
    }
    function itemText(item) {
      return [normalize(`${item.title || ''} ${item.en?.title || ''}`),
        normalize(`${item.tags || ''} ${item.en?.tags || ''}`),
        normalize(`${item.description || ''} ${item.en?.description || ''}`)];
    }
    function detectIntent(query) {
      const q = normalize(query).trim(), tokens = tokenizeQuery(q), domains = cfg.workflowData.domains || [];
      const texts = cfg.getItems().map(itemText);
      // Corpus frequency makes specific capabilities outrank ubiquitous implementation words.
      const weights = new Map(tokens.map(t => [t, Math.log(1 + texts.length / (1 + texts.filter(fields => fields.some(f => hasTerm(f, t))).length))]));
      let domainScores = domains.map(dom => {
        const hits = dom.kws.filter(kw => !STOP.has(kw) && hasTerm(q, kw));
        return { ...dom, score: hits.reduce((sum, kw) => sum + (weights.get(kw) || 1), 0) };
      }).filter(d => d.score > 0).sort((a, b) => b.score - a.score);
      const buildingSite = /(开发|搭建|构建|制作|build|develop|create).*(网站|网页|应用|website|frontend|\bapp\b)/i.test(q);
      if (buildingSite) {
        const frontend = domains.find(d => d.id === 'frontend');
        domainScores = [{ ...frontend, score: 100 }, ...domainScores.filter(d => d.id !== 'frontend')];
      }
      // No arbitrary default domain, and no inference from prompt bodies or repository boilerplate.
      return { query: q, tokens, weights, primary: domainScores[0] || null,
        secondary: domainScores[1]?.score >= domainScores[0]?.score * .65 ? domainScores[1] : null,
        allDomains: domainScores.slice(0, 2), buildingSite, learning: /^(学习|学会|学|learn\b|study\b)/.test(q) };
    }
    function relevance(item, intent) {
      const fields = itemText(item);
      const hits = intent.tokens.filter(t => fields.some(f => hasTerm(f, t)));
      // Count a phrase once, rather than inflating scores with every overlapping Chinese bigram.
      const distinct = hits.filter(t => !hits.some(longer => longer.length > t.length && longer.includes(t)));
      const scored = distinct.map(t => ({ term: t, score: (intent.weights.get(t) || 1) *
        (hasTerm(fields[0], t) ? 12 : hasTerm(fields[1], t) ? 9 : 5) }));
      scored.sort((a, b) => b.score - a.score);
      return { score: scored.reduce((sum, hit) => sum + hit.score, 0), reasons: scored.slice(0, 3).map(h => h.term) };
    }
    function scoreItemForIntent(item, meta, intent, kindBoost) {
      const match = relevance(item, intent);
      // Domain, preview completeness and content type can rank relevant tools; none can admit an unrelated tool.
      if (match.score < 8) return 0;
      if (intent.primary && (meta.d?.[intent.primary.id] || 0) < 4) return 0;
      if (intent.learning && !/(学习|练习|背单词|课程|教材|教程|教学|入门|tutor|learning|practice|course|tutorial)/i.test(itemText(item).join(' '))) return 0;
      if (intent.buildingSite && (meta.d?.frontend || 0) < 6) return 0;
      const domainFit = intent.primary ? Math.min(8, meta.d?.[intent.primary.id] || 0) : 0;
      return (match.score + domainFit) * (kindBoost[meta.k] || 1);
    }

    function buildSingleRecipe(profile, intent, bannedCoreIds, bannedCoreGroups, usedAcrossFirst) {
      const items = cfg.getItems();
      const scoredByStage = [[], [], [], []];

      for (const item of items) {
        const meta = indexById.get(item.id);
        if (!meta) continue;
        const sc = scoreItemForIntent(item, meta, intent, profile.kindBoost);
        if (sc < 6) continue;
        const entry = { item, meta, sc };
        scoredByStage[meta.st]?.push(entry);
      }

      const relevanceFloor = Math.max(6, ...scoredByStage.flat().map(c => c.sc * .32));
      for (const bucket of scoredByStage) {
        bucket.splice(0, bucket.length, ...bucket.filter(c => c.sc >= relevanceFloor));
        bucket.sort((a, b) => b.sc - a.sc || a.item.id.localeCompare(b.item.id));
      }

      const usedIds = new Set();
      const usedCgs = new Set();
      const steps = [null, null, null, null];
      const isolatedConflicts = new Set();

      const pickForStage = (stIdx, diversifyCore = false) => {
        const pool = scoredByStage[stIdx];
        let chosen = null;

        // Pass 1: try fresh item + fresh conflict group (+ diversified core engine across recipes)
        for (const cand of pool) {
          if (usedIds.has(cand.item.id)) continue;
          if (cand.meta.cg && usedCgs.has(cand.meta.cg)) {
            isolatedConflicts.add(cand.meta.cg);
            continue;
          }
          if (diversifyCore && (bannedCoreIds.has(cand.item.id) || (cand.meta.cg && bannedCoreGroups.has(cand.meta.cg)))) {
            continue;
          }
          // Light novelty nudge across recipes for non-core stages
          if (!diversifyCore && usedAcrossFirst.has(cand.item.id) && pool.some(alt => !usedIds.has(alt.item.id) && !usedAcrossFirst.has(alt.item.id) && (!alt.meta.cg || !usedCgs.has(alt.meta.cg)) && alt.sc >= cand.sc * 0.72)) {
            continue;
          }
          chosen = cand;
          break;
        }

        // Pass 2: relax cross-recipe novelty if needed, NEVER relax within-recipe conflict group!
        if (!chosen) {
          for (const cand of pool) {
            if (usedIds.has(cand.item.id)) continue;
            if (cand.meta.cg && usedCgs.has(cand.meta.cg)) {
              isolatedConflicts.add(cand.meta.cg);
              continue;
            }
            if (diversifyCore && bannedCoreIds.has(cand.item.id)) continue;
            chosen = cand;
            break;
          }
        }

        if (!chosen) return;
        usedIds.add(chosen.item.id);
        if (chosen.meta.cg) usedCgs.add(chosen.meta.cg);

        steps[stIdx] = {
          stageIdx: stIdx,
          item: chosen.item,
          meta: chosen.meta,
          score: chosen.sc,
          reasons: relevance(chosen.item, intent).reasons,
          alternatives: [],
        };
      };

      // Pick Core Engine (stage 1) first to anchor the entire stack, then Plan (0), Polish (2), Ship (3)
      pickForStage(1, true);
      if (scoredByStage[1].length && !steps[1]) return {steps: []};
      pickForStage(0, false);
      pickForStage(2, false);
      pickForStage(3, false);

      const finalSteps = steps.filter(Boolean);
      // Compute alternatives AFTER every slot is filled. Earlier slots must not suggest
      // a replacement that is already selected or conflicts with a later slot.
      for (const step of finalSteps) {
        const others = finalSteps.filter(s => s !== step);
        step.alternatives = scoredByStage[step.stageIdx].filter(c => c.item.id !== step.item.id &&
          !others.some(o => o.item.id === c.item.id || (c.meta.cg && c.meta.cg === o.meta.cg))).slice(0, 4);
      }
      const skillCount = finalSteps.filter(s => s.meta.k === 's').length;
      const activeCgs = finalSteps.map(s => s.meta.cg).filter(Boolean);
      const hasConflict = new Set(activeCgs).size !== activeCgs.length;

      return {
        profile,
        steps: finalSteps,
        intent,
        relevanceFloor,
        missingStages: [0, 1, 2, 3].filter(st => !steps[st]),
        skillCount,
        isolatedConflictGroups: [...isolatedConflicts],
        conflictFree: !hasConflict,
      };
    }

    function synthesizeWorkflows(query) {
      const intent = detectIntent(query);
      const recipes = [];
      const bannedCoreIds = new Set();
      const bannedCoreGroups = new Set();
      const usedAcrossFirst = new Set();

      for (let i = 0; i < RECIPE_PROFILES.length; i++) {
        const rec = buildSingleRecipe(
          RECIPE_PROFILES[i],
          intent,
          i > 0 ? bannedCoreIds : new Set(),
          i === 1 ? bannedCoreGroups : new Set(),
          usedAcrossFirst
        );
        if (!rec.steps.length) continue;
        const uniqueIds = rec.steps.map(s => s.item.id).sort().join('|');
        if (recipes.some(r => r.steps.map(s => s.item.id).sort().join('|') === uniqueIds)) continue;
        // Avoid identical duplicate recipes
        const sig = rec.steps.map(s => s.item.id).join('|');
        if (recipes.some(r => r.steps.map(s => s.item.id).join('|') === sig)) continue;

        const coreStep = rec.steps.find(s => s.stageIdx === 1) || rec.steps[0];
        if (coreStep) {
          bannedCoreIds.add(coreStep.item.id);
          if (coreStep.meta.cg) bannedCoreGroups.add(coreStep.meta.cg);
        }
        rec.steps.forEach(s => usedAcrossFirst.add(s.item.id));
        recipes.push(rec);
      }
      return { intent, recipes };
    }

    function kindLabel(item) {
      if (item.kind === 'website') return cfg.getLang() === 'en' ? 'Website' : '实用网站';
      if (item.kind === 'skill') return 'Skill';
      return cfg.getLang() === 'en' ? 'Prompt' : '提示词';
    }

    function stageMeta(idx) {
      const st = cfg.workflowData.stages[idx] || cfg.workflowData.stages[1];
      return cfg.getLang() === 'en'
        ? { name: st.en, hint: st.hintEn }
        : { name: st.zh, hint: st.hintZh };
    }

    function conflictText(cgId) {
      const meta = cfg.workflowData.conflictGroups?.[cgId];
      if (!meta) return '';
      return cfg.getLang() === 'en' ? meta.en : meta.zh;
    }

    function buildShell() {
      const lang = cfg.getLang();
      const presets = cfg.workflowData.presets || [];
      hostEl.innerHTML = `
        <section class="wf-hero" id="wfHero">
          <div class="wf-beam" aria-hidden="true"></div>
          <div class="wf-hero-head">
            <div>
              <h2 class="wf-title" data-wi="描述你的项目需求，搭配相关工具与工作流"></h2>
              <p class="wf-sub" data-wi="基于收录内容的标题、标签与用途匹配；只组合相关工具，缺少的阶段保持空缺，并检查已知互斥规则。"></p>
            </div>
          </div>
          <form class="wf-form" id="wfForm">
            <div class="wf-input-wrap">
              <svg class="wf-input-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9L12 3z"/></svg>
              <input id="wfInput" type="search" autocomplete="off" value="${esc(currentQuery)}" placeholder="${esc(cfg.tr('例如：我想做口播视频剪辑，自动加字幕并发布；或开发一个高颜值 React 后台…'))}" aria-label="${esc(cfg.tr('输入你的项目工作需求'))}">
              <button type="submit" class="primary wf-submit" id="wfSubmit">${esc(cfg.tr('生成搭配'))}</button>
            </div>
          </form>
          <div class="wf-presets" id="wfPresets" role="group" aria-label="${esc(cfg.tr('快捷场景'))}">
            ${presets.map(p => `<button type="button" class="wf-preset-chip" data-wf-preset="${esc(p.id)}">${esc(lang === 'en' ? p.en : p.zh)}</button>`).join('')}
          </div>
        </section>
        <div class="wf-diagnosis" id="wfDiagnosis" aria-live="polite"></div>
        <div class="wf-recipes" id="wfRecipes"></div>
      `;
      translateStatic();
      bindEvents();
    }

    function translateStatic() {
      if (!hostEl) return;
      const lang = cfg.getLang();
      hostEl.querySelectorAll('[data-wi]').forEach(el => {
        el.textContent = cfg.tr(el.dataset.wi);
      });
      const input = hostEl.querySelector('#wfInput');
      if (input) {
        input.placeholder = cfg.tr('例如：我想做口播视频剪辑，自动加字幕并发布；或开发一个高颜值 React 后台…');
        input.setAttribute('aria-label', cfg.tr('输入你的项目工作需求'));
      }
      const submit = hostEl.querySelector('#wfSubmit');
      if (submit) submit.textContent = cfg.tr('生成搭配');
      const presetsBox = hostEl.querySelector('#wfPresets');
      if (presetsBox) {
        presetsBox.setAttribute('aria-label', cfg.tr('快捷场景'));
        const presets = cfg.workflowData.presets || [];
        presetsBox.querySelectorAll('[data-wf-preset]').forEach(btn => {
          const p = presets.find(x => x.id === btn.dataset.wfPreset);
          if (p) btn.textContent = lang === 'en' ? p.en : p.zh;
        });
      }
    }

    function renderResults(animate = true) {
      if (!hostEl) return;
      const lang = cfg.getLang();
      const diagEl = hostEl.querySelector('#wfDiagnosis');
      const listEl = hostEl.querySelector('#wfRecipes');
      if (!diagEl || !listEl) return;

      const { intent, recipes } = synthesizeWorkflows(currentQuery);
      currentRecipes = recipes;
      openSwapKey = null;
      openShieldIdx = null;

      const domainChips = intent.allDomains.map(d => `<span class="wf-diag-tag">${esc(lang === 'en' ? d.en : d.zh)}</span>`).join('');
      const totalItems = cfg.getItems().length;
      diagEl.innerHTML = `
        <div class="wf-diag-left">
          <span class="wf-diag-dot" aria-hidden="true"></span>
          <span>${esc(cfg.tr('已识别方向'))}</span>
          ${domainChips || esc(lang === 'en' ? 'No confident category — direct matches only' : '暂未识别明确方向，仅按具体词匹配')}
        </div>
        <div class="wf-diag-right">
          ${esc(cfg.tr('从 {n} 项内容中匹配 {m} 套相关组合').replace('{n}', totalItems).replace('{m}', recipes.length))}
        </div>
      `;

      renderRecipesDOM(animate);
    }

    function renderRecipesDOM(animate = false) {
      const listEl = hostEl?.querySelector('#wfRecipes');
      if (!listEl) return;
      const lang = cfg.getLang();

      if (!currentRecipes.length) {
        listEl.innerHTML = `<section class="wf-recipe"><h3>${esc(lang === 'en' ? 'No relevant tools found' : '暂未找到相关工具')}</h3><p>${esc(lang === 'en' ? 'Add a concrete task, output or tool name. The library may not cover this need; unrelated tools will not be inserted.' : '请补充具体任务、目标产物或工具名称。当前内容库可能尚未覆盖这个需求，不会用无关工具补齐。')}</p></section>`;
        return;
      }
      listEl.innerHTML = currentRecipes.map((rec, rIdx) => {
        const badge = lang === 'en' ? rec.profile.badgeEn : rec.profile.badgeZh;
        const sub = lang === 'en' ? rec.profile.subEn : rec.profile.subZh;
        const isolatedN = rec.isolatedConflictGroups.length;
        const shieldLabel = lang === 'en' ? 'No known rule conflicts' : '未发现已知规则冲突';
        const shieldOpen = openShieldIdx === rIdx;

        const shieldDetailHtml = shieldOpen ? `
          <div class="wf-shield-note">
            <strong>${esc(cfg.tr('冲突检测报告'))}</strong>
            <p>${esc(lang === 'en' ? 'Checked against curated exclusion groups only. Execution compatibility is not verified.' : '仅检查收录的互斥分组，不代表已验证实际运行兼容性。')}</p>
            ${isolatedN ? `<ul>${rec.isolatedConflictGroups.map(cg => `<li>${esc(conflictText(cg))}</li>`).join('')}</ul>`
            : `<p>${esc(cfg.tr('未命中已收录的互斥分组；工具间的数据格式、依赖和实际运行仍需确认。'))}</p>`}
          </div>
        ` : '';

        const stepsHtml = rec.steps.map((st, sIdx) => {
          const item = st.item;
          const title = cfg.tx(item, 'title');
          const desc = cfg.tx(item, 'description') || cfg.tr('一条新收录的灵感。');
          const cover = cfg.coverOf(item) || (item.preview?.type === 'image' && /^assets\/[a-zA-Z0-9_./-]+$/.test(item.preview.src) && !item.preview.src.includes('..') ? item.preview.src : '');
          const sm = stageMeta(st.stageIdx);
          const swapKey = `${rIdx}:${sIdx}`;
          const isSwapOpen = openSwapKey === swapKey;
          const hasAlts = st.alternatives && st.alternatives.length > 0;
          const kindCls = item.kind === 'skill' ? 'is-skill' : item.kind === 'website' ? 'is-web' : 'is-prompt';

          const swapHtml = isSwapOpen && hasAlts ? `
            <div class="wf-swap-pop" role="dialog" aria-label="${esc(cfg.tr('安全替换备选'))}">
              <div class="wf-swap-head">
                <span>${esc(cfg.tr('替换为同阶段不冲突备选'))}</span>
                <button type="button" class="wf-swap-close" data-wf-swap-close aria-label="${esc(cfg.tr('关闭面板'))}">×</button>
              </div>
              <div class="wf-swap-list">
                ${st.alternatives.map((alt, aIdx) => {
                  const isPeerMutex = alt.meta.cg && alt.meta.cg === st.meta.cg;
                  return `
                    <button type="button" class="wf-swap-opt" data-wf-pick="${rIdx}:${sIdx}:${aIdx}">
                      <span class="wf-swap-opt-title">${esc(cfg.tx(alt.item, 'title'))}</span>
                      <small class="wf-swap-opt-tag">${esc(isPeerMutex ? cfg.tr('互斥替换') : kindLabel(alt.item))}</small>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          ` : '';

          const connectorHtml = sIdx < rec.steps.length - 1
            ? `<div class="wf-conn" aria-hidden="true"><span class="wf-conn-line"><i></i></span></div>`
            : '';

          return `
            <div class="wf-step-wrap" style="--si:${sIdx}">
              <article class="wf-step ${kindCls}" draggable="true" data-drag-card="${esc(item.id)}" data-wf-step="${swapKey}">
                <div class="wf-step-top">
                  <span class="wf-stage-pill"><b>0${sIdx + 1}</b> ${esc(sm.name)}</span>
                  <span class="wf-kind-pill ${kindCls}">${esc(kindLabel(item))}</span>
                </div>
                ${cover ? `<div class="wf-step-thumb"><img src="${esc(cover)}" draggable="false" alt="${esc(title)}" loading="lazy"></div>` : `<div class="wf-step-thumb wf-step-thumb-text"><span>${esc(kindLabel(item))}</span><strong>${esc(title.slice(0, 18))}</strong></div>`}
                <div class="wf-step-body">
                  <h4 class="wf-step-title">${esc(title)}</h4>
                  <p class="wf-step-desc">${esc(desc)}</p>
                  <p class="wf-recipe-sub">${esc(lang === 'en' ? 'Matches: ' : '匹配依据：')}${esc(st.reasons.join(' · '))}</p>
                </div>
                <div class="wf-step-foot">
                  <button type="button" class="wf-step-detail" data-wf-open="${esc(item.id)}">${esc(cfg.tr('查看详情'))}</button>
                  ${hasAlts ? `<button type="button" class="wf-step-swap" data-wf-swap="${swapKey}" aria-expanded="${isSwapOpen}">${esc(cfg.tr('替换'))} (${st.alternatives.length})</button>` : ''}
                </div>
                ${swapHtml}
              </article>
              ${connectorHtml}
            </div>
          `;
        }).join('');

        return `
          <section class="wf-recipe${animate ? ' is-entering' : ''}" style="--ri:${rIdx}" data-wf-recipe="${rIdx}">
            <header class="wf-recipe-head">
              <div class="wf-recipe-meta">
                <span class="wf-recipe-badge">${esc(badge)}</span>
                <p class="wf-recipe-sub">${esc(sub)}</p>
                ${rec.missingStages.length ? `<p class="wf-recipe-sub">${esc(lang === 'en' ? 'No suitable match for: ' : '未找到合适条目的阶段：')}${esc(rec.missingStages.map(idx => stageMeta(idx).name).join(' · '))}</p>` : ''}
              </div>
              <div class="wf-recipe-acts">
                <button type="button" class="wf-shield-btn" data-wf-shield="${rIdx}" aria-expanded="${shieldOpen}">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3z"/><path d="m9 12 2 2 4-4"/></svg>
                  <span>${esc(shieldLabel)}</span>
                </button>
                <button type="button" class="wf-copy-btn" data-wf-copy="${rIdx}">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  <span>${esc(cfg.tr('复制整套流程'))}</span>
                </button>
              </div>
            </header>
            ${shieldDetailHtml}
            <div class="wf-pipeline">${stepsHtml}</div>
          </section>
        `;
      }).join('');
    }

    function runCompose(query) {
      currentQuery = (query || '').trim();
      const input = hostEl?.querySelector('#wfInput');
      if (input && input.value !== currentQuery) input.value = currentQuery;

      const presets = cfg.workflowData.presets || [];
      hostEl?.querySelectorAll('[data-wf-preset]').forEach(btn => {
        const p = presets.find(x => x.id === btn.dataset.wfPreset);
        const matched = p && (currentQuery === p.queryZh || currentQuery === p.queryEn);
        btn.classList.toggle('active', !!matched);
        btn.setAttribute('aria-pressed', String(!!matched));
      });

      // Results are computed immediately; do not hold fresh recommendations behind a cosmetic timer.
      renderResults(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    async function copyRecipeMarkdown(rIdx, btnEl) {
      const rec = currentRecipes[rIdx];
      if (!rec) return;
      const lang = cfg.getLang();
      const header = lang === 'en' ? rec.profile.badgeEn : rec.profile.badgeZh;
      const lines = [
        `# ${header}${currentQuery ? ` — ${currentQuery}` : ''}`,
        '',
        lang === 'en'
          ? `Known exclusion groups checked only; runtime compatibility is not verified.`
          : `仅检查已知互斥分组，未验证实际运行兼容性。`,
        '',
      ];
      rec.steps.forEach((st, idx) => {
        const sm = stageMeta(st.stageIdx);
        const title = cfg.tx(st.item, 'title');
        const desc = cfg.tx(st.item, 'description') || '';
        const links = cfg.resourceLinks(st.item);
        const url = links[0]?.url ? ` (${links[0].url})` : '';
        lines.push(`${idx + 1}. **[${sm.name}] ${title}** [${kindLabel(st.item)}]${url}`);
        if (desc) lines.push(`   ${desc}`);
        lines.push(`   ${lang === 'en' ? 'Matches' : '匹配依据'}: ${st.reasons.join(' · ')}`);
      });
      if (rec.missingStages.length) lines.push('', `${lang === 'en' ? 'Unfilled stages' : '未匹配阶段'}: ${rec.missingStages.map(idx => stageMeta(idx).name).join(' · ')}`);
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        cfg.toast(cfg.tr('✓ 已复制推荐组合与匹配依据'));
        if (btnEl) {
          const span = btnEl.querySelector('span');
          const orig = cfg.tr('复制整套流程');
          btnEl.classList.add('is-copied');
          if (span) span.textContent = lang === 'en' ? '✓ Copied' : '✓ 已复制';
          clearTimeout(btnEl._copyTimer);
          btnEl._copyTimer = setTimeout(() => {
            btnEl.classList.remove('is-copied');
            if (span) span.textContent = orig;
          }, 1800);
        }
      } catch {
        cfg.toast(cfg.tr('复制失败，请手动复制。'));
      }
    }

    function swapStep(rIdx, sIdx, aIdx) {
      const rec = currentRecipes[rIdx];
      const st = rec?.steps[sIdx];
      const picked = st?.alternatives[aIdx];
      if (!rec || !st || !picked) return;

      const others = rec.steps.filter(s => s !== st);
      if (picked.meta.st !== st.stageIdx || others.some(s => s.item.id === picked.item.id || (picked.meta.cg && s.meta.cg === picked.meta.cg))) return;
      st.item = picked.item;
      st.meta = picked.meta;
      st.score = picked.sc;
      st.reasons = relevance(picked.item, rec.intent).reasons;

      // Rebuild safe alternatives against the final selection after every swap.
      for (const step of rec.steps) {
        step.alternatives = cfg.getItems().map(item => ({item, meta: indexById.get(item.id)}))
          .filter(c => c.meta?.st === step.stageIdx && c.item.id !== step.item.id &&
            !rec.steps.some(o => o !== step && (o.item.id === c.item.id || (c.meta.cg && c.meta.cg === o.meta.cg))))
          .map(c => ({...c, sc: scoreItemForIntent(c.item, c.meta, rec.intent, rec.profile.kindBoost)}))
          .filter(c => c.sc >= rec.relevanceFloor).sort((a, b) => b.sc - a.sc || a.item.id.localeCompare(b.item.id)).slice(0, 4);
      }
      // Recompute conflict-free check
      const cgs = rec.steps.map(s => s.meta.cg).filter(Boolean);
      rec.conflictFree = new Set(cgs).size === cgs.length;
      rec.skillCount = rec.steps.filter(s => s.meta.k === 's').length;
      openSwapKey = null;
      renderRecipesDOM(false);

      const card = hostEl?.querySelector(`[data-wf-step="${rIdx}:${sIdx}"]`);
      if (card && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        card.animate([
          { opacity: 0.4, transform: 'translateY(8px) scale(0.98)' },
          { opacity: 1, transform: 'none' },
        ], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    }

    function bindEvents() {
      const form = hostEl.querySelector('#wfForm');
      const input = hostEl.querySelector('#wfInput');
      form?.addEventListener('submit', e => {
        e.preventDefault();
        runCompose(input.value, true);
      });

      // Subtle tactile pointer spotlight on hero & recipe cards
      hostEl.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        const card = e.target.closest('.wf-hero, .wf-recipe');
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });

      hostEl.addEventListener('click', e => {
        const presetBtn = e.target.closest('[data-wf-preset]');
        if (presetBtn) {
          const p = (cfg.workflowData.presets || []).find(x => x.id === presetBtn.dataset.wfPreset);
          if (p) runCompose(cfg.getLang() === 'en' ? p.queryEn : p.queryZh, true);
          return;
        }
        const openBtn = e.target.closest('[data-wf-open]');
        if (openBtn) {
          const it = cfg.getItems().find(x => x.id === openBtn.dataset.wfOpen);
          if (it) cfg.openDetail(it);
          return;
        }
        const swapBtn = e.target.closest('[data-wf-swap]');
        if (swapBtn) {
          const k = swapBtn.dataset.wfSwap;
          openSwapKey = openSwapKey === k ? null : k;
          renderRecipesDOM(false);
          return;
        }
        if (e.target.closest('[data-wf-swap-close]')) {
          openSwapKey = null;
          renderRecipesDOM(false);
          return;
        }
        const pickBtn = e.target.closest('[data-wf-pick]');
        if (pickBtn) {
          const [r, s, a] = pickBtn.dataset.wfPick.split(':').map(Number);
          swapStep(r, s, a);
          return;
        }
        const shieldBtn = e.target.closest('[data-wf-shield]');
        if (shieldBtn) {
          const idx = Number(shieldBtn.dataset.wfShield);
          openShieldIdx = openShieldIdx === idx ? null : idx;
          renderRecipesDOM(false);
          return;
        }
        const copyBtn = e.target.closest('[data-wf-copy]');
        if (copyBtn) {
          copyRecipeMarkdown(Number(copyBtn.dataset.wfCopy), copyBtn);
          return;
        }
        // Clicking step card body opens detail unless clicking inside swap popover
        if (!e.target.closest('.wf-swap-pop') && !e.target.closest('button')) {
          const stepEl = e.target.closest('.wf-step');
          const detailBtn = stepEl?.querySelector('[data-wf-open]');
          if (detailBtn) {
            const it = cfg.getItems().find(x => x.id === detailBtn.dataset.wfOpen);
            if (it) cfg.openDetail(it);
          }
        }
      });

      document.addEventListener('keydown', e => {
        if (!active || e.key !== 'Escape') return;
        if (openSwapKey || openShieldIdx !== null) {
          openSwapKey = null;
          openShieldIdx = null;
          renderRecipesDOM(false);
        }
      });
    }

    return {
      init(options) {
        cfg = options;
        hostEl = options.stageEl;
        indexById = new Map((cfg.workflowData.items || []).map(x => [x.id, x]));
        const firstPreset = cfg.workflowData.presets?.[0];
        currentQuery = firstPreset ? (cfg.getLang() === 'en' ? firstPreset.queryEn : firstPreset.queryZh) : '我想做视频剪辑';
        buildShell();
      },

      setActive(on) {
        active = !!on;
        if (active) {
          const presets = cfg.workflowData.presets || [];
          const firstPreset = presets[0];
          if (!currentQuery && firstPreset) {
            currentQuery = cfg.getLang() === 'en' ? firstPreset.queryEn : firstPreset.queryZh;
          }
          runCompose(currentQuery, false);
        }
      },

      syncFromGlobalSearch(q) {
        const trimmed = (q || '').trim();
        if (!active || !trimmed || trimmed === currentQuery) return;
        runCompose(trimmed, false);
      },

      refreshLanguage() {
        translateStatic();
        if (active) renderResults(false);
      },
    };
  }

  window.ShijuWorkflow = createWorkflowStudio();
})();
