// Shared helpers for the 2026-10-24 loading / onboarding demos (load before the page script).
const $=id=>document.getElementById(id),reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
const wait=ms=>new Promise(r=>setTimeout(r,reduced?0:ms));
const spring='cubic-bezier(.34,1.56,.64,1)',easeOut='cubic-bezier(.2,.9,.22,1)';
// WAAPI with reduced motion collapsed to an instant jump to the final frame.
function A(el,kf,o={}){const a=el.animate(kf,{fill:'both',...o,duration:reduced?1:o.duration||300,delay:reduced?0:o.delay||0});if(reduced&&a.effect.getTiming().iterations!==Infinity)a.finish();return a}
function fit(){$('stage').style.transform=`translate(-50%,-50%) scale(${Math.min(innerWidth/900,innerHeight/710)})`}
new ResizeObserver(fit).observe(document.body);fit();
// Screen px → app px (the app is drawn at 0.6 inside a stage that is itself scaled).
const appScale=()=>document.querySelector('.app').getBoundingClientRect().width/390;
function appRect(el){const a=document.querySelector('.app').getBoundingClientRect(),r=el.getBoundingClientRect(),k=a.width/390;return{left:(r.left-a.left)/k,top:(r.top-a.top)/k,width:r.width/k,height:r.height/k}}
