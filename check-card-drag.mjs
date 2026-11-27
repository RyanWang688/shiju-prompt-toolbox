import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const items = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url), 'utf8'));
const dragSource = readFileSync(new URL('./assets/card-drag.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const wfSource = readFileSync(new URL('./assets/workflow-composer.js', import.meta.url), 'utf8');

const context = { window: {} };
vm.runInNewContext(dragSource, context);
const { buildDragPayload, buildBatchDragPayload, safeFilename } = context.window.ShijuDrag;

const txZh = (i, k) => i[k] || '';
const txEn = (i, k) => (i.en && i.en[k]) || i[k] || '';

// 1. Skill card -> auto-install instruction, NO text/uri-list
const skill = items.find(i => i.id === 'skill-reanimate');
assert.ok(skill, 'skill-reanimate exists');
const skillZh = buildDragPayload(skill, { getLang: () => 'zh', tx: txZh });
assert.equal(skillZh.action, 'install-skill');
assert.equal(skillZh.uriList, '', 'Skill omits text/uri-list so Agent receives install instruction');
assert.match(skillZh.text, /安装并配置这个 Agent Skill/);
assert.match(skillZh.text, /NiazMorshed2007\/reanimate/);
assert.ok(skillZh.html.includes('<br>') && skillZh.html.includes('安装并配置这个 Agent Skill'), 'Skill includes text/html for rich-text composers');
assert.equal(safeFilename(skill), 'skill-reanimate.md');
assert.ok(skillZh.markdown.includes(skillZh.text));

const skillEn = buildDragPayload(skill, { getLang: () => 'en', tx: txEn });
assert.equal(skillEn.action, 'install-skill');
assert.equal(skillEn.uriList, '');
assert.match(skillEn.text, /Please install and configure this Agent Skill/);
assert.match(skillEn.text, /SKILL\.md \/ README/);
assert.ok(skillEn.html.includes('<br>') && skillEn.html.includes('Please install and configure this Agent Skill'));

// 2. Prompt card -> exact prompt body, NO text/uri-list
const prompt = items.find(i => i.id === 'dribbble-html-motion-prompt');
assert.ok(prompt, 'dribbble-html-motion-prompt exists');
const promptZh = buildDragPayload(prompt, { getLang: () => 'zh', tx: txZh });
assert.equal(promptZh.action, 'insert-prompt');
assert.equal(promptZh.uriList, '', 'Prompt omits text/uri-list so target receives prompt body');
assert.equal(promptZh.text, prompt.prompt);
assert.ok(promptZh.html.includes('<br>') && promptZh.html.includes('seek(t)'), 'Prompt includes text/html for rich-text composers');

const promptEn = buildDragPayload(prompt, { getLang: () => 'en', tx: txEn });
assert.equal(promptEn.text, prompt.en.prompt);

// 3. Website card -> includes official URL in text and uriList
const site = items.find(i => i.id === 'website-n8n');
assert.ok(site, 'website-n8n exists');
const siteZh = buildDragPayload(site, { getLang: () => 'zh', tx: txZh });
assert.equal(siteZh.action, 'open-website');
assert.equal(siteZh.uriList, 'https://n8n.io');
assert.match(siteZh.text, /https:\/\/n8n\.io/);
assert.match(siteZh.html, /href="https:\/\/n8n\.io"/);

// 4. HTML & Workflow wiring checks
assert.ok(html.includes('assets/card-drag.js'), 'index.html includes card-drag.js');
assert.ok(html.includes('draggable="true" data-kind='), 'Grid cards have draggable="true"');
assert.ok(html.includes('class="card-open" draggable="true"'), 'Card overlay button has draggable="true"');
assert.ok(wfSource.includes('draggable="true" data-drag-card='), 'Workflow step cards have draggable="true" and data-drag-card');
assert.ok(dragSource.includes("effectAllowed = 'all'"), 'Sets effectAllowed = all for rich-text Electron / Windows OLE targets');
assert.ok(!dragSource.includes("setData('DownloadURL'"), 'Must not set DownloadURL so Electron/Agent text drops are never hijacked as empty virtual files');

// 5. End-to-end ShijuDrag.init() runtime test with synthetic dragstart + dragend from .card-open
const listeners = {};
const bodyChildren = [];
const documentStub = {
  addEventListener: (ev, fn) => { listeners[ev] = fn; },
  createElement: () => ({ className: '', innerHTML: '', remove() {} }),
  body: { appendChild: el => bodyChildren.push(el) },
};
const initContext = {
  window: {},
  document: documentStub,
  requestAnimationFrame: fn => fn(),
};
vm.runInNewContext(dragSource, initContext);
initContext.window.ShijuDrag.init({ getItems: () => items, getLang: () => 'zh', tx: txZh });

for (const testId of ['skill-reanimate', 'dribbble-html-motion-prompt']) {
  const classes = new Set();
  const cardEl = {
    dataset: { card: testId },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
  };
  const targetEl = {
    closest: sel => (sel.includes('.card[data-card]') ? cardEl : null),
  };
  const droppedData = new Map();
  const dt = {
    effectAllowed: '',
    setData: (type, val) => droppedData.set(type, val),
    setDragImage: () => {},
  };
  listeners.dragstart({ target: targetEl, dataTransfer: dt });
  assert.equal(dt.effectAllowed, 'all', `${testId}: effectAllowed must be all`);
  assert.ok(droppedData.get('text/plain')?.length > 0, `${testId}: text/plain populated`);
  assert.ok(droppedData.get('text/html')?.includes('<br>'), `${testId}: text/html populated`);
  assert.ok(droppedData.has('application/x-shiju-card+json'), `${testId}: structured JSON populated`);
  assert.ok(!droppedData.has('text/uri-list'), `${testId}: omits text/uri-list`);
  assert.ok(!droppedData.has('DownloadURL'), `${testId}: omits DownloadURL`);
  assert.ok(classes.has('is-dragging'), `${testId}: marks card .is-dragging`);
  listeners.dragend();
  assert.ok(!classes.has('is-dragging'), `${testId}: clears .is-dragging on dragend`);
}

// 6. Batch multi-select drag payload test
const s2 = items.find(i => i.id === 'skill-cinetic');
assert.ok(s2, 'skill-cinetic exists');
const batchZh = buildBatchDragPayload([skill, s2], { getLang: () => 'zh', tx: txZh });
assert.equal(batchZh.action, 'batch-install-skills');
assert.equal(batchZh.count, 2);
assert.match(batchZh.text, /批量安装并配置以下 2 个 Agent Skills/);
assert.match(batchZh.text, /NiazMorshed2007\/reanimate/);
assert.match(batchZh.text, /Leonxlnx\/cinetic/);
assert.ok(batchZh.html.includes('<br>'));
assert.ok(html.includes('id="multiSelectBtn"') && html.includes('id="multiDock"') && html.includes('data-drag-batch="1"'), 'HTML includes multi-select button and batch drag dock');

console.log('Card drag checks passed: Skill & Prompt rich HTML/plain payloads, batch multi-skill drag payload, effectAllowed=all, and init() lifecycle.');
