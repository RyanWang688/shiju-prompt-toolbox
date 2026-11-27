(() => {
  const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const textToHtml = s => escHtml(s).replace(/\n/g, '<br>');

  function safeFilename(item, fallback = 'card') {
    const raw = String(item?.id || fallback).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return `${raw || fallback}.md`;
  }

  function primaryUrlOf(item, resourceLinks) {
    const links = typeof resourceLinks === 'function' ? resourceLinks(item) : [];
    const repo = item.repository && /^https?:\/\//i.test(item.repository) ? item.repository : '';
    const site = item.officialUrl && /^https?:\/\//i.test(item.officialUrl) ? item.officialUrl : '';
    const src = item.source && /^https?:\/\//i.test(item.source) ? item.source : '';
    if (item.kind === 'skill') return repo || site || src || links[0]?.url || '';
    return site || repo || src || links[0]?.url || '';
  }

  function buildDragPayload(item, opts = {}) {
    const lang = opts.getLang ? opts.getLang() : 'zh';
    const tx = opts.tx || ((i, k) => i[k] || '');
    const kind = item.kind === 'skill' ? 'skill' : item.kind === 'website' ? 'website' : 'prompt';
    const title = tx(item, 'title') || item.title || item.id;
    const desc = tx(item, 'description') || item.description || '';
    const url = primaryUrlOf(item, opts.resourceLinks);
    const repo = item.repository && /^https?:\/\//i.test(item.repository) ? item.repository : '';
    const promptBody = (lang === 'en' && item.en?.prompt) ? item.en.prompt : (item.prompt || desc || title);
    const filename = safeFilename(item, kind);

    if (kind === 'skill') {
      const text = lang === 'en'
        ? [
            `Please install and configure this Agent Skill: ${title}`,
            url ? `- Repository: ${url}` : '',
            desc ? `- Summary: ${desc}` : '',
            'Please inspect its SKILL.md / README installation instructions and complete the installation for me.',
          ].filter(Boolean).join('\n')
        : [
            `请帮我安装并配置这个 Agent Skill：《${title}》`,
            url ? `- 官方仓库：${url}` : '',
            desc ? `- 简介：${desc}` : '',
            '请读取仓库中的 SKILL.md 或 README 安装说明，直接为我完成安装与配置。',
          ].filter(Boolean).join('\n');

      const md = [
        `# ${title}`,
        '',
        `> Auto-Install Agent Instruction / 自动安装指令`,
        '',
        text,
        '',
        '---',
        '',
        promptBody,
      ].join('\n');

      return {
        kind,
        action: 'install-skill',
        title,
        text,
        uriList: '', // Omit text/uri-list so AI chat inputs always receive the full install instruction
        html: textToHtml(text),
        filename,
        markdown: md,
        badge: lang === 'en' ? 'Skill · Drop into Agent to install' : 'Skill · 拖入 Agent 自动安装',
        json: JSON.stringify({
          schema: 'shiju.card.v1',
          action: 'install-skill',
          id: item.id,
          kind,
          title,
          repository: repo || url,
          officialUrl: url,
          description: desc,
          text,
        }),
      };
    }

    if (kind === 'prompt') {
      const md = [
        `# ${title}`,
        '',
        desc ? `> ${desc}\n` : '',
        promptBody,
      ].filter(Boolean).join('\n');

      return {
        kind,
        action: 'insert-prompt',
        title,
        text: promptBody,
        uriList: '', // Omit text/uri-list so dropping into any AI/editor writes the exact prompt
        html: textToHtml(promptBody),
        filename,
        markdown: md,
        badge: lang === 'en' ? 'Prompt · Drop to insert prompt' : '提示词 · 拖入自动写入',
        json: JSON.stringify({
          schema: 'shiju.card.v1',
          action: 'insert-prompt',
          id: item.id,
          kind,
          title,
          description: desc,
          text: promptBody,
        }),
      };
    }

    // Website / open-source project card
    const text = [title, url, desc].filter(Boolean).join('\n');
    const md = [
      `# ${title}`,
      '',
      url ? `- Official: ${url}` : '',
      repo && repo !== url ? `- Repository: ${repo}` : '',
      desc ? `\n${desc}` : '',
      '',
      promptBody && promptBody !== desc ? `---\n\n${promptBody}` : '',
    ].filter(Boolean).join('\n');

    return {
      kind,
      action: 'open-website',
      title,
      text,
      uriList: url,
      html: url ? `<a href="${escHtml(url)}">${escHtml(title)}</a>` : '',
      filename,
      markdown: md,
      badge: lang === 'en' ? 'Site · Drop into folder, browser or Agent' : '项目 · 拖入文件夹 / 浏览器 / Agent',
      json: JSON.stringify({
        schema: 'shiju.card.v1',
        action: 'open-website',
        id: item.id,
        kind,
        title,
        officialUrl: url,
        repository: repo,
        description: desc,
        text,
      }),
    };
  }

  function buildBatchDragPayload(itemsList, opts = {}) {
    const list = Array.isArray(itemsList) ? itemsList.filter(Boolean) : [];
    if (list.length <= 1) return list[0] ? buildDragPayload(list[0], opts) : null;

    const lang = opts.getLang ? opts.getLang() : 'zh';
    const tx = opts.tx || ((i, k) => i[k] || '');
    const skills = list.filter(i => i.kind === 'skill');
    const prompts = list.filter(i => i.kind !== 'skill' && i.kind !== 'website');
    const sites = list.filter(i => i.kind === 'website');
    const parts = [];

    if (skills.length) {
      parts.push(
        lang === 'en'
          ? `Please batch-install and configure these ${skills.length} Agent Skills:`
          : `请帮我批量安装并配置以下 ${skills.length} 个 Agent Skills：`
      );
      skills.forEach((it, idx) => {
        const title = tx(it, 'title') || it.title || it.id;
        const url = primaryUrlOf(it, opts.resourceLinks);
        const desc = tx(it, 'description') || it.description || '';
        parts.push(
          lang === 'en'
            ? `${idx + 1}. ${title}${url ? ` — Repo: ${url}` : ''}${desc ? ` (${desc})` : ''}`
            : `${idx + 1}. 《${title}》${url ? ` — 仓库：${url}` : ''}${desc ? `（${desc}）` : ''}`
        );
      });
      parts.push(
        lang === 'en'
          ? 'Please inspect each SKILL.md / README and complete the installation for all of them.'
          : '请逐一读取对应仓库的 SKILL.md 或 README 安装说明，直接为我完成批量安装与配置。'
      );
    }

    if (prompts.length) {
      if (parts.length) parts.push('');
      parts.push(lang === 'en' ? `Prompts (${prompts.length}):` : `以下 ${prompts.length} 条提示词：`);
      prompts.forEach((it, idx) => {
        const title = tx(it, 'title') || it.title || it.id;
        const body = (lang === 'en' && it.en?.prompt) ? it.en.prompt : (it.prompt || tx(it, 'description') || title);
        parts.push(`${idx + 1}. 【${title}】\n${body}`);
      });
    }

    if (sites.length) {
      if (parts.length) parts.push('');
      parts.push(lang === 'en' ? `Reference Sites (${sites.length}):` : `以下 ${sites.length} 个项目参考：`);
      sites.forEach((it, idx) => {
        const title = tx(it, 'title') || it.title || it.id;
        const url = primaryUrlOf(it, opts.resourceLinks);
        parts.push(`${idx + 1}. ${title}${url ? ` (${url})` : ''}`);
      });
    }

    const text = parts.join('\n');
    const title = lang === 'en' ? `${list.length} selected items` : `已选 ${list.length} 项内容`;
    const badge = lang === 'en'
      ? `Batch (${list.length}) · Drop into Agent`
      : `批量拖拽 ${list.length} 项 · 拖入 Agent 一键安装`;

    return {
      kind: skills.length === list.length ? 'skill' : 'batch',
      action: skills.length ? 'batch-install-skills' : 'batch-insert',
      count: list.length,
      title,
      text,
      uriList: '',
      html: textToHtml(text),
      badge,
      json: JSON.stringify({
        schema: 'shiju.batch.v1',
        count: list.length,
        items: list.map(i => ({ id: i.id, kind: i.kind, url: primaryUrlOf(i, opts.resourceLinks) })),
        text,
      }),
    };
  }

  function createDragGhost(payload) {
    const ghost = document.createElement('div');
    ghost.className = `drag-ghost is-${payload.kind}`;
    ghost.innerHTML = `<span class="drag-ghost-tag">${escHtml(payload.badge)}</span><strong class="drag-ghost-title">${escHtml(payload.title)}</strong>`;
    document.body.appendChild(ghost);
    return ghost;
  }

  function init(options) {
    const cfg = options || {};
    let activeCard = null;

    document.addEventListener('dragstart', e => {
      if (e.target.closest('input, textarea, .wf-swap-pop')) return;
      const batchEl = e.target.closest('[data-drag-batch]');
      const cardEl = e.target.closest('[data-drag-card], .card[data-card]');
      if (!batchEl && !cardEl) return;

      const allItems = cfg.getItems?.() || [];
      const selectedSet = cfg.getSelectedIds?.();
      let payload = null;

      if (batchEl) {
        if (!selectedSet || !selectedSet.size) return;
        const selectedItems = allItems.filter(i => selectedSet.has(i.id));
        payload = buildBatchDragPayload(selectedItems, cfg);
      } else {
        const id = cardEl.dataset.dragCard || cardEl.dataset.card;
        if (!id || id.startsWith('cat:') || id.startsWith('group:')) return;
        if (selectedSet && selectedSet.size > 1 && selectedSet.has(id)) {
          const selectedItems = allItems.filter(i => selectedSet.has(i.id));
          payload = buildBatchDragPayload(selectedItems, cfg);
        } else {
          const item = allItems.find(i => i.id === id);
          if (!item) return;
          payload = buildDragPayload(item, cfg);
        }
      }

      if (!payload || !e.dataTransfer) return;

      e.dataTransfer.effectAllowed = 'all';

      try {
        e.dataTransfer.setData('text/plain', payload.text);
        e.dataTransfer.setData('application/x-shiju-card+json', payload.json);
        if (payload.uriList) e.dataTransfer.setData('text/uri-list', payload.uriList);
        if (payload.html) e.dataTransfer.setData('text/html', payload.html);
      } catch {
        // Fallback already populated via text/plain
      }

      activeCard = batchEl || cardEl;
      activeCard.classList.add('is-dragging');

      if (typeof e.dataTransfer.setDragImage === 'function') {
        const ghost = createDragGhost(payload);
        e.dataTransfer.setDragImage(ghost, 22, 22);
        requestAnimationFrame(() => ghost.remove());
      }
    });

    document.addEventListener('dragend', () => {
      if (activeCard) {
        activeCard.classList.remove('is-dragging');
        activeCard = null;
      }
    });
  }

  window.ShijuDrag = { init, buildDragPayload, buildBatchDragPayload, safeFilename };
})();
