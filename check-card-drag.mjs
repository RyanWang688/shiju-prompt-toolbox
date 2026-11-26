import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const items = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url), 'utf8'));
const dragSource = readFileSync(new URL('./assets/card-drag.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const wfSource = readFileSync(new URL('./assets/workflow-composer.js', import.meta.url), 'utf8');

const context = { window: {} };
vm.runInNewContext(dragSource, context);
const { buildDragPayload, safeFilename } = context.window.ShijuDrag;

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
assert.equal(safeFilename(skill), 'skill-reanimate.md');
assert.ok(skillZh.markdown.includes(skillZh.text));

const skillEn = buildDragPayload(skill, { getLang: () => 'en', tx: txEn });
assert.equal(skillEn.action, 'install-skill');
assert.equal(skillEn.uriList, '');
assert.match(skillEn.text, /Please install and configure this Agent Skill/);
assert.match(skillEn.text, /SKILL\.md \/ README/);

// 2. Prompt card -> exact prompt body, NO text/uri-list
const prompt = items.find(i => i.id === 'dribbble-html-motion-prompt');
assert.ok(prompt, 'dribbble-html-motion-prompt exists');
const promptZh = buildDragPayload(prompt, { getLang: () => 'zh', tx: txZh });
assert.equal(promptZh.action, 'insert-prompt');
assert.equal(promptZh.uriList, '', 'Prompt omits text/uri-list so target receives prompt body');
assert.equal(promptZh.text, prompt.prompt);

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
assert.ok(wfSource.includes('draggable="true" data-drag-card='), 'Workflow step cards have draggable="true" and data-drag-card');

console.log('Card drag checks passed: Skill install payload, Prompt payload, Website payload, DownloadURL filename, and HTML/Workflow draggable wiring.');
