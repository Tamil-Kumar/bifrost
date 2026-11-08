// Bifrost's touchpad watcher (Windows). Tells Bifrost how many fingers are on the touchpad, so that a
// two-finger swipe goes back or forward the moment they lift (src/main/touchpad.js runs it). Chromium can't
// say: after a quick swipe the touchpad's scroll goes straight on into coasting, and nothing in the wheel
// events it passes on tells the coasting from fingers still moving.
//
// Precision touchpads send their contacts as HID reports, which any program may read (raw input; here also
// while another program has the keyboard: RIDEV_INPUTSINK). Each report has the frame's contact count and,
// per contact, its tip switch (on while it touches) and confidence (off for a palm, say, which Windows
// ignores, and so do we). A frame may take several reports ("hybrid" mode: the first says how many
// contacts, the rest say 0).
//
// Writes, on stdout, one line each: "touchpads N" at the start (and when one comes or goes), "fingers N"
// whenever the number of fingers on the touchpad changes. Exits when stdin closes (Bifrost has quit).
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winternl.h>   // (NTSTATUS, for hidpi.h)
#include <hidusage.h>
#include <hidpi.h>
#include <stdlib.h>
#include <string.h>

#define PAGE_DIGITIZER 0x0D
#define USAGE_TOUCH_PAD 0x05
#define USAGE_TIP_SWITCH 0x42
#define USAGE_CONFIDENCE 0x47
#define USAGE_CONTACT_ID 0x51
#define USAGE_CONTACT_COUNT 0x54
#define MAX_PADS 8
#define MAX_SLOTS 16

typedef struct {
  HANDLE dev;
  PHIDP_PREPARSED_DATA pp;   // NULL: not a touchpad we can read
  USHORT slots[MAX_SLOTS];   // the link collections of the contacts a report holds
  BYTE sure[MAX_SLOTS];      // whether the contact there says if it's a finger (confidence)
  int nslots;
  USAGE *usages;
  ULONG maxUsages;
  int left;                  // reports still to come in this frame
  int down;                  // fingers down in this frame so far
  int settled;               // fingers down in its last whole frame
} Pad;

static Pad pads[MAX_PADS];
static int npads;
static int fingers = -1;
static HANDLE out;
static BYTE *buf;
static UINT bufSize;

#ifdef TOUCHPAD_TEST
// (tests/fixtures/touchpad-frames.c: made-up reports, and what we'd say)
void say(const char *what, int n);
int testCount(PCHAR rep, ULONG *count);
int testTip(int slot, PCHAR rep);
int testFinger(int slot, PCHAR rep);
#else
static void say(const char *what, int n) {
  char line[48];
  int len = wsprintfA(line, "%s %d\n", what, n);
  DWORD w;
  WriteFile(out, line, (DWORD)len, &w, NULL);
}
#endif

static void settle(void) {
  int total = 0;
  for (int i = 0; i < npads; i++) if (pads[i].pp) total += pads[i].settled;
  if (total != fingers) { fingers = total; say("fingers", total); }
}

#ifndef TOUCHPAD_TEST
static void forget(Pad *p) {
  if (p->pp) free(p->pp);
  if (p->usages) free(p->usages);
  memset(p, 0, sizeof *p);
}

