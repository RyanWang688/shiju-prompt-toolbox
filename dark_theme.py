"""Generate assets/dashboard-dark.css from the light styles (run by build.py).

Every rule in dashboard.css and the page's inline <style> that paints a neutral colour (white surfaces, grey lines,
near-black ink) gets a html[data-theme=dark] copy with that colour remapped; brand and demo colours (yellow accent,
red heart, ...) are left alone. Hand-tuned rules for the few places a mechanical remap gets wrong are appended."""
import re
from pathlib import Path

COLOR_PROPS = {'color', 'background', 'background-color', 'background-image', 'border', 'border-color', 'border-top',
               'border-right', 'border-bottom', 'border-left', 'border-top-color', 'border-bottom-color', 'border-left-color',
               'border-right-color', 'outline', 'outline-color', 'box-shadow', 'fill', 'stroke', 'text-decoration-color',
               'caret-color', '-webkit-text-fill-color', 'column-rule'}
# Light value → dark value. Layered near-black surfaces in the spirit of Linear / Vercel / GitHub dark:
# page #09090b, cards and panels #111113, raised fills #18181b–#1f1f23, hairline borders #232327, off-white ink.
TABLE = {'ffffff': '111113', 'fafafa': '0e0e10', 'f9f9f7': '0e0e10', 'f7f7f5': '0e0e10', 'f5f5f5': '09090b', 'f4f4f2': '1a1a1d',
         'f3f3f1': '1a1a1d', 'f2f2f2': '1a1a1d', 'f0f0f0': '1c1c1f', 'eeeeee': '18181b', 'ececec': '1f1f23', 'e6e6e6': '232327',
         'e3e3e3': '232327', 'dedede': '232327', 'dcdcdc': '26262b', 'd7d7d7': '2a2a30', 'c4c4c4': '3a3a41', 'bdbdbd': '3f3f46',
         'a3a3a3': '3f3f46', '9a9a9a': '71717a', '8a8a8a': '7c7c85', '6b6b6b': '8e8e96', '595959': 'a1a1aa', '3d3d3d': 'c4c4cc',
         '333333': 'd4d4d8', '2b2b2b': 'e4e4e7', '191919': 'ededef', '111111': 'f4f4f5', '000000': 'fafafa'}
HEX = re.compile(r'#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b')

def expand(h):
    return ''.join(c * 2 for c in h) if len(h) in (3, 4) else h

def neutral(rgb):
    r, g, b = (int(rgb[i:i + 2], 16) for i in (0, 2, 4))
    return max(r, g, b) - min(r, g, b) <= 14, (r + g + b) / 3

def remap(value, shadow):
    def one(m):
        h = expand(m.group(1).lower()); rgb, alpha = h[:6], h[6:]
        is_neutral, level = neutral(rgb)
        if not is_neutral:
            return m.group(0)
        if alpha:
            a = int(alpha, 16)
            if level < 128:   # dark tint/shadow: shadows stay black (stronger), tints become light tints
                return f'#000000{min(255, int(a * 2.4) + 8):02x}' if shadow else f'#ffffff{alpha}'
            return f'#1c1c1f{alpha}'   # translucent white surfaces become translucent dark surfaces
        if shadow and level < 128:
            return m.group(0)
        if rgb in TABLE:
            return '#' + TABLE[rgb]
        v = max(18, 255 - round(level)); return f'#{v:02x}{v:02x}{min(255, v + 4):02x}'
    return HEX.sub(one, value)

def split_top(text, sep):
    out, depth, quote, cur = [], 0, '', ''
    for ch in text:
        if quote:
            cur += ch
            if ch == quote: quote = ''
            continue
        if ch in '"\'': quote = ch
        elif ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == sep and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    out.append(cur)
    return out

def blocks(css):
    """Yield (prelude, body) pairs at one nesting level."""
    i, n = 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0: return
        prelude = css[i:j].strip(); depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == '{': depth += 1
            elif css[k] == '}': depth -= 1
            k += 1
        yield prelude, css[j + 1:k - 1]; i = k

