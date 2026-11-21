/* Shiju Workflow Studio: Conflict-Free AI Project Stack Composer (zero external deps). */
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
    let scanTimer = 0;

    const RECIPE_PROFILES = [
      {
        badgeZh: '方案 01 · 主推全链路',
        badgeEn: 'Stack 01 · Recommended',
        subZh: '围绕核心需求优先匹配高完成度主力工具，各阶段职责清晰无重叠',
        subEn: 'Balanced end-to-end stack with clear stage boundaries and zero overlapping skills',
        kindBoost: { s: 1.18, w: 1.05, p: 0.92 },
      },
      {
        badgeZh: '方案 02 · 进阶专业流',
        badgeEn: 'Stack 02 · Pro Alternative',
        subZh: '切换不同核心主力引擎，适合追求定制化、自动化或代码级控制的场景',
        subEn: 'Alternative core engine tuned for deeper automation and customizable control',
        kindBoost: { s: 1.22, w: 1.0, p: 0.95 },
      },
      {
        badgeZh: '方案 03 · 轻量敏捷流',
        badgeEn: 'Stack 03 · Agile & Visual',
        subZh: '兼顾上手速度、视觉质感与灵感参考，快速跑通从想法到成品',
        subEn: 'Fast-start mix combining practical web tools, visual polish, and ready prompts',
        kindBoost: { s: 1.02, w: 1.18, p: 1.15 },
      },
    ];

    function tokenizeQuery(q) {
      const clean = (q || '').trim().toLowerCase();
      if (!clean) return [];
      const tokens = new Set();
      // ASCII words
      for (const w of clean.match(/[a-z0-9][a-z0-9_.-]{1,24}/g) || []) tokens.add(w);
      // Chinese segments + bigrams for natural Chinese matching
      for (const seg of clean.match(/[\u4e00-\u9fff]{2,}/g) || []) {
        tokens.add(seg);
        if (seg.length > 2) {
          for (let i = 0; i <= seg.length - 2; i++) tokens.add(seg.slice(i, i + 2));
        }
      }
      return [...tokens];
    }

    function detectIntent(query) {
      const q = (query || '').trim().toLowerCase();
      const tokens = tokenizeQuery(q);
      const domains = cfg.workflowData.domains || [];
      const domainScores = [];

      for (const dom of domains) {
        let sc = 0;
        for (const kw of dom.kws) {
          if (q.includes(kw)) sc += kw.length >= 3 ? 6 : 4;
          else if (tokens.some(t => t.length >= 2 && (kw.includes(t) || t.includes(kw)))) sc += 2;
        }
        if (sc > 0) domainScores.push({ id: dom.id, zh: dom.zh, en: dom.en, score: sc });
      }
      domainScores.sort((a, b) => b.score - a.score);

      // Fallback when user enters a very narrow or novel term: infer top domain from direct item hits
      if (!domainScores.length && q) {
        const items = cfg.getItems();
        const inferred = new Map();
        for (const it of items) {
          const s = cfg.searchScore(it, q);
          if (s <= 0) continue;
          const meta = indexById.get(it.id);
          if (!meta) continue;
          for (const [did, dsc] of Object.entries(meta.d || {})) {
            inferred.set(did, (inferred.get(did) || 0) + dsc * Math.min(8, s / 120));
          }
        }
        for (const dom of domains) {
          const v = inferred.get(dom.id) || 0;
          if (v > 0) domainScores.push({ id: dom.id, zh: dom.zh, en: dom.en, score: Math.round(v) });
        }
        domainScores.sort((a, b) => b.score - a.score);
      }

      if (!domainScores.length) {
        const first = domains[0];
        if (first) domainScores.push({ id: first.id, zh: first.zh, en: first.en, score: 5 });
      }

      return {
        query: q,
        tokens,
        primary: domainScores[0],
        secondary: domainScores[1] && domainScores[1].score >= domainScores[0].score * 0.42 ? domainScores[1] : null,
        allDomains: domainScores.slice(0, 3),
      };
    }

    function scoreItemForIntent(item, meta, intent, kindBoost) {
      let sc = 0;
      const d = meta.d || {};
      if (intent.primary && d[intent.primary.id]) {
        sc += d[intent.primary.id] * 3.4;
      }
      if (intent.secondary && d[intent.secondary.id]) {
        sc += d[intent.secondary.id] * 1.9;
      }
      for (const extra of intent.allDomains.slice(2)) {
        if (d[extra.id]) sc += d[extra.id] * 0.8;
      }

      // Direct semantic & keyword relevance from user free-text
      if (intent.query) {
        const direct = cfg.searchScore(item, intent.query);
        if (direct > 0) sc += Math.min(55, direct * 0.065);
        const hay = `${item.title || ''} ${item.tags || ''} ${item.description || ''} ${(item.en?.title) || ''} ${(item.en?.tags) || ''}`.toLowerCase();
        let tokHits = 0;
        for (const t of intent.tokens) {
          if (t.length >= 2 && hay.includes(t)) tokHits++;
        }
        sc += Math.min(28, tokHits * 4.5);
      }

      if (sc <= 0) return 0;
      const kb = kindBoost[meta.k] || 1;
      return sc * (meta.q || 1) * kb;
    }

    function buildSingleRecipe(profile, intent, bannedCoreIds, bannedCoreGroups, usedAcrossFirst) {
      const items = cfg.getItems();
      const scoredByStage = [[], [], [], []];
      const allScored = [];

      for (const item of items) {
        const meta = indexById.get(item.id);
        if (!meta) continue;
        const sc = scoreItemForIntent(item, meta, intent, profile.kindBoost);
        if (sc < 6) continue;
        const entry = { item, meta, sc };
        scoredByStage[meta.st]?.push(entry);
        allScored.push(entry);
      }

      for (const bucket of scoredByStage) bucket.sort((a, b) => b.sc - a.sc);
      allScored.sort((a, b) => b.sc - a.sc);

      const usedIds = new Set();
      const usedCgs = new Set();
      const steps = [null, null, null, null];
      const isolatedConflicts = new Set();

      const pickForStage = (stIdx, diversifyCore = false) => {
        const pool = scoredByStage[stIdx].length ? scoredByStage[stIdx] : allScored;
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

        // Pass 3: fallback to best global non-conflicting item if stage bucket was sparse
        if (!chosen) {
          for (const cand of allScored) {
            if (usedIds.has(cand.item.id)) continue;
            if (cand.meta.cg && usedCgs.has(cand.meta.cg)) {
              isolatedConflicts.add(cand.meta.cg);
              continue;
            }
            chosen = cand;
            break;
          }
        }

        if (!chosen) return;
        usedIds.add(chosen.item.id);
        if (chosen.meta.cg) usedCgs.add(chosen.meta.cg);

        // Collect safe swap alternatives (same stage or same conflict group, not conflicting with OTHER slots)
        const alts = [];
        for (const cand of pool) {
          if (cand.item.id === chosen.item.id || usedIds.has(cand.item.id)) continue;
          const conflictsWithOther = cand.meta.cg && usedCgs.has(cand.meta.cg) && cand.meta.cg !== chosen.meta.cg;
          if (conflictsWithOther) continue;
          if (cand.meta.cg && cand.meta.cg === chosen.meta.cg) {
            isolatedConflicts.add(cand.meta.cg);
          }
          alts.push(cand);
          if (alts.length >= 4) break;
        }

        steps[stIdx] = {
          stageIdx: stIdx,
          item: chosen.item,
          meta: chosen.meta,
          score: chosen.sc,
          alternatives: alts,
        };
      };

      // Pick Core Engine (stage 1) first to anchor the entire stack, then Plan (0), Polish (2), Ship (3)
      pickForStage(1, true);
      pickForStage(0, false);
      pickForStage(2, false);
      pickForStage(3, false);

      const finalSteps = steps.filter(Boolean);
      const skillCount = finalSteps.filter(s => s.meta.k === 's').length;
      const activeCgs = finalSteps.map(s => s.meta.cg).filter(Boolean);
      const hasConflict = new Set(activeCgs).size !== activeCgs.length;

      return {
        profile,
        steps: finalSteps,
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
              <span class="wf-kicker">WORKFLOW COMPOSER · ZERO-CONFLICT ENGINE</span>
              <h2 class="wf-title" data-wi="描述你的项目需求，自动搭配零冲突工作流"></h2>
              <p class="wf-sub" data-wi="基于工具箱现有 Skills、实用网站与提示词，按「筹备 → 核心 → 精修 → 交付」自动组合，并隔离互斥 Skill 冲突。"></p>
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
          ${domainChips}
        </div>
        <div class="wf-diag-right">
          ${esc(cfg.tr('从 {n} 项内容中生成 {m} 套零冲突流程').replace('{n}', totalItems).replace('{m}', recipes.length))}
        </div>
      `;

      renderRecipesDOM(animate);
    }

    function renderRecipesDOM(animate = false) {
      const listEl = hostEl?.querySelector('#wfRecipes');
      if (!listEl) return;
      const lang = cfg.getLang();

      listEl.innerHTML = currentRecipes.map((rec, rIdx) => {
        const badge = lang === 'en' ? rec.profile.badgeEn : rec.profile.badgeZh;
        const sub = lang === 'en' ? rec.profile.subEn : rec.profile.subZh;
        const isolatedN = rec.isolatedConflictGroups.length;
        const shieldLabel = isolatedN
          ? cfg.tr('0 冲突 · 已隔离 {n} 组互斥').replace('{n}', isolatedN)
          : cfg.tr('0 冲突 · 全阶段兼容');
        const shieldOpen = openShieldIdx === rIdx;

        const shieldDetailHtml = shieldOpen ? `
          <div class="wf-shield-note">
            <strong>${esc(cfg.tr('冲突检测报告'))}</strong>
            ${isolatedN ? `<ul>${rec.isolatedConflictGroups.map(cg => `<li>${esc(conflictText(cg))}</li>`).join('')}</ul>`
            : `<p>${esc(cfg.tr('当前组合内所有 Skill 与工具分属不同执行阶段，无同名规则覆盖或管线冲突。'))}</p>`}
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
              <article class="wf-step ${kindCls}" data-wf-step="${swapKey}">
                <div class="wf-step-top">
                  <span class="wf-stage-pill"><b>0${sIdx + 1}</b> ${esc(sm.name)}</span>
                  <span class="wf-kind-pill ${kindCls}">${esc(kindLabel(item))}</span>
                </div>
                ${cover ? `<div class="wf-step-thumb"><img src="${esc(cover)}" alt="${esc(title)}" loading="lazy"></div>` : `<div class="wf-step-thumb wf-step-thumb-text"><span>${esc(kindLabel(item))}</span><strong>${esc(title.slice(0, 18))}</strong></div>`}
                <div class="wf-step-body">
                  <h4 class="wf-step-title">${esc(title)}</h4>
                  <p class="wf-step-desc">${esc(desc)}</p>
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

    function runCompose(query, withScan = true) {
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

      const hero = hostEl?.querySelector('#wfHero');
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      clearTimeout(scanTimer);
      if (withScan && hero && !reduce) {
        hero.classList.add('is-scanning');
        scanTimer = setTimeout(() => {
          hero.classList.remove('is-scanning');
          renderResults(true);
        }, 280);
      } else {
        hero?.classList.remove('is-scanning');
        renderResults(!reduce);
      }
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
          ? `Conflict Check: Passed (0 conflicting Skills/engines across ${rec.steps.length} stages)`
          : `冲突校验：通过（共 ${rec.steps.length} 阶段，0 组 Skill 互斥冲突）`,
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
      });
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        cfg.toast(cfg.tr('✓ 已复制整套零冲突流程清单'));
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

      const prev = { item: st.item, meta: st.meta, sc: st.score };
      st.item = picked.item;
      st.meta = picked.meta;
      st.score = picked.sc;
      st.alternatives.splice(aIdx, 1, prev);

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
