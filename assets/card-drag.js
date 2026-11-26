(() => {
  const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
        html: '',
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
        html: '',
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
      const cardEl = e.target.closest('[data-drag-card], .card[data-card]');
      if (!cardEl) return;

      const id = cardEl.dataset.dragCard || cardEl.dataset.card;
      if (!id || id.startsWith('cat:') || id.startsWith('group:')) return;
      const item = (cfg.getItems?.() || []).find(i => i.id === id);
      if (!item || !e.dataTransfer) return;

      const payload = buildDragPayload(item, cfg);
      e.dataTransfer.effectAllowed = 'copy';

      try {
        e.dataTransfer.setData('text/plain', payload.text);
        e.dataTransfer.setData('application/x-shiju-card+json', payload.json);
        if (payload.uriList) e.dataTransfer.setData('text/uri-list', payload.uriList);
        if (payload.html) e.dataTransfer.setData('text/html', payload.html);
        // Chromium DownloadURL: enables dragging cards straight into local folders / Desktop as .md files
        const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(payload.markdown)}`;
        e.dataTransfer.setData('DownloadURL', `text/markdown:${payload.filename}:${dataUrl}`);
      } catch {
        // Fallback already populated via text/plain
      }

      activeCard = cardEl;
      cardEl.classList.add('is-dragging');

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

  window.ShijuDrag = { init, buildDragPayload, safeFilename };
})();
