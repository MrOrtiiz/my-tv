#!/usr/bin/env python3
"""Lägger appens sidor i en mapp (android/build.sh packar den som assets/):

    python3 android/assets.py <mapp>

- index.html: laddaren (android/index.html), som hämtar tv/ från GitHub vid varje start.
- app/: en inbyggd kopia av tv/ för när projektorn saknar internet, med samma ändringar som laddaren gör
  (android/kompis.js efter config.js; Barça, IPTV, sök och spelen borttagna).
"""
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(out):
    loader = open(os.path.join(ROOT, 'android', 'index.html'), encoding='utf-8').read()
    version = re.search(r"VERSION = '([^']+)'", loader).group(1)
    skip = re.findall(r"'([a-z]+\.(?:js|css))'", re.search(r"var SKIP = \[([^\]]*)\]", loader).group(1))
    assert skip, 'SKIP saknas i android/index.html'

    os.makedirs(out, exist_ok=True)
    shutil.copy(os.path.join(ROOT, 'android', 'index.html'), os.path.join(out, 'index.html'))

    app = os.path.join(out, 'app')
    if os.path.exists(app):
        shutil.rmtree(app)
    shutil.copytree(os.path.join(ROOT, 'tv'), app, ignore=shutil.ignore_patterns(*skip))
    os.makedirs(os.path.join(app, 'android'))
    shutil.copy(os.path.join(ROOT, 'android', 'kompis.js'), os.path.join(app, 'android', 'kompis.js'))

    path = os.path.join(app, 'index.html')
    html = open(path, encoding='utf-8').read()
    for name in skip:
        html = html.replace('<script src="%s"></script>' % name, '').replace('<link rel="stylesheet" href="%s">' % name, '')
    info = '<script>window.FMTV_LOADER = {platform: "android", version: "%s", commit: "inbyggd"};</script>' % version
    for old, new in (('<head>', '<head>' + info),
                     ('<script src="config.js"></script>',
                      '<script src="config.js"></script><script src="android/kompis.js"></script>')):
        assert old in html, old
        html = html.replace(old, new, 1)
    open(path, 'w', encoding='utf-8').write(html)
    print('assets:', out, '(version %s, utan %s)' % (version, ', '.join(skip)))


if __name__ == '__main__':
    main(sys.argv[1])
