#!/usr/bin/env python3
"""Verify the public site's financial screenshot showcase uses canonical iPhone frames."""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'styles.css').read_text(encoding='utf-8')
version = (root / 'website-version.js').read_text(encoding='utf-8')
section = re.search(r'<section\b[^>]*id="money-tracking"[^>]*>(.*?)</section>', html, re.S)
assert section, 'Refund expectations section missing'
body = section.group(1)
expected = ('order-info-preview.png', 'order-costs-preview.png')
assert len(re.findall(r'class="launch-visual"', body)) == 2, 'Expected exactly two spotlight visuals'
for name in expected:
    markup = r'<div class="launch-visual"><div class="phone-shot launch-phone-shot"><img\b[^>]*\bsrc="' + re.escape(name)
    assert re.search(markup, body), f'{name} must be inside canonical phone-shot frame'
    assert (root / name).is_file(), f'Missing original screenshot asset {name}'
assert body.count('class="phone-shot launch-phone-shot"') == 2
assert '.phone-shot::before' in css and '.phone-shot::after' in css, 'Canonical Dynamic Island hardware styling absent'
assert '.launch-spotlights .launch-visual .launch-phone-shot img' in css, 'Section image-height/shadow override absent'
assert 'const WEBSITE_BUILD = 279;' in version, 'Website build metadata out of sync'
assert 'styles.css?v=279' in html, 'Stylesheet cache version out of sync'
print('PASS: two original screenshots use existing iPhone frames, assets intact, CSS responsive and cache version updated')
