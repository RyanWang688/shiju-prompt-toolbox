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
# Light value → dark value for the neutrals the site actually uses; anything else falls back to an inverted grey.
TABLE = {'ffffff': '1c1c1f', 'fafafa': '19191c', 'f9f9f7': '19191c', 'f7f7f5': '17171a', 'f5f5f5': '111113', 'f4f4f2': '26262a',
         'f3f3f1': '26262a', 'f2f2f2': '232327', 'f0f0f0': '2a2a2e', 'eeeeee': '2c2c30', 'ececec': '2e2e33', 'e6e6e6': '34343a',
         'e3e3e3': '36363c', 'dedede': '3a3a40', 'dcdcdc': '3c3c42', 'd7d7d7': '414147', 'c4c4c4': '4e4e55', 'bdbdbd': '56565c',
         'a3a3a3': '76767c', '9a9a9a': '7e7e84', '8a8a8a': '8e8e94', '6b6b6b': '9e9ea4', '595959': 'a8a8ae', '3d3d3d': 'c6c6cb',
         '333333': 'cfcfd4', '2b2b2b': 'd8d8dc', '191919': 'ececee', '111111': 'f2f2f4', '000000': 'f4f4f6'}
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
/* Hand-tuned dark rules (appended by dark_theme.py). */
html[data-theme=dark]{color-scheme:dark}
html[data-theme=dark] body.dashboard{--bg:#111113;--panel:#1c1c1f;--ink:#ececee;--muted:#a8a8ae;--line:#34343a;--accent:#ffd43b;--on:#191919;--card-hover:#d9a600}
/* Text that sits on the yellow accent stays dark. */
@media(hover:hover) and (pointer:fine){html[data-theme=dark] .dashboard :is(button:not(.card-open,.like,.bookmark,.sort-trigger):not(:disabled),a.visit-site,.rail-brand,select):hover{color:#191919!important}}
html[data-theme=dark] .dashboard :is(button:not(.card-open,.like,.bookmark,.sort-trigger):not(:disabled),a.visit-site,.rail-brand,select):focus-visible{color:#191919!important}
html[data-theme=dark] .dashboard .top .lang-switch .lang-option[aria-pressed=true],html[data-theme=dark] .dashboard .top .theme-toggle:hover{color:#191919}
html[data-theme=dark] .lang-switch{background:#1c1c1f;border-color:#4a4a50}
html[data-theme=dark] .dashboard .card .card-body .like:not([aria-pressed=true]),html[data-theme=dark] .dashboard .card .card-body .bookmark:not([aria-pressed=true]){color:#8e8e94}
html[data-theme=dark] .dashboard .card .preview{background:#232327}
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