def scope(selector):
    # :where() adds no specificity, so each dark copy weighs exactly what its light original does and wins only by
    # coming later; more specific light rules (e.g. a transparent full-card button) keep winning as intended.
    out = []
    for s in split_top(selector, ','):
        s = s.strip()
        if not s or '::view-transition' in s: continue
        if s.startswith(':root'): out.append(':where(html[data-theme=dark])' + s[5:])
        elif s.startswith('html'): out.append(':where(html[data-theme=dark])' + s[4:])
        else: out.append(':where(html[data-theme=dark]) ' + s)
    return ','.join(out)

def convert(css):
    out = []
    for prelude, body in blocks(css):
        if prelude.startswith('@'):
            if prelude.startswith(('@media', '@supports')):
                inner = convert(body)
                if inner: out.append(f'{prelude}{{{inner}}}')
            continue
        decls = [d.strip() for d in split_top(body, ';') if d.strip()]
        blend = any(d.replace(' ', '').startswith('mix-blend-mode:difference') for d in decls)
        on_accent = any(d.split(':', 1)[0].strip() in ('background', 'background-color') and
                        (('var(--accent)' in d) or any(not neutral(expand(m.group(1).lower())[:6])[0] for m in HEX.finditer(d))) for d in decls)
        changed = []
        for d in decls:
            if ':' not in d: continue
            prop, val = (x.strip() for x in d.split(':', 1)); prop = prop.lower()
            if prop not in COLOR_PROPS or prop.startswith('--'): continue
            if blend and prop in ('color', 'background', 'background-color'): continue
            if on_accent and prop in ('color', '-webkit-text-fill-color', 'fill', 'stroke'): continue
            new = remap(val, prop == 'box-shadow')
            if new != val: changed.append(f'{prop}:{new}')
        sel = scope(prelude)
        if changed and sel: out.append(f'{sel}{{{";".join(changed)}}}')
    return ''.join(out)

