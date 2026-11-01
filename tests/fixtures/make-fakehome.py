#!/usr/bin/env python3
"""A home folder with a Firefox profile holding add-on data the way Firefox stores it (see
firefox_storage.py), for the import tests (tests/unit/firefox-storage.test.mjs):

  Dark Reader   storage.local with every kind of value (dates, Maps and Sets, typed arrays, the same object
                twice, undefined, a Blob that can't come over, and one value big enough to live in a file
                of its own); storage.sync
  Stylus        storage.local; IndexedDB "stylish" (styles, in-line keys, auto-increment) and "drafts"
                (out-of-line keys of three kinds, an index); localStorage in all three encodings
  uBlock Origin storage.local

  python3 make-fakehome.py <home> [<unpacked Dark Reader folder, packed into the profile as its .xpi>]
"""
import json, os, sys, zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import firefox_storage as F

home = sys.argv[1]
dr_dir = sys.argv[2] if len(sys.argv) > 2 else None

DR, ST, UB = 'addon@darkreader.org', '{7a7a4a92-a2a0-41d1-9fd7-1e92480d612d}', 'uBlock0@raymondhill.net'
UUID = {DR: '2c5d1b1e-7a45-4f6e-9a0e-1f2a3b4c5d6e', ST: '9d8c7b6a-5f4e-4d3c-8b2a-1a0f9e8d7c6b', UB: '6f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0'}

ff = os.path.join(home, '.mozilla', 'firefox')
rel = 'abcd1234.default-release'
prof = os.path.join(ff, rel)
os.makedirs(prof, exist_ok=True)
with open(os.path.join(ff, 'profiles.ini'), 'w', encoding='utf-8') as f:
    f.write('[Install4F96D1932A9F858E]\nDefault=%s\nLocked=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=%s\nDefault=1\n\n[General]\nStartWithLastProfile=1\nVersion=2\n' % (rel, rel))
with open(os.path.join(ff, 'installs.ini'), 'w', encoding='utf-8') as f:
    f.write('[4F96D1932A9F858E]\nDefault=%s\nLocked=1\n' % rel)
F.write_prefs(os.path.join(prof, 'prefs.js'), UUID)

# ------------------------------------------------------------ Dark Reader
shared = {'list': [1, 2, 3]}
F.write_storage_local(prof, UUID[DR], {
    'enabled': True,
    'theme': {'mode': 1, 'brightness': 110, 'contrast': 95, 'sepia': 10, 'fontFamily': 'Open Sans', 'textStroke': 0.3},
    'siteList': ['example.com', 'news.ycombinator.com'],
    'note': F.TwoByte('Ünïcode ✓ 日本語 🐉'),
    'installDate': F.JSDate(1700000000000),
    'counts': {'0': 5, '1': 7, 'x': 9},
    'numbers': [-42, 3.25, 12345678901234, 0, -0.5],
    'nothing': None,
    'undef': F.UNDEF,
    'twice': {'a': shared, 'b': shared},
    'tags': F.JSSet(['a', 'b']),
    'map': F.JSMap([('k', 1)]),
    'bytes': F.Uint8(b'\x01\x02\x03'),
    'big': 'x' * 300000 + 'END',
    'blobby': F.Blob(),
}, external_over=100000)
F.write_sync(os.path.join(prof, 'storage-sync-v2.sqlite'), {
    DR: {'syncSettings': True, 'theme': {'mode': 1, 'darkSchemeTextColor': '#e8e6e3'}},
})

# ------------------------------------------------------------------ Stylus
st_origin = 'moz-extension://' + UUID[ST]
F.write_storage_local(prof, UUID[ST], {'settings': {'popupWidth': 320, 'editor.theme': 'darcula'}})
own = F.origin_dir(prof, UUID[ST])
F.write_idb(os.path.join(own, 'idb', '1451318868ntouromlalnodry--epcr.sqlite'), 'stylish', st_origin, 2, [{
    'name': 'styles', 'key_path': 'id', 'auto_increment': True,
    'records': [
        (None, {'id': 1, 'name': 'Dark GitHub', 'enabled': True, 'url': st_origin + '/edit.html?id=1',
                'sections': [{'code': 'body { background: #111 !important }', 'domains': ['github.com']}]}),
        (None, {'id': 7, 'name': F.TwoByte('Wikipédia sépia'), 'enabled': False,
                'sections': [{'code': 'body { background: #f4ecd8 }', 'domains': ['wikipedia.org']}]}),
    ],
}])
F.write_idb(os.path.join(own, 'idb', '3184346011dsrfat.sqlite'), 'drafts', st_origin, 1, [{
    'name': 'drafts', 'key_path': None,
    'indexes': [{'name': 'by-date', 'key_path': 'date', 'unique': False, 'multientry': False}],
    'records': [
        ('draft-1', {'date': 1700000100000, 'code': 'a { color: red }'}),
        (['nested', 2], {'date': 1700000200000, 'code': 'b { color: blue }'}),
        (12.5, {'date': 1700000000000, 'code': 'i { color: green }'}),
    ],
}])
F.write_local_storage(os.path.join(own, 'ls', 'data.sqlite'), st_origin, {
    'editorWidth': ('420', 'utf8'),
    'popupWidth': ('320 ✓ ' + 'w' * 200, 'snappy'),
    'lang': ('fr ✓', 'utf16'),
})

# ----------------------------------------------------------- uBlock Origin
F.write_storage_local(prof, UUID[UB], {
    'selectedFilterLists': ['user-filters', 'ublock-filters', 'easylist'],
    'hiddenSettings': {'autoUpdateDelayAfterLaunch': 37},
    'version': '1.60.0',
})

# ----------------------------------------------- the add-ons themselves
ext_dir = os.path.join(prof, 'extensions')
os.makedirs(ext_dir, exist_ok=True)
addons = []
if dr_dir and os.path.isfile(os.path.join(dr_dir, 'manifest.json')):
    xpi = os.path.join(ext_dir, DR + '.xpi')
    with zipfile.ZipFile(xpi, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(dr_dir):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, os.path.relpath(full, dr_dir))
    addons.append({'id': DR, 'type': 'extension', 'active': True, 'userDisabled': False, 'path': xpi,
                   'defaultLocale': {'name': 'Dark Reader'}, 'location': 'app-profile'})
with open(os.path.join(prof, 'extensions.json'), 'w', encoding='utf-8') as f:
    json.dump({'schemaVersion': 36, 'addons': addons}, f)
