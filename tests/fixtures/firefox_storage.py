"""Writes add-on data the way Firefox stores it, for the import tests (src/main/import/firefox-storage.js
reads it). Written from Firefox's formats, independently of that reader:

  IndexedDB    SQLite files (dom/indexedDB/ActorsParent.cpp schema): keys in Firefox's sortable key
               encoding (dom/indexedDB/Key.cpp), values as SpiderMonkey structured clones
               (js/src/vm/StructuredClone.cpp) compressed with snappy; big values in <db>.files/<id>,
               snappy-framed, with the row's data column holding the file id.
  localStorage storage/default/<origin>/ls/data.sqlite (LSNG, schema 4)
  storage.sync storage-sync-v2.sqlite
  UUIDs        prefs.js, extensions.webextensions.uuids

  python3 firefox_storage.py selftest     checks the snappy and key encoders against known values
"""
import json, os, sqlite3, struct, sys

# ------------------------------------------------------------------ snappy
def _varint(n):
    out = bytearray()
    while True:
        b = n & 0x7f
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)

def snappy_compress(data):
    """Real snappy output: literals and copies (1-, 2- and 4-byte offsets), overlapping copies included."""
    data = bytes(data)
    out = bytearray(_varint(len(data)))
    n = len(data)

    def literal(s, e):
        while s < e:
            chunk = min(e - s, 65536)
            ln = chunk - 1
            if ln < 60:
                out.append(ln << 2)
            elif ln < 0x100:
                out.append(60 << 2); out.append(ln)
            elif ln < 0x10000:
                out.append(61 << 2); out.extend(ln.to_bytes(2, 'little'))
            else:
                out.append(62 << 2); out.extend(ln.to_bytes(3, 'little'))
            out.extend(data[s:s + chunk])
            s += chunk

    def copy(offset, length):
        while length > 0:
            if 4 <= length <= 11 and offset < 2048:
                out.append(1 | ((length - 4) << 2) | ((offset >> 8) << 5)); out.append(offset & 0xff)
                return
            l = min(length, 64)
            if offset < 0x10000:
                out.append(2 | ((l - 1) << 2)); out.extend(offset.to_bytes(2, 'little'))
            else:
                out.append(3 | ((l - 1) << 2)); out.extend(offset.to_bytes(4, 'little'))
            length -= l

    table = {}
    i = lit = 0
    while i + 4 <= n:
        key = data[i:i + 4]
        cand = table.get(key)
        table[key] = i
        if cand is not None and i - cand <= 0x7fffffff:
            m = 4
            while i + m < n and data[cand + m] == data[i + m]:
                m += 1
            literal(lit, i)
            copy(i - cand, m)
            for j in range(i + 1, min(i + m, n - 3)):
                table[data[j:j + 4]] = j
            i += m
            lit = i
        else:
            i += 1
    literal(lit, n)
    return bytes(out)

_CRC_TABLE = []
for _i in range(256):
    _c = _i
    for _ in range(8):
        _c = (_c >> 1) ^ 0x82F63B78 if _c & 1 else _c >> 1
    _CRC_TABLE.append(_c)

def crc32c(data):
    c = 0xffffffff
    for b in data:
        c = _CRC_TABLE[(c ^ b) & 0xff] ^ (c >> 8)
    return c ^ 0xffffffff

def snappy_framed(data):
    out = bytearray(b'\xff\x06\x00\x00sNaPpY')
    for off in range(0, len(data), 65536):
        chunk = data[off:off + 65536]
        crc = crc32c(chunk)
        masked = (((crc >> 15) | (crc << 17)) + 0xa282ead8) & 0xffffffff
        body = masked.to_bytes(4, 'little') + snappy_compress(chunk)
        out.append(0x00); out.extend(len(body).to_bytes(3, 'little')); out.extend(body)
    return bytes(out)

# -------------------------------------------------------- structured clone
HEADER = 0xFFF10000
NULL, UNDEFINED, BOOLEAN, INT32, STRING, DATE, REGEXP, ARRAY, OBJECT = (0xFFFF0000 + i for i in range(9))
BACK_REFERENCE, MAP, SET, END_OF_KEYS = 0xFFFF000D, 0xFFFF0011, 0xFFFF0012, 0xFFFF0013
ARRAY_BUFFER, TYPED_ARRAY = 0xFFFF001F, 0xFFFF0020
DOM_BLOB = 0xFFFF8001

class Undefined: pass
UNDEF = Undefined()
class JSDate:
    def __init__(self, ms): self.ms = ms
