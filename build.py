"""Embed the curated collection so index.html works offline as well as on a server."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
items = json.loads((root / 'prompts.json').read_text(encoding='utf-8'))
assert isinstance(items, list)
ids = set()
for item in items:
    assert all(isinstance(item.get(k), str) and item[k].strip() for k in ('id', 'title', 'category', 'prompt'))
    assert item['id'] not in ids, 'Duplicate prompt id'
    ids.add(item['id'])
    preview = item.get('preview')
    if preview:
        assert preview['type'] in ('image', 'animation', 'video')
        path = (root / preview['src']).resolve()
        assert path.is_relative_to((root / 'assets').resolve()) and path.is_file()
data = json.dumps(items, ensure_ascii=False).replace('<', r'\u003c').replace('>', r'\u003e').replace('&', r'\u0026')
template = (root / 'index.template.html').read_text(encoding='utf-8')
assert template.count('__PROMPTS__') == 1
(root / 'index.html').write_text(template.replace('__PROMPTS__', data), encoding='utf-8')
print(f'Built index.html with {len(items)} prompts.')
