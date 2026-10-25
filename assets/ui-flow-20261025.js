// Shared helpers for the 2026-10-25 dropdown demos (load before the page script).
const $=id=>document.getElementById(id),reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
const wait=ms=>new Promise(r=>setTimeout(r,reduced?0:ms));
const easeOut='cubic-bezier(.2,.9,.22,1)';
// WAAPI with reduced motion collapsed to an instant jump to the final frame.
function A(el,kf,o={}){const a=el.animate(kf,{fill:'none',...o,duration:reduced?1:o.duration||200,delay:reduced?0:o.delay||0});if(reduced)a.finish();return a}
function fit(){const vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight,portrait=vw/vh<.9,W=portrait?580:920;document.body.classList.toggle('portrait',portrait);$('stage').style.transform=`translate(-50%,-50%) scale(${Math.min(vw/W,vh/600)})`}
new ResizeObserver(fit).observe(document.body);fit();
const tick='<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const chev='<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
// Place a menu under its trigger inside the canvas, flipping above (and shifting left) when it would not fit.
function placeMenu(menu,trigger,{gap=6}={}){const box=menu.offsetParent.getBoundingClientRect(),t=trigger.getBoundingClientRect(),k=box.width/menu.offsetParent.offsetWidth,h=menu.offsetHeight*k,w=menu.offsetWidth*k;
 const below=t.bottom+gap*k+h<=box.bottom||t.top-gap*k-h<box.top,left=Math.min(t.left,box.right-w-8*k)-box.left;
 menu.style.left=left/k+'px';menu.style.top=((below?t.bottom+gap*k:t.top-gap*k-h)-box.top)/k+'px';menu.dataset.side=below?'below':'above';return below}