// The touchpad a report came from, read once: which link collections hold its contacts.
static Pad *padFor(HANDLE dev) {
  for (int i = 0; i < npads; i++) if (pads[i].dev == dev) return pads[i].pp ? &pads[i] : NULL;
  Pad *p = NULL;
  for (int i = 0; i < npads; i++) if (!pads[i].dev) { p = &pads[i]; break; }
  if (!p) { if (npads == MAX_PADS) return NULL; p = &pads[npads++]; }
  memset(p, 0, sizeof *p);
  p->dev = dev;
  UINT size = 0;
  if (GetRawInputDeviceInfoW(dev, RIDI_PREPARSEDDATA, NULL, &size) != 0 || !size) return NULL;
  PHIDP_PREPARSED_DATA pp = (PHIDP_PREPARSED_DATA)malloc(size);
  if (!pp) return NULL;
  if (GetRawInputDeviceInfoW(dev, RIDI_PREPARSEDDATA, pp, &size) == (UINT)-1) { free(pp); return NULL; }
  HIDP_CAPS caps;
  if (HidP_GetCaps(pp, &caps) != HIDP_STATUS_SUCCESS) { free(pp); return NULL; }
  USHORT n = caps.NumberInputValueCaps;
  HIDP_VALUE_CAPS *vc = (HIDP_VALUE_CAPS *)calloc(n ? n : 1, sizeof *vc);
  if (vc && n && HidP_GetValueCaps(HidP_Input, vc, &n, pp) == HIDP_STATUS_SUCCESS) {
    for (USHORT i = 0; i < n; i++) {
      if (vc[i].UsagePage != PAGE_DIGITIZER) continue;
      int id = vc[i].IsRange ? (vc[i].Range.UsageMin <= USAGE_CONTACT_ID && USAGE_CONTACT_ID <= vc[i].Range.UsageMax) : vc[i].NotRange.Usage == USAGE_CONTACT_ID;
      if (!id) continue;
      int dup = 0;
      for (int k = 0; k < p->nslots; k++) if (p->slots[k] == vc[i].LinkCollection) dup = 1;
      if (!dup && p->nslots < MAX_SLOTS) p->slots[p->nslots++] = vc[i].LinkCollection;
    }
  }
  free(vc);
  for (int k = 0; k < p->nslots; k++) {
    HIDP_BUTTON_CAPS bc[4];
    USHORT nb = 4;
    p->sure[k] = HidP_GetSpecificButtonCaps(HidP_Input, PAGE_DIGITIZER, p->slots[k], USAGE_CONFIDENCE, bc, &nb, pp) == HIDP_STATUS_SUCCESS && nb > 0;
  }
  p->maxUsages = HidP_MaxUsageListLength(HidP_Input, PAGE_DIGITIZER, pp);
  if (!p->nslots || !p->maxUsages || !(p->usages = (USAGE *)malloc(p->maxUsages * sizeof(USAGE)))) { free(pp); return NULL; }
  p->pp = pp;
  return p;
}

#endif

// The report's contact count (no: it's another of its reports, not one with contacts), and whether the
// contact in a slot is a finger touching the touchpad.
static int contactCount(Pad *p, PCHAR rep, ULONG len, ULONG *count) {
#ifdef TOUCHPAD_TEST
  (void)p; (void)len;
  return testCount(rep, count);
#else
  return HidP_GetUsageValue(HidP_Input, PAGE_DIGITIZER, 0, USAGE_CONTACT_COUNT, count, p->pp, rep, len) == HIDP_STATUS_SUCCESS;
#endif
}
static int touches(Pad *p, int slot, PCHAR rep, ULONG len) {
  int tip = 0, finger = 0;
#ifdef TOUCHPAD_TEST
  (void)len;
  tip = testTip(slot, rep);
  finger = testFinger(slot, rep);
#else
  ULONG n = p->maxUsages;
  if (HidP_GetUsages(HidP_Input, PAGE_DIGITIZER, p->slots[slot], p->usages, &n, p->pp, rep, len) != HIDP_STATUS_SUCCESS) return 0;
  for (ULONG u = 0; u < n; u++) {
    if (p->usages[u] == USAGE_TIP_SWITCH) tip = 1;
    else if (p->usages[u] == USAGE_CONFIDENCE) finger = 1;
  }
#endif
  return tip && (finger || !p->sure[slot]);
}

static void report(Pad *p, PCHAR rep, ULONG len) {
  ULONG count = 0;
  if (!contactCount(p, rep, len, &count)) return;
  int down = 0;
  for (int s = 0; s < p->nslots; s++) down += touches(p, s, rep, len);
  if (count > 0) {
    // A new frame: its contacts in this report and the ones after it (empty slots have their tip switch off).
    p->down = 0;
    p->left = (int)((count + p->nslots - 1) / p->nslots);
  } else if (p->left <= 0) {
    // Nothing on it.
    p->down = 0;
    p->left = 1;
  }
  p->down += down;
  if (--p->left <= 0) { p->settled = p->down; settle(); }
}

