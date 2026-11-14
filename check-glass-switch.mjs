// Test the standalone demo's own controller, including idle work and interruption.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('./assets/glass-glow-theme-switch/preview.html',import.meta.url),'utf8');
const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
let time=0,serial=0,reduced=false;const jobs=new Map(),events={};
const element=()=>({style:{setProperty(k,v){this[k]=v}},attrs:{},children:[],setAttribute(k,v){this.attrs[k]=v},append(x){this.children.push(x)}});
const els=new Map(['.switch','.thumb','.rail-day','.surface-day','.light-night','.light-day','.moon','.sun','#moon-pixels','#sun-pixels'].map(s=>[s,element()]));
const control=els.get('.switch'),thumb=els.get('.thumb');
control.clientWidth=440;thumb.offsetWidth=190;thumb.getBoundingClientRect=()=>({left:10,top:10,width:190,height:190});
control.addEventListener=(n,fn)=>events[n]=fn;control.setPointerCapture=()=>{};
const context=vm.createContext({URLSearchParams,location:{search:''},Math,document:{body:{dataset:{}},documentElement:{},querySelector:s=>els.get(s),querySelectorAll:()=>[],getElementById:id=>els.get('#'+id),createElementNS:element},matchMedia:()=>({get matches(){return reduced}}),performance:{now:()=>time},requestAnimationFrame:fn=>{jobs.set(++serial,fn);return serial},cancelAnimationFrame:id=>jobs.delete(id),ResizeObserver:class{constructor(fn){this.fn=fn}observe(){this.fn()}}});
vm.runInContext(code,context);
function advance(ms=900){const end=time+ms;while(time<end){time+=1000/120;const work=[...jobs.values()];jobs.clear();work.forEach(fn=>fn(time))}}
function key(key){events.keydown({key,preventDefault(){}})}
advance();assert.equal(jobs.size,0,'No continuous rendering while idle');
key('ArrowRight');advance(200);const interrupted=thumb.style.transform;key('ArrowLeft');assert.equal(thumb.style.transform,interrupted,'Reversal starts at the current position');advance();
assert.equal(thumb.style.transform,'translate3d(0px,0,0)');assert.equal(jobs.size,0);
events.pointerdown({button:0,clientX:10,pointerId:1});events.pointermove({clientX:190,clientY:100});advance(10);assert.ok(parseFloat(els.get('.rail-day').style.opacity)>.5);events.pointerup();advance();assert.equal(els.get('.rail-day').style.opacity,1);assert.equal(jobs.size,0);
assert.equal(control.style['--edge'],-28,'Right endpoint light is at the lower-right corner');
reduced=true;key('ArrowLeft');assert.equal(control.style['--edge'],22,'Left endpoint light is at the upper-left corner');
for(const progress of [0,.25,.5,.75,1]){
  events.pointerdown({button:0,clientX:0,pointerId:1});
  events.pointermove({clientX:230*progress,clientY:0});advance(10);
  assert.equal(control.style['--edge'],22-50*progress,'Edge follows the exact thumb progress');
  assert.equal(control.style['--light-angle'],`${180*progress}deg`,'Aura follows the same progress');
  events.pointerup();key('ArrowLeft');
}
events.pointermove({clientX:400,clientY:190});assert.equal(jobs.size,0,'Hover alone never schedules a light update');
assert.equal(control.style['--edge'],22,'Hover does not change light position');
const edge=control.style['--edge'];advance(1000);assert.equal(control.style['--edge'],edge,'Highlight does not drift while pointer and thumb rest');
reduced=true;key('ArrowLeft');assert.equal(thumb.style.transform,'translate3d(0px,0,0)');assert.equal(jobs.size,0,'Reduced motion applies immediately');
assert.ok(!html.includes('infinite'),'No idle CSS loops');
assert.ok(html.includes('href="preview.html" download="glass-glow-switch.html"'),'Source download targets the standalone HTML');
console.log('Glass switch: position-linked light at five progress values, pointer independence, dragging, reversal, idle highlight stability, no idle frame loop and reduced motion passed.');