class TwoByte(str):
    """A string SpiderMonkey happens to keep as two-byte even though it would fit in Latin-1."""
class JSMap(list): pass   # [(k, v), ...]
class JSSet(list): pass
class Blob: pass          # something only the DOM can clone (Firefox: a Blob in the record)
class Uint8(bytes): pass  # a Uint8Array over its own buffer

def clone(value, scope=3):
    out = bytearray()
    objs = {}

    def pair(tag, data):
        out.extend(struct.pack('<II', data & 0xffffffff, tag))

    def pad():
        while len(out) % 8:
            out.append(0)

    def string(s):
        units = s.encode('utf-16-le')
        latin1 = not isinstance(s, TwoByte) and all(ord(c) < 256 for c in s)
        if latin1:
            pair(STRING, len(s) | 0x80000000); out.extend(s.encode('latin-1'))
        else:
            pair(STRING, len(units) // 2); out.extend(units)
        pad()

    def key(k):
        if isinstance(k, int) or (isinstance(k, str) and k.isdigit() and (k == '0' or not k.startswith('0')) and int(k) < 2**31):
            pair(INT32, int(k))
        else:
            string(k)

    def obj_start(v):
        objs[id(v)] = len(objs)

    def w(v):
        if id(v) in objs and isinstance(v, (dict, list, JSDate)):
            pair(BACK_REFERENCE, objs[id(v)]); return
        if v is None: pair(NULL, 0)
        elif v is UNDEF: pair(UNDEFINED, 0)
        elif isinstance(v, bool): pair(BOOLEAN, int(v))
        elif isinstance(v, int) and -2**31 <= v < 2**31: pair(INT32, v)
        elif isinstance(v, (int, float)): out.extend(struct.pack('<d', float(v)))
        elif isinstance(v, str): string(v)
        elif isinstance(v, JSDate):
            obj_start(v); pair(DATE, 0); out.extend(struct.pack('<d', float(v.ms)))
        elif isinstance(v, Blob): pair(DOM_BLOB, 0)
        elif isinstance(v, Uint8):
            obj_start(v)
            pair(TYPED_ARRAY, 1); out.extend(struct.pack('<Q', len(v)))
            objs[('buf', id(v))] = len(objs)
            pair(ARRAY_BUFFER, 0); out.extend(struct.pack('<Q', len(v))); out.extend(v); pad()
            out.extend(struct.pack('<Q', 0))
        elif isinstance(v, JSMap):
            obj_start(v); pair(MAP, 0)
            for k, x in v: w(k); w(x)
            pair(END_OF_KEYS, 0)
        elif isinstance(v, JSSet):
            obj_start(v); pair(SET, 0)
            for x in v: w(x)
            pair(END_OF_KEYS, 0)
        elif isinstance(v, list):
            obj_start(v); pair(ARRAY, len(v))
            for i, x in enumerate(v):
                pair(INT32, i); w(x)
            pair(END_OF_KEYS, 0)
        elif isinstance(v, dict):
            obj_start(v); pair(OBJECT, 0)
            # Integer-like keys first, ascending, then the rest in order (as JS enumerates them).
            ks = sorted([k for k in v if isinstance(k, str) and k.isdigit() and (k == '0' or not k.startswith('0'))], key=int) + \
                 [k for k in v if not (isinstance(k, str) and k.isdigit() and (k == '0' or not k.startswith('0')))]
            for k in ks:
                key(k); w(v[k])
            pair(END_OF_KEYS, 0)
        else:
            raise TypeError('cannot clone %r' % (v,))

    pair(HEADER, scope)
    w(value)
    return bytes(out)

# -------------------------------------------------------------- IDB keys
SIGN = 1 << 63
MASK = (1 << 64) - 1

def encode_key(v):
    out = bytearray()

    def enc(v, offset):
        if isinstance(v, list):
            offset += 0x50
            if offset == 0x50 * 3:
                out.append(offset); offset = 0
            for x in v:
                enc(x, offset); offset = 0
            out.append(0 + offset)
        elif isinstance(v, str):
            out.append(0x30 + offset)
            units = v.encode('utf-16-le')
            for i in range(0, len(units), 2):
                c = units[i] | (units[i + 1] << 8)
                if c <= 0x7E:
                    out.append(c + 1)
                elif c <= 0x3FFF + 0x7F:
                    c -= 0x7F
                    out.append(0x80 | (c >> 8)); out.append(c & 0xff)
                else:
                    c = (c << 6) | 0xC00000
                    out.append((c >> 16) & 0xff); out.append((c >> 8) & 0xff); out.append(c & 0xff)
            out.append(0)
        elif isinstance(v, JSDate) or isinstance(v, (int, float)):
            bits = struct.unpack('>Q', struct.pack('>d', float(v.ms if isinstance(v, JSDate) else v)))[0]
            n = (-bits) & MASK if bits & SIGN else bits | SIGN
            out.append((0x20 if isinstance(v, JSDate) else 0x10) + offset)
            out.extend(struct.pack('>Q', n))
        else:
            raise TypeError('cannot encode key %r' % (v,))

    enc(v, 0)
    while out and out[-1] == 0:   # Firefox trims trailing zero bytes
        out.pop()
    return bytes(out)

# ------------------------------------------------------------------ files
IDB_SCHEMA = '''
CREATE TABLE database (name TEXT PRIMARY KEY, origin TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
  last_vacuum_time INTEGER NOT NULL DEFAULT 0, last_analyze_time INTEGER NOT NULL DEFAULT 0, last_vacuum_size INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
CREATE TABLE object_store (id INTEGER PRIMARY KEY, auto_increment INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, key_path TEXT);
CREATE TABLE object_store_index (id INTEGER PRIMARY KEY, object_store_id INTEGER NOT NULL, name TEXT NOT NULL, key_path TEXT NOT NULL,
  unique_index INTEGER NOT NULL, multientry INTEGER NOT NULL, locale TEXT, is_auto_locale BOOLEAN NOT NULL);
CREATE TABLE object_data (object_store_id INTEGER NOT NULL, key BLOB NOT NULL, index_data_values BLOB DEFAULT NULL, file_ids TEXT,
  data BLOB NOT NULL, PRIMARY KEY (object_store_id, key)) WITHOUT ROWID;
CREATE TABLE file (id INTEGER PRIMARY KEY, refcount INTEGER NOT NULL);
CREATE TABLE index_data (index_id INTEGER NOT NULL, value BLOB NOT NULL, object_data_key BLOB NOT NULL, object_store_id INTEGER NOT NULL,
  value_locale BLOB, PRIMARY KEY (index_id, value, object_data_key)) WITHOUT ROWID;
'''

def write_idb(path, name, origin, version, stores, external_over=None):
    """stores: [{name, key_path (None | str | [str]), auto_increment, indexes: [{name, key_path, unique, multientry}],
    records: [(key or None for in-line keys, value)]}]. Values bigger than external_over bytes go to a file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.remove(path)
    files = path[:-len('.sqlite')] + '.files'
    db = sqlite3.connect(path)
    db.executescript(IDB_SCHEMA)
    db.execute('PRAGMA user_version = %d' % (26 << 4))
    db.execute('INSERT INTO database (name, origin, version) VALUES (?,?,?)', (name, origin, version))
    file_id = 0
    for sid, s in enumerate(stores, 1):
        kp = s.get('key_path')
        kp_text = None if kp is None else (',' + ','.join(kp) if isinstance(kp, list) else kp)
        db.execute('INSERT INTO object_store (id, auto_increment, name, key_path) VALUES (?,?,?,?)', (sid, int(bool(s.get('auto_increment'))), s['name'], kp_text))
        for ix in s.get('indexes', []):
            ikp = ix['key_path']
            db.execute('INSERT INTO object_store_index (object_store_id, name, key_path, unique_index, multientry, is_auto_locale) VALUES (?,?,?,?,?,0)',
                       (sid, ix['name'], ',' + ','.join(ikp) if isinstance(ikp, list) else ikp, int(ix.get('unique', False)), int(ix.get('multientry', False))))
        for key, value in s['records']:
            if key is None:
                key = value[kp] if isinstance(kp, str) else [value[k] for k in kp]
            raw = clone(value)
            if external_over is not None and len(raw) > external_over:
                file_id += 1
                os.makedirs(files, exist_ok=True)
                with open(os.path.join(files, str(file_id)), 'wb') as f:
                    f.write(snappy_framed(raw))
                db.execute('INSERT INTO file (id, refcount) VALUES (?, 1)', (file_id,))
                db.execute('INSERT INTO object_data (object_store_id, key, file_ids, data) VALUES (?,?,?,?)', (sid, encode_key(key), '.%d' % file_id, file_id))
            else:
                db.execute('INSERT INTO object_data (object_store_id, key, data) VALUES (?,?,?)', (sid, encode_key(key), snappy_compress(raw)))
    db.commit()
    db.close()

def write_local_storage(path, origin, items):
    """items: {key: (value, how)}, how: 'utf8' | 'snappy' | 'utf16' (conversion NONE)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    db = sqlite3.connect(path)
    db.executescript('''
CREATE TABLE database (origin TEXT NOT NULL, usage INTEGER NOT NULL DEFAULT 0, last_vacuum_time INTEGER NOT NULL DEFAULT 0,
  last_analyze_time INTEGER NOT NULL DEFAULT 0, last_vacuum_size INTEGER NOT NULL DEFAULT 0);
CREATE TABLE data (key TEXT PRIMARY KEY, utf16_length INTEGER NOT NULL, conversion_type INTEGER NOT NULL, compression_type INTEGER NOT NULL,
  last_access_time INTEGER NOT NULL DEFAULT 0, value BLOB NOT NULL);
''')
    db.execute('INSERT INTO database (origin) VALUES (?)', (origin,))
    for k, (v, how) in items.items():
        units = len(v.encode('utf-16-le')) // 2
        if how == 'utf16':
            db.execute('INSERT INTO data VALUES (?,?,0,0,0,?)', (k, units, v.encode('utf-16-le')))
        elif how == 'snappy':
            db.execute('INSERT INTO data VALUES (?,?,1,1,0,?)', (k, units, snappy_compress(v.encode('utf-8'))))
        else:
            db.execute('INSERT INTO data VALUES (?,?,1,0,0,?)', (k, units, v.encode('utf-8')))
    db.commit(); db.close()

def write_sync(path, data):
    db = sqlite3.connect(path)
    db.executescript('''
CREATE TABLE IF NOT EXISTS storage_sync_data (ext_id TEXT NOT NULL PRIMARY KEY, data TEXT, sync_change_counter INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS storage_sync_mirror (guid TEXT NOT NULL PRIMARY KEY, ext_id TEXT NOT NULL UNIQUE, data TEXT);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value NOT NULL) WITHOUT ROWID;
''')
    for ext_id, obj in data.items():
        db.execute('INSERT OR REPLACE INTO storage_sync_data (ext_id, data) VALUES (?,?)', (ext_id, json.dumps(obj, ensure_ascii=False)))
    db.commit(); db.close()

def write_prefs(path, uuids):
    with open(path, 'w', encoding='utf-8') as f:
        f.write('// Mozilla User Preferences\n\n')
        f.write('user_pref("browser.startup.homepage_override.mstone", "131.0");\n')
        f.write('user_pref("extensions.webextensions.uuids", %s);\n' % json.dumps(json.dumps(uuids)))
        f.write('user_pref("extensions.webextensions.ExtensionStorageIDB.migrated.addon@darkreader.org", true);\n')

def origin_dir(profile, uuid, storage_local=False):
    return os.path.join(profile, 'storage', 'default', 'moz-extension+++' + uuid + ('^userContextId=4294967295' if storage_local else ''))

def write_storage_local(profile, uuid, items, external_over=None):
    """browser.storage.local as Firefox 66+ keeps it."""
    write_idb(os.path.join(origin_dir(profile, uuid, True), 'idb', '3647222921wleabcEoxlt-eengsairo.sqlite'),
              'webExtensions-storage-local', 'moz-extension://%s^userContextId=4294967295' % uuid, 1,
              [{'name': 'storage-local-data', 'records': [(k, v) for k, v in items.items()]}], external_over)

# --------------------------------------------------------------- selftest
if __name__ == '__main__' and sys.argv[1:] == ['selftest']:
    # Known snappy encodings (from the format description: a literal-only stream, and a run).
    assert snappy_compress(b'') == b'\x00'
    assert snappy_compress(b'abc') == b'\x03\x08abc'
    run = snappy_compress(b'a' * 100)
    assert run[0] == 100 and len(run) < 20, run
    # Key encoding examples worked out by hand from Key.cpp.
    assert encode_key('a') == bytes([0x30, ord('a') + 1])                 # (terminator trimmed)
    assert encode_key('é') == bytes([0x30, 0x80, 0xe9 - 0x7f])            # two-byte form
    assert encode_key(1.0) == bytes([0x10, 0xbf, 0xf0])                    # 1.0 = 0x3ff0…, sign bit set, zeros trimmed
    assert encode_key(['a']) == bytes([0x50 + 0x30, ord('a') + 1])
    print('ok')