#ifndef TOUCHPAD_TEST
static int countPads(void) {
  UINT n = 0;
  if (GetRawInputDeviceList(NULL, &n, sizeof(RAWINPUTDEVICELIST)) != 0 || !n) return 0;
  RAWINPUTDEVICELIST *list = (RAWINPUTDEVICELIST *)calloc(n, sizeof *list);
  if (!list) return 0;
  int found = 0;
  UINT got = GetRawInputDeviceList(list, &n, sizeof(RAWINPUTDEVICELIST));
  for (UINT i = 0; got != (UINT)-1 && i < got; i++) {
    if (list[i].dwType != RIM_TYPEHID) continue;
    RID_DEVICE_INFO info;
    UINT size = sizeof info;
    info.cbSize = sizeof info;
    if (GetRawInputDeviceInfoW(list[i].hDevice, RIDI_DEVICEINFO, &info, &size) == (UINT)-1) continue;
    if (info.hid.usUsagePage == PAGE_DIGITIZER && info.hid.usUsage == USAGE_TOUCH_PAD) found++;
  }
  free(list);
  return found;
}

static LRESULT CALLBACK proc(HWND w, UINT m, WPARAM wp, LPARAM lp) {
  switch (m) {
    case WM_INPUT: {
      UINT size = 0;
      GetRawInputData((HRAWINPUT)lp, RID_INPUT, NULL, &size, sizeof(RAWINPUTHEADER));
      if (size > bufSize) { BYTE *b = (BYTE *)realloc(buf, size); if (!b) break; buf = b; bufSize = size; }
      if (size && GetRawInputData((HRAWINPUT)lp, RID_INPUT, buf, &size, sizeof(RAWINPUTHEADER)) == size) {
        RAWINPUT *ri = (RAWINPUT *)buf;
        if (ri->header.dwType == RIM_TYPEHID) {
          Pad *p = padFor(ri->header.hDevice);
          if (p) for (DWORD i = 0; i < ri->data.hid.dwCount; i++)
            report(p, (PCHAR)ri->data.hid.bRawData + (SIZE_T)i * ri->data.hid.dwSizeHid, ri->data.hid.dwSizeHid);
        }
      }
      break;   // (on to DefWindowProc, which cleans up after raw input)
    }
    case WM_INPUT_DEVICE_CHANGE:
      if (wp == GIDC_REMOVAL) for (int i = 0; i < npads; i++) if (pads[i].dev == (HANDLE)lp) { forget(&pads[i]); settle(); }
      say("touchpads", countPads());
      return 0;
    case WM_CLOSE: DestroyWindow(w); return 0;
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(w, m, wp, lp);
}

// Bifrost going away closes our stdin: then so do we.
static DWORD WINAPI watch(LPVOID w) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char b[64];
  DWORD n;
  while (in && in != INVALID_HANDLE_VALUE && ReadFile(in, b, sizeof b, &n, NULL) && n) {}
  PostMessageW((HWND)w, WM_CLOSE, 0, 0);
  return 0;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, LPWSTR cmd, int show) {
  (void)prev; (void)cmd; (void)show;
  out = GetStdHandle(STD_OUTPUT_HANDLE);
  WNDCLASSW wc;
  memset(&wc, 0, sizeof wc);
  wc.lpfnWndProc = proc;
  wc.hInstance = inst;
  wc.lpszClassName = L"BifrostTouchpad";
  RegisterClassW(&wc);
  HWND w = CreateWindowExW(0, wc.lpszClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, NULL, inst, NULL);
  RAWINPUTDEVICE rid = { PAGE_DIGITIZER, USAGE_TOUCH_PAD, RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, w };
  if (!w || !RegisterRawInputDevices(&rid, 1, sizeof rid)) { say("touchpads", -1); return 1; }
  say("touchpads", countPads());
  HANDLE t = CreateThread(NULL, 0, watch, w, 0, NULL);
  if (t) CloseHandle(t);
  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}
#endif
