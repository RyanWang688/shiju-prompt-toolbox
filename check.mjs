// Run with node check.mjs. Tests the page's actual filters and URL boundary.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
