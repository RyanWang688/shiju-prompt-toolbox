import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const items = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url)));
const data = JSON.parse(readFileSync(new URL('./assets/workflow-index.json', import.meta.url)));
const source = readFileSync(new URL('./assets/workflow-composer.js', import.meta.url), 'utf8');
function setup(pool=items, workflowData=data) {
  const boxes = {'#wfRecipes': {innerHTML:''}, '#wfDiagnosis': {innerHTML:''}};
  const host = {querySelector: s=>boxes[s] || null, querySelectorAll:()=>[], addEventListener(){}};
  let copied='';
  const context = {navigator:{clipboard:{writeText:async text=>{copied=text}}},window:{matchMedia:()=>({matches:true})},document:{addEventListener(){}},clearTimeout};
  // Inspect the actual private engine without adding test-only public API to production.
  vm.runInNewContext(source.replace('      init(options) {', '      synthesizeWorkflows, runCompose, swapStep, hasTerm, copyRecipeMarkdown, inspect:()=>currentRecipes,\n      init(options) {'), context);
  const api = context.window.ShijuWorkflow;
  api.init({stageEl:host,workflowData,getItems:()=>pool,getLang:()=> 'zh',tr:x=>x,tx:(i,k)=>i[k],coverOf:()=>'',resourceLinks:()=>[],toast:()=>{},searchScore:()=>{throw Error('Full prompt search must not admit workflow recommendations');}});
  return {api,boxes,getCopied:()=>copied};
}
const {api,boxes,getCopied}=setup();
const learners = new Set(['website-typewords','website-ethanenglish','skill-kouyu']);
for (const q of ['学习英语','learn English','英语听力','练习口语','背单词','英语']) {
  const {intent,recipes}=api.synthesizeWorkflows(q);
  assert.equal(intent.primary?.id,'language',q);
  assert.ok(recipes.length,q);
  for(const r of recipes) for(const s of r.steps) {
    assert.ok(learners.has(s.item.id),`${q}: unrelated ${s.item.id}`);
    assert.equal(s.stageIdx,1,'Learning tools are alternative engines, not fabricated stages');
  }
}
for(const q of ['', '学习', '火星移民签证办理', 'zxqv987nomatch', '学习 Python']) assert.equal(api.synthesizeWorkflows(q).recipes.length,0,q);
api.runCompose('火星移民签证办理',false);
assert.match(boxes['#wfRecipes'].innerHTML,/暂未找到相关工具/);
api.runCompose('学习英语',false);
assert.match(boxes['#wfRecipes'].innerHTML,/未找到合适条目的阶段/);
assert.match(boxes['#wfRecipes'].innerHTML,/匹配依据/);
assert.doesNotMatch(boxes['#wfRecipes'].innerHTML,/全阶段兼容/);
await api.copyRecipeMarkdown(0,null);
assert.match(getCopied(),/匹配依据: 英语/);
assert.match(getCopied(),/未匹配阶段/);
assert.match(getCopied(),/未验证实际运行兼容性/);
for(const q of ['开发英语学习网站','build an English learning website']) {
  const r=api.synthesizeWorkflows(q);assert.equal(r.intent.primary.id,'frontend');
  assert.ok(r.recipes.length);for(const rec of r.recipes) for(const s of rec.steps) assert.ok(!learners.has(s.item.id));
}
for(const p of data.presets) for(const q of [p.queryZh,p.queryEn]) {
  const result=api.synthesizeWorkflows(q);assert.ok(result.recipes.length,p.id+q);
  const signatures=new Set();
  for(const r of result.recipes) {
    const ids=r.steps.map(s=>s.item.id), groups=r.steps.map(s=>s.meta.cg).filter(Boolean);
    assert.equal(new Set(ids).size,ids.length);
    assert.equal(new Set(groups).size,groups.length);
    const sig=[...ids].sort().join('|');assert.ok(!signatures.has(sig));signatures.add(sig);
    for(const s of r.steps) {
      assert.equal(s.stageIdx,s.meta.st,'No cross-stage fallback');assert.ok(s.reasons.length);
      for(const alt of s.alternatives) {
        assert.equal(alt.meta.st,s.stageIdx);
        assert.ok(!r.steps.some(o=>o!==s&&(o.item.id===alt.item.id || (alt.meta.cg&&o.meta.cg===alt.meta.cg))));
      }
    }
  }
  // Swap choices must stay safe even after earlier swaps have changed the other slots.
  api.runCompose(q,false);
  for(let ri=0;ri<api.inspect().length;ri++) for(let si=0;si<api.inspect()[ri].steps.length;si++) {
    const st=api.inspect()[ri].steps[si];if(!st.alternatives.length)continue;
    api.swapStep(ri,si,0);
    const r=api.inspect()[ri], ids=r.steps.map(s=>s.item.id),groups=r.steps.map(s=>s.meta.cg).filter(Boolean);
    assert.equal(new Set(ids).size,ids.length);assert.equal(new Set(groups).size,groups.length);
    assert.ok(r.conflictFree);
  }
}
const fake=[{id:'poster',title:'spring art',description:'A landscape',tags:''},{id:'pr',title:'PR review',description:'Review pull requests',tags:''}];
const {api:boundaries}=setup(fake,{domains:[{id:'coding',zh:'编程',en:'Coding',kws:['pr']}],presets:[],stages:data.stages,items:fake.map(i=>({id:i.id,k:'w',st:1,d:{coding:10}}))});
assert.equal(boundaries.hasTerm('c++ compiler','c++'),true);
assert.equal(boundaries.hasTerm('threeXjs','three.js'),false);
assert.deepEqual(Array.from(boundaries.synthesizeWorkflows('pr').recipes.flatMap(r=>r.steps.map(s=>s.item.id))),['pr'],'PR must not match spring');
console.log('Workflow checks passed: English relevance, unknown/learning gaps, task intent, ASCII boundaries, all bilingual presets, stage integrity, safe alternatives and repeated swaps.');
