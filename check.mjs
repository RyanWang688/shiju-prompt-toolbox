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
const visual=new Function('seed','esc',visualFn+';return visual')([{id:'saved-favorite',cardPreview:{type:'image',src:'assets/cover.png'}}],x=>String(x||''));
// Previously saved favorites predate cardPreview: the current seed still supplies the cover.
assert.ok(visual({id:'saved-favorite',preview:{type:'animation',src:'assets/demo.html'}},true).includes('<img'));
assert.ok(!visual({id:'custom',preview:{type:'animation',src:'assets/demo.html'}},true).includes('<iframe'));
assert.ok(visual({id:'custom',preview:{type:'animation',src:'assets/demo.html'}},false).includes('<iframe'));
console.log('Saved-favorite and custom-animation cards remain free of nested iframes.');
