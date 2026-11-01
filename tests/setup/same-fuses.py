# Exits 0 if a Bifrost.exe has the same Electron fuses as electron.exe in the runtime zip it was built from
# (castlabs' Widevine signing refuses a binary whose fuses were changed).
#   python3 same-fuses.py <Bifrost.exe> <electron-v…-win32-x64.zip>
import sys, zipfile

SENTINEL = b'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'

def wire(data):
    at = data.index(SENTINEL) + len(SENTINEL)
    count = data[at + 1]
    return data[at + 2:at + 2 + count]

ours = wire(open(sys.argv[1], 'rb').read())
theirs = wire(zipfile.ZipFile(sys.argv[2]).read('electron.exe'))
print('fuses', ours.decode('latin1'), 'electron.exe', theirs.decode('latin1'))
sys.exit(0 if ours == theirs else 1)
