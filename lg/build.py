#!/usr/bin/env python3
"""Bygger FreeMyTV-LG.ipk, Free My TV för barnens LG (webOS), som Developer Mode installerar.

    python3 lg/build.py   # → FreeMyTV-LG.ipk i repots rot (finns inte i git)

Paketet: laddaren (lg/index.html) som hämtar tv/ från GitHub vid varje start, en inbyggd kopia av tv/ i app/ (med
lg/barn.js och lg/devmode.js) för när TV:n saknar internet, ikonerna, och tjänsten från simbasjungles/free-my-tv
(webos/service, MIT) som når TV:ns fjärrkontroll-API. Packas som LG:s ares-package gör (ar med control.tar.gz och
data.tar.gz), utan LG:s verktyg. Byggsättet är från simbasjungles/free-my-tv webos/build.py (MIT).
"""
import io
import json
import os
import tarfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LG = os.path.join(ROOT, 'lg')
IPK = os.path.join(ROOT, 'FreeMyTV-LG.ipk')


def read(path):
    with open(path, 'rb') as f:
        return f.read()


def tar_gz(entries):
    buf = io.BytesIO()
    now = int(time.time())
    with tarfile.open(fileobj=buf, mode='w:gz', format=tarfile.PAX_FORMAT) as tar:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.mtime = now
            info.uid = info.gid = 0
            if data is None:
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tar.addfile(info)
            else:
                info.size = len(data)
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def ar(members):
    out = io.BytesIO()
    out.write(b'!<arch>\n')
    now = int(time.time())
    for name, data in members:
        out.write(('%-16s%-12d%-6d%-6d%-8s%-10d`\n' % (name, now, 0, 0, '100644', len(data))).encode('ascii'))
        out.write(data)
        if len(data) % 2:
            out.write(b'\n')
    return out.getvalue()


def offline_copy(version):
    """tv/ som app/, med samma tillägg som laddaren gör."""
    files = {}
    tv = os.path.join(ROOT, 'tv')
    for folder, _, names in os.walk(tv):
        for name in names:
            path = os.path.join(folder, name)
            files['app/' + os.path.relpath(path, tv).replace(os.sep, '/')] = read(path)
    html = files['app/index.html'].decode('utf-8')
    info = ('<script>window.FMTV_LOADER = {platform: "lg", version: "%s", commit: "inbyggd"};</script>' % version)
    for old, new in (('<head>', '<head>' + info),
                     ('<script src="config.js"></script>', '<script src="config.js"></script><script src="lg/barn.js"></script>'),
                     ('</body>', '<script src="lg/devmode.js"></script></body>')):
        assert old in html, old
        html = html.replace(old, new, 1)
    files['app/index.html'] = html.encode('utf-8')
    for name in ('barn.js', 'devmode.js'):
        files['app/lg/' + name] = read(os.path.join(LG, name))
    return files


def build():
    info = json.loads(read(os.path.join(LG, 'appinfo.json')))
    app_id, version = info['id'], info['version']
    loader = read(os.path.join(LG, 'index.html')).decode('utf-8')
    assert "VERSION = '%s'" % version in loader, 'versionen i lg/index.html och lg/appinfo.json skiljer sig'
    app = {'index.html': loader.encode('utf-8')}
    for name in ('appinfo.json', 'icon.png', 'largeIcon.png'):
        app[name] = read(os.path.join(LG, name))
    app.update(offline_copy(version))

    base = 'usr/palm/applications/' + app_id
    entries = [('usr', None), ('usr/palm', None), ('usr/palm/applications', None), (base, None)]
    dirs = set()
    for path in sorted(app):
        parts = path.split('/')[:-1]
        for i in range(1, len(parts) + 1):
            d = '/'.join(parts[:i])
            if d not in dirs:
                dirs.add(d)
                entries.append((base + '/' + d, None))
        entries.append((base + '/' + path, app[path]))

    service_id = app_id + '.service'
    service = {'service.js': read(os.path.join(LG, 'service', 'service.js')),
               'package.json': json.dumps({'name': service_id, 'version': version, 'main': 'service.js'},
                                          indent=2).encode('utf-8'),
               'services.json': json.dumps({'id': service_id, 'description': 'Free My TV',
                                            'services': [{'name': service_id, 'description': 'Free My TV'}]},
                                           indent=2).encode('utf-8')}
    service_base = 'usr/palm/services/' + service_id
    entries += [('usr/palm/services', None), (service_base, None)]
    entries += [(service_base + '/' + name, service[name]) for name in sorted(service)]

    package = json.dumps({'id': app_id, 'version': version, 'app': app_id, 'services': [service_id]},
                         indent=2).encode('utf-8')
    entries += [('usr/palm/packages', None), ('usr/palm/packages/' + app_id, None),
                ('usr/palm/packages/' + app_id + '/packageinfo.json', package)]

    size = sum(len(d) for d in app.values()) + sum(len(d) for d in service.values()) + len(package)
    control = ('Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: %d\n'
               'Maintainer: Free My TV <https://freemytv.io>\nDescription: Free My TV, barnens TV.\n'
               'webOS-Package-Format-Version: 2\nwebOS-Packager-Version: 1.0.0\n' % (app_id, version, size))
    data = ar([('debian-binary', b'2.0\n'), ('control.tar.gz', tar_gz([('control', control.encode('utf-8'))])),
               ('data.tar.gz', tar_gz(entries))])
    with open(IPK, 'wb') as f:
        f.write(data)
    print('Byggde %s (%s %s, %d KB)' % (os.path.basename(IPK), app_id, version, len(data) // 1024))


if __name__ == '__main__':
    build()