HAND = """
/* Hand-tuned dark rules (appended by dark_theme.py): layered near-black surfaces, hairline borders, a faint top glow,
   a frosted header and raised menus — the vocabulary of Linear / Vercel / GitHub dark. */
html[data-theme=dark]{color-scheme:dark;scrollbar-color:#3f3f46 transparent}
html[data-theme=dark] body.dashboard{--bg:#09090b;--panel:#111113;--ink:#ededef;--muted:#a1a1aa;--line:#232327;--accent:#ffd43b;--on:#191919;--card-hover:#d9a600;
 background:radial-gradient(1100px 520px at 62% -200px,#ffd43b12,transparent 70%),radial-gradient(900px 460px at -10% -160px,#7c6cff10,transparent 70%),#09090b;background-attachment:fixed}
/* Frosted, translucent header and a quieter rail. */
html[data-theme=dark] .dashboard .top{background:#09090bb8;-webkit-backdrop-filter:saturate(1.5) blur(16px);backdrop-filter:saturate(1.5) blur(16px);border-bottom-color:#ffffff10}
html[data-theme=dark] .icon-rail{background:#0b0b0d;border-right-color:#ffffff0d}
html[data-theme=dark] .rail-button.active{background:#ffffff0f}
/* Cards: hairline border, a 1px top highlight, and a soft lift on hover. */
html[data-theme=dark] .dashboard .card{background:#111113;border-color:#ffffff12;box-shadow:inset 0 1px 0 #ffffff0a,0 1px 2px #00000080}
@media(hover:hover){html[data-theme=dark] .dashboard .card:hover{border-color:#ffffff26;box-shadow:inset 0 1px 0 #ffffff12,0 18px 40px -18px #000000f0}}
html[data-theme=dark] .dashboard .card .preview{background:#18181b}
html[data-theme=dark] .dashboard .card-body .card-foot{border-top-color:#ffffff10}
html[data-theme=dark] .dashboard .card .card-body .like:not([aria-pressed=true]),html[data-theme=dark] .dashboard .card .card-body .bookmark:not([aria-pressed=true]){color:#71717a}
/* Card text: no difference-blend in dark; a clear title → body → tag hierarchy, and the hover sweep is a faint raise, not a white flood. */
html[data-theme=dark] .dashboard .card .card-body{background-image:linear-gradient(#17171a,#17171a)}
html[data-theme=dark] .dashboard .card .card-body :is(h2,.description,.preview-credit,.meta>span,.card-foot>span,.visit-site){mix-blend-mode:normal}
html[data-theme=dark] .dashboard .card .card-body h2,html[data-theme=dark] .dashboard .card .card-body .visit-site{color:#ededef}
html[data-theme=dark] .dashboard .card .card-body .description{color:#a1a1aa}
html[data-theme=dark] .dashboard .card .card-body .meta>span{color:#8e8e96}
html[data-theme=dark] .dashboard .card .card-body :is(.card-foot>span,.preview-credit){color:#71717a}
html[data-theme=dark] .dashboard .card .card-body .visit-site{border-color:#ffffff26}
/* Empty favorites in dark: same layers as cards; the warm accents stay, mini cards dim a little. */
html[data-theme=dark] .dashboard .empty.empty-favorites{background:#111113;border-color:#ffffff12}
html[data-theme=dark] .fav-eyebrow,html[data-theme=dark] .fav-inline{background:#ffffff08;border-color:#ffffff17}
html[data-theme=dark] .fav-glow{background:radial-gradient(closest-side,#ffd43b26,transparent)}
html[data-theme=dark] .fav-mini{background:#18181b;border-color:#ffffff14;box-shadow:0 18px 40px -14px #000000e6}
html[data-theme=dark] .fav-mini i{filter:saturate(.85) brightness(.9)}
html[data-theme=dark] .fav-mini b{background:#ffffff14}html[data-theme=dark] .fav-mini b+b{background:#ffffff0b}
html[data-theme=dark] .fav-toast{background:#ededef;color:#09090b;box-shadow:0 10px 24px -8px #000}
html[data-theme=dark] .fav-steps,html[data-theme=dark] .fav-steps li+li,html[data-theme=dark] .fav-picks,html[data-theme=dark] .dashboard .empty.start.empty-favorites .empty-note{border-color:#ffffff10}
html[data-theme=dark] .fav-steps span{background:#ffffff0d}
html[data-theme=dark] .fav-steps li:nth-child(2) span{background:#ffd43b;color:#191919}
html[data-theme=dark] .fav-picks{background:#0e0e10}
html[data-theme=dark] .fav-pick{background:#111113;border-color:#ffffff12}
html[data-theme=dark] .fav-pick:hover{border-color:#ffffff26;box-shadow:0 12px 28px -12px #000}
html[data-theme=dark] .fav-pick img{border-color:#ffffff10}
html[data-theme=dark] .dashboard .fav-pick-save{color:#8e8e96}
html[data-theme=dark] .dashboard .fav-pick-save:hover,html[data-theme=dark] .fav-mini-c .fav-mini-mark{background:#ffd43b1f}
html[data-theme=dark] .dashboard .fav-pick-save:is(:hover,[aria-pressed=true]){color:#ffd43b}
/* Rail icons are black images: invert them so they read as soft grey, full white when active or hovered. */
html[data-theme=dark] .rail-button img{filter:invert(1);opacity:.78}
html[data-theme=dark] .rail-button:hover img,html[data-theme=dark] .rail-button.active img{opacity:1}
html[data-theme=dark] body.dashboard .icon-rail .rail-group .rail-button:is(:hover,:focus-visible,:active){background-color:#ffffff0f!important}
html[data-theme=dark] body.dashboard .icon-rail .rail-group .rail-button.active,html[data-theme=dark] body.dashboard .icon-rail .rail-group .rail-button.active:is(:hover,:focus-visible,:active){background-color:#ffffff17!important;border-color:#ffffff24!important;box-shadow:inset 0 1px 0 #ffffff14!important}
html[data-theme=dark] body.dashboard .rail-button.active:before{background:#ffd43b}
html[data-theme=dark] .rail-button:focus-visible{outline:2px solid #ffd43b99;outline-offset:2px}
html[data-theme=dark] .icon-rail .rail-separator{border-top-color:#ffffff1f}
html[data-theme=dark] .cat-card,html[data-theme=dark] .skill-topics,html[data-theme=dark] .dashboard .empty.start{background:#111113;border-color:#ffffff12}
/* Inputs sit flush with the page; borders brighten on hover, the yellow focus ring stays. */
html[data-theme=dark] .dashboard .search input,html[data-theme=dark] .dashboard .toolbar .sort-trigger{background:#111113;border-color:#ffffff14}
html[data-theme=dark] .dashboard .search input:hover,html[data-theme=dark] .dashboard .toolbar .sort-trigger:hover{border-color:#ffffff2e}
html[data-theme=dark] .dashboard .search input::placeholder{color:#71717a}
/* Raised layers: menus, dialog, tooltip, toast. */
html[data-theme=dark] .dashboard .sort-list{background:#18181b;border-color:#ffffff14;box-shadow:0 24px 60px -16px #000000f2,0 0 0 1px #00000066}
html[data-theme=dark] .dashboard .sort-list [role=option].active{background:#ffffff0d}
html[data-theme=dark] .dashboard .sort-list [role=option] svg{stroke:#ededef}
html[data-theme=dark] .dashboard #detail{background:#111113;color:#ededef;border:1px solid #ffffff14;box-shadow:0 40px 100px -30px #000}
html[data-theme=dark] dialog::backdrop{background:#000000b3;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
html[data-theme=dark] .rail-tooltip{background:#ededef;color:#09090b;box-shadow:0 8px 24px #000000b3}
/* Header controls. */
html[data-theme=dark] .lang-switch,html[data-theme=dark] .dashboard .top .theme-toggle{background:#111113;border-color:#ffffff1f}
/* Text that sits on the yellow accent stays dark. */
@media(hover:hover) and (pointer:fine){html[data-theme=dark] .dashboard :is(button:not(.card-open,.like,.bookmark,.sort-trigger,.fav-pick-open):not(:disabled),a.visit-site,.rail-brand,select):hover{color:#191919!important}}
html[data-theme=dark] .dashboard :is(button:not(.card-open,.like,.bookmark,.sort-trigger,.fav-pick-open):not(:disabled),a.visit-site,.rail-brand,select):focus-visible{color:#191919!important}
html[data-theme=dark] .dashboard .top .lang-switch .lang-option[aria-pressed=true],html[data-theme=dark] .dashboard .top .theme-toggle:hover{color:#191919}
html[data-theme=dark] ::selection{background:#ffd43b;color:#191919}
"""

def build(root):
    root = Path(root)
    css = (root / 'assets' / 'dashboard.css').read_text(encoding='utf-8')
    tpl = (root / 'index.template.html').read_text(encoding='utf-8')
    inline = re.search(r'<style>([\s\S]*?)</style>', tpl).group(1)
    clean = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)
    text = '/* Generated by dark_theme.py from index.template.html <style> and assets/dashboard.css — do not edit by hand. */\n'
    text += convert(clean(inline)) + '\n' + convert(clean(css)) + '\n' + HAND
    (root / 'assets' / 'dashboard-dark.css').write_text(text, encoding='utf-8', newline='\n')
    return text.count('html[data-theme=dark]')

if __name__ == '__main__':
    print(build(Path(__file__).resolve().parent), 'dark selectors')
