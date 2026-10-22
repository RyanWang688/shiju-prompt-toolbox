// Run with node check.mjs. Tests the page's actual filters and URL boundary.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const source=readFileSync(new URL('./index.template.html',import.meta.url),'utf8');
function pageFunction(name){
  const line=source.split('\n').find(line=>line.startsWith(`function ${name}(`));
  assert.ok(line,`Missing page function: ${name}`);
  return new Function(`return (${line})`)();
}
const matches=pageFunction('matches');
const websiteUrl=pageFunction('websiteUrl');
const site={kind:'website',category:'其他',favorite:true};
assert.equal(matches(site,'实用网站'),true);
assert.equal(matches(site,'提示词'),false);
assert.equal(matches(site,'Skills'),false);
assert.equal(matches(site,'我的收藏'),true);
assert.equal(matches({kind:'skill'},'实用网站'),false);
assert.equal(matches({category:'动画动效'},'提示词'),true);
assert.equal(websiteUrl('https://opencut.app/'),'https://opencut.app/');
for(const invalid of ['javascript:alert(1)','data:text/html,test','file:///tmp/test','ftp://example.com','/relative','']){
  assert.equal(websiteUrl(invalid),'');
}
console.log('Website filtering and safe link checks passed.');
const groupsLine=source.split('\n').find(line=>line.startsWith('const navGroups='));
const groups=new Function(`${groupsLine};return navGroups`)();
assert.equal(groups.length,3);
assert.equal(new Set(groups.flatMap(g=>g.items.map(([label])=>label))).size,10);
for(const group of groups)for(const [,icon] of group.items){
  assert.ok(existsSync(new URL(`./assets/icons/${icon}.svg`,import.meta.url)),`Missing navigation icon ${icon}`);
}
// Exercise the actual tooltip helpers, including viewport clamping and cleanup.
const tooltip={hidden:true,style:{}};
const attributes={};
const button={dataset:{tooltip:'Skills · 7 条'},getBoundingClientRect:()=>({right:60,top:490,height:44}),setAttribute:(key,value)=>attributes[key]=value,removeAttribute:key=>delete attributes[key]};
const tooltipFunctions=source.split('\n').filter(line=>/^function (showRailTooltip|hideRailTooltip)\(/.test(line)).join('\n');
const tooltipAPI=new Function('$','innerHeight',`let tooltipButton=null,tooltipDismissed=false;${tooltipFunctions};return {showRailTooltip,hideRailTooltip}`)(()=>tooltip,520);
tooltipAPI.showRailTooltip(button);
assert.equal(tooltip.hidden,false);
assert.equal(tooltip.textContent,'Skills · 7 条');
assert.equal(tooltip.style.top,'476px');
assert.equal(attributes['aria-describedby'],'railTooltip');
tooltipAPI.hideRailTooltip();
assert.equal(tooltip.hidden,true);
assert.equal(attributes['aria-describedby'],undefined);
console.log('Grouped navigation assets and tooltip placement checks passed.');

const resourceFn=source.split('\n').find(line=>line.startsWith('function resourceLinks('));
const resourceLinks=new Function('websiteUrl',resourceFn+';return resourceLinks')(websiteUrl);
assert.deepEqual(resourceLinks({kind:'skill',source:'https://github.com/example/project',repository:'https://github.com/example/project',documentation:'https://github.com/example/project/blob/main/SKILL.md'}).map(x=>x.label),['官方项目','使用说明']);
assert.deepEqual(resourceLinks({kind:'website',officialUrl:'javascript:alert(1)',repository:'data:text/html,x',documentation:'file:///test'}),[]);
assert.equal(resourceLinks({kind:'prompt',source:'https://example.com'}).length,0);
assert.equal(resourceLinks({kind:'website',source:'https://opencut.app/'}).length,1);
console.log('Official resource links: safe protocols, fallback and deduplication passed.');
assert.ok(!source.includes('id="edit"')&&!source.includes('id="delete"'));
assert.ok(!source.includes("$('edit').onclick")&&!source.includes("$('delete').onclick"));
const outsideFn=source.split('\n').find(line=>line.startsWith('function outsideDetail('));
const outsideDetail=new Function('$',outsideFn+';return outsideDetail')(()=>({getBoundingClientRect:()=>({left:100,right:800,top:50,bottom:600})}));
assert.equal(outsideDetail({clientX:400,clientY:300}),false);
assert.equal(outsideDetail({clientX:90,clientY:300}),true);
assert.equal(outsideDetail({clientX:400,clientY:610}),true);
console.log('Detail dismissal geometry and removed edit/delete controls passed.');
const visualFn=source.split('\n').find(line=>line.startsWith('function visual('));
const visual=new Function('seed','esc','tr','tx','lang',visualFn+';return visual')([{id:'saved-favorite',cardPreview:{type:'image',src:'assets/cover.png'}}],x=>String(x||''),x=>x,(item,field)=>item[field],'zh');
// Previously saved favorites predate cardPreview: the current seed still supplies the cover.
assert.ok(visual({id:'saved-favorite',preview:{type:'animation',src:'assets/demo.html'}},true).includes('<img'));
assert.ok(!visual({id:'custom',preview:{type:'animation',src:'assets/demo.html'}},true).includes('<iframe'));
assert.ok(visual({id:'custom',preview:{type:'animation',src:'assets/demo.html'}},false).includes('<iframe'));
console.log('Saved-favorite and custom-animation cards remain free of nested iframes.');
const topicsCode=source.split('\n').filter(line=>/^(const (topicNames|sectionKind|kindOf)=|function (topicsFor|matchesTopic)\()/.test(line)).join('\n');
const topicAPI=new Function('seed',topicsCode+';return {topicsFor,matchesTopic,topicNames}')([{id:'old-favorite',skillTopics:['图像创作']},{id:'old-site',kind:'website',topics:['设计素材']}]);
assert.deepEqual(topicAPI.topicsFor({id:'old-favorite',kind:'skill',category:'界面设计'}),['图像创作']);
assert.equal(topicAPI.matchesTopic({kind:'website',skillTopics:['图像创作']},'Skills','图像创作'),false);
assert.equal(topicAPI.matchesTopic({kind:'skill',skillTopics:['图像创作','动画视频']},'Skills','动画视频'),true);
assert.deepEqual(topicAPI.topicsFor({kind:'skill',skillTopics:['unknown'],category:'其他'}),['其他']);
// Prompts and websites have their own topic tabs; saved favorites fall back to the seed's topics.
assert.deepEqual(topicAPI.topicsFor({id:'old-site',kind:'website'}),['设计素材']);
assert.equal(topicAPI.matchesTopic({category:'动画动效',topics:['按钮交互']},'提示词','按钮交互'),true);
assert.equal(topicAPI.matchesTopic({kind:'website',topics:['按钮交互']},'提示词','全部'),false);
assert.deepEqual(topicAPI.topicsFor({kind:'website',topics:['卡片交互']}),['其他']);
const seedItems=JSON.parse(readFileSync(new URL('./prompts.json',import.meta.url),'utf8'));
for(const item of seedItems){
  assert.ok(item.en?.title&&item.en?.description,`Missing English text for ${item.id}`);
  if(item.kind!=='skill')assert.ok(!topicAPI.topicsFor(item).includes('其他'),`Missing topic for ${item.id}`);
}
// Every navigation label and topic tab must have an English label.
const enLine=source.match(/^const EN=[\s\S]*?\};$/m)[0];
const EN=new Function(`${enLine};return EN`)();
for(const label of [...groups.flatMap(g=>[g.label,...g.items.map(([name])=>name)]),...Object.values(topicAPI.topicNames).flat(),'全部'])if(label!=='Skills')assert.ok(EN[label],`Missing English label: ${label}`);
console.log('Prompt and website topics, English entries and labels passed.');
const animateCode=source.split('\n').filter(line=>/^(const springRise=|function transitionCards\()/.test(line)).join('\n');
let calls=0;const frames=[];
const mockCard={dataset:{card:'one'},style:{},getBoundingClientRect:()=>({top:200,left:10,bottom:400}),animate:()=>{calls++;return {cancel(){}}}};
const mockGrid={querySelectorAll:()=>[mockCard]};
const transitions=new Function('$','matchMedia','requestAnimationFrame','innerHeight',`let filterRevision=0,filterAnimations=[];${animateCode};return transitionCards`)(()=>mockGrid,()=>({matches:false}),fn=>frames.push(fn),800);
transitions(()=>{});transitions(()=>{});while(frames.length)frames.shift()();
assert.equal(calls,1,'Interrupted transition must not animate a stale filter');
const reduced=new Function('$','matchMedia','requestAnimationFrame','innerHeight',`let filterRevision=0,filterAnimations=[];${animateCode};return transitionCards`)(()=>mockGrid,()=>({matches:true}),()=>{throw Error('Reduced motion must not enqueue animation')},800);
reduced(()=>{});
// Section changes cascade in with a spring: hidden until the frame, then one staggered animation per card.
let cascadeOptions;const cascadeFrames=[];
mockCard.animate=(keyframes,options)=>{cascadeOptions={keyframes,options};return {cancel(){}}};
const cascade=new Function('$','matchMedia','requestAnimationFrame','innerHeight',`let filterRevision=0,filterAnimations=[];${animateCode};return transitionCards`)(()=>mockGrid,()=>({matches:false}),fn=>cascadeFrames.push(fn),800);
cascade(()=>{},true);assert.equal(mockCard.style.opacity,'0');while(cascadeFrames.length)cascadeFrames.shift()();
assert.equal(mockCard.style.opacity,'');assert.equal(cascadeOptions.options.fill,'backwards');
assert.ok(cascadeOptions.keyframes.some(frame=>parseFloat(frame.transform.replace('translateY(',''))<0),'Spring must overshoot above its resting place');
console.log('Skills topic membership, saved favorites, rapid switching and reduced motion passed.');

// Exercise indicator geometry and its real frame loop: the trailing edge must wait six frames.
const elasticCode=source.split('\n').filter(line=>/^function (elasticEase|elasticTopicRect|animateTopicIndicator)\(/.test(line)).join('\n');
function runIndicator(from,to,reduced=false){
  const samples=[],queue=new Map();let sequence=0;
  const animate=new Function('paintTopic','matchMedia','requestAnimationFrame','cancelAnimationFrame',`let topicFrame=0,topicMoving=false;${elasticCode};return animateTopicIndicator`)(rect=>samples.push(rect),()=>({matches:reduced}),fn=>{queue.set(++sequence,fn);return sequence},id=>queue.delete(id));
  animate(from,to);let now=0;
  while(queue.size){assert.ok(now<2000,'Animation must finish');const [id,fn]=queue.entries().next().value;queue.delete(id);fn(now);now+=1000/60}
  return samples;
}
const origin={left:0,top:0,width:100,height:44},destination={left:110,top:0,width:100,height:44};
const elasticSamples=runIndicator(origin,destination);
assert.ok(elasticSamples.slice(0,6).every(r=>r.left===origin.left),'Trailing edge starts only after six frames');
assert.ok(Math.max(...elasticSamples.map(r=>r.width))>200,'Indicator must stretch beyond twice its width');
assert.deepEqual(elasticSamples.at(-1),destination);
assert.deepEqual(runIndicator(destination,origin).at(-1),origin);
assert.deepEqual(runIndicator(origin,destination,true),[destination]);
assert.ok(!source.includes('data-rate=')&&!source.includes('function rating(')&&!source.includes('value="rating"'));
assert.ok(!source.includes('按主题找 Skill')&&!source.includes('可搭配搜索与评分排序'));
console.log('Elastic indicator delay, stretch, reverse direction, reduced motion and rating removal passed.');

// Clipboard feedback must follow the write result, survive repeated clicks, and ignore stale writes.
const copyHandler=source.split('\n').find(line=>line.startsWith("$('copy').onclick="));
const copyReset=source.split('\n').filter(line=>/^function (resetCopy|copyLabel)\(/.test(line)).join('\n');
function copyHarness(writeText){
  const classes=new Set(),messages=[],timers=new Map();let sequence=0;
  const button={textContent:'复制提示词',disabled:false,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},getAnimations:()=>[],animate:()=>{}};
  const reset=new Function('$','navigator','selected','toast','matchMedia','setTimeout','clearTimeout','tr',`let copyRevision=0,copyTimer;${copyReset}\n${copyHandler};return resetCopy`)(()=>button,{clipboard:{writeText}},{kind:'prompt',prompt:'保留原文。'},msg=>messages.push(msg),()=>({matches:true}),fn=>{timers.set(++sequence,fn);return sequence},id=>timers.delete(id),x=>x);
  return {button,classes,messages,reset,finish:()=>{for(const fn of timers.values())fn();timers.clear()}};
}
let copied='';const successfulCopy=copyHarness(async text=>{copied=text});
await successfulCopy.button.onclick();await successfulCopy.button.onclick();
assert.equal(copied,'保留原文。');assert.ok(successfulCopy.classes.has('copy-success'));
assert.ok(successfulCopy.messages.every(message=>message.includes('复制成功')));
successfulCopy.finish();assert.equal(successfulCopy.button.textContent,'复制提示词');
const failedCopy=copyHarness(async()=>{throw Error('Clipboard denied')});await failedCopy.button.onclick();
assert.ok(!failedCopy.classes.has('copy-success'));assert.match(failedCopy.messages[0],/复制失败/);assert.equal(failedCopy.button.disabled,false);
let resolveWrite;const staleCopy=copyHarness(()=>new Promise(resolve=>{resolveWrite=resolve}));
const pendingCopy=staleCopy.button.onclick();staleCopy.reset();resolveWrite();await pendingCopy;
assert.equal(staleCopy.messages.length,0);assert.ok(!staleCopy.classes.has('copy-success'));
console.log('Copy success, failure, repeated clicks and stale feedback checks passed.');
