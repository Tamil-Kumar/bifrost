"""Real pointer and keyboard input for the end-to-end tests, through the X server's XTest extension, so
Bifrost sees exactly what a person's mouse and keyboard would send (hover, real clicks, wheel, held keys).
Reads one command per line on stdin and answers each with one line:
  move X Y        pointer to screen position X, Y
  down B / up B   mouse button B (1 left, 2 middle, 3 right)
  wheel DIR N     N notches of the wheel: up, down, left, right
  key K           press and release the key with keysym name K (Return, Escape, a, Control_L, ...)
  keydown K / keyup K
  pos             where the pointer is
"""
import ctypes, ctypes.util, sys

x11 = ctypes.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
xtst = ctypes.CDLL(ctypes.util.find_library('Xtst') or 'libXtst.so.6')
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong),
                              ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint)]
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

d = x11.XOpenDisplay(None)
if not d:
    sys.stderr.write('xinput: no X display\n')
    sys.exit(1)

def keycode(name):
    ks = x11.XStringToKeysym(name.encode())
    if not ks:
        raise ValueError('unknown key ' + name)
    return x11.XKeysymToKeycode(d, ks)

WHEEL = {'up': 4, 'down': 5, 'left': 6, 'right': 7}
for line in sys.stdin:
    a = line.split()
    out = 'ok'
    try:
        if not a:
            pass
        elif a[0] == 'move':
            xtst.XTestFakeMotionEvent(d, -1, int(a[1]), int(a[2]), 0)
        elif a[0] in ('down', 'up'):
            xtst.XTestFakeButtonEvent(d, int(a[1]), 1 if a[0] == 'down' else 0, 0)
        elif a[0] == 'wheel':
            b = WHEEL[a[1]]
            for _ in range(int(a[2]) if len(a) > 2 else 1):
                xtst.XTestFakeButtonEvent(d, b, 1, 0); xtst.XTestFakeButtonEvent(d, b, 0, 0)
        elif a[0] == 'key':
            k = keycode(a[1]); xtst.XTestFakeKeyEvent(d, k, 1, 0); xtst.XTestFakeKeyEvent(d, k, 0, 0)
        elif a[0] in ('keydown', 'keyup'):
            xtst.XTestFakeKeyEvent(d, keycode(a[1]), 1 if a[0] == 'keydown' else 0, 0)
        elif a[0] == 'pos':
            root, child = ctypes.c_ulong(), ctypes.c_ulong()
            rx, ry, wx, wy = ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
            mask = ctypes.c_uint()
            x11.XQueryPointer(d, x11.XDefaultRootWindow(d), ctypes.byref(root), ctypes.byref(child), ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(mask))
            out = '%d %d' % (rx.value, ry.value)
        else:
            out = 'error unknown command'
        x11.XSync(d, 0)
    except Exception as e:
        out = 'error ' + str(e)
    sys.stdout.write(out + '\n')
    sys.stdout.flush()
