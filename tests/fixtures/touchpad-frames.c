// The touchpad watcher's frames (tools/win/touchpad.c) with made-up reports: how many fingers it says are down,
// one report a frame or several ("hybrid"), fingers coming and lifting, palms, reports that aren't contacts.
// Windows' own HID parsing isn't what's tested here. Built with llvm-mingw and run under Wine by
// tests/unit/touchpad.test.mjs.
#define TOUCHPAD_TEST
#include "../../tools/win/touchpad.c"
#include <stdio.h>

typedef struct { ULONG count; int ok; int tips[MAX_SLOTS]; int fingers[MAX_SLOTS]; } Fake;
static char said[4096];
void say(const char *what, int n) { char b[48]; sprintf(b, "%s %d;", what, n); strcat(said, b); }
int testCount(PCHAR rep, ULONG *count) { Fake *f = (Fake *)rep; if (!f->ok) return 0; *count = f->count; return 1; }
int testTip(int slot, PCHAR rep) { return ((Fake *)rep)->tips[slot]; }
int testFinger(int slot, PCHAR rep) { return ((Fake *)rep)->fingers[slot]; }

// A touchpad whose contacts say whether they're fingers (confidence), as precision touchpads' must, or not.
static Pad *padSure(int nslots, int sure) {
  npads = 0; fingers = -1;
  Pad *p = &pads[npads++];
  memset(p, 0, sizeof *p);
  p->pp = (PHIDP_PREPARSED_DATA)1;
  p->nslots = nslots;
  for (int k = 0; k < nslots; k++) p->sure[k] = (BYTE)sure;
  return p;
}
static Pad *pad(int nslots) { return padSure(nslots, 1); }
// A report: its contact count (ok 0: not a contacts report at all), and each slot's contact ("1100…": 1 a
// finger touching, p something touching that isn't a finger, a palm say, 0 nothing).
static void rep(Pad *p, ULONG count, int ok, const char *tips) {
  Fake f;
  memset(&f, 0, sizeof f);
  f.count = count; f.ok = ok;
  for (int i = 0; tips[i] && i < MAX_SLOTS; i++) { f.tips[i] = tips[i] == '1' || tips[i] == 'p'; f.fingers[i] = tips[i] == '1'; }
  report(p, (PCHAR)&f, sizeof f);
}
static int fails, total;
static void check(const char *name, const char *want) {
  int ok = strcmp(said, want) == 0;
  total++;
  printf("  %s %s\n", ok ? "\xE2\x9C\x93" : "\xE2\x9C\x97", name);
  if (!ok) { printf("      said %s\n      want %s\n", said, want); fails++; }
  said[0] = 0;
}

int main(void) {
  Pad *p = pad(5);
  rep(p, 2, 1, "11000"); rep(p, 2, 1, "11000"); rep(p, 2, 1, "11000");
  rep(p, 2, 1, "00000");   // both lift: reported once more, tip switches off
  check("one report a frame: two fingers down, moving, then lifting", "fingers 2;fingers 0;");

  p = pad(5);
  rep(p, 1, 1, "10000"); rep(p, 2, 1, "11000"); rep(p, 2, 1, "11000"); rep(p, 2, 1, "01000"); rep(p, 1, 1, "00000");
  check("fingers coming and going one at a time", "fingers 1;fingers 2;fingers 1;fingers 0;");

  p = pad(2);
  rep(p, 3, 1, "11"); rep(p, 0, 1, "10");   // three fingers, two slots a report: a frame in two reports
  rep(p, 3, 1, "11"); rep(p, 0, 1, "10");
  rep(p, 3, 1, "11"); rep(p, 0, 1, "00");   // one lifts (reported up), two left
  rep(p, 2, 1, "11");                       // two contacts fit in one report
  rep(p, 2, 1, "00");
  check("several reports a frame: the count only once the frame is whole", "fingers 3;fingers 2;fingers 0;");

  p = pad(2);
  rep(p, 3, 1, "11");
  check("…nothing said halfway through a frame", "");
  rep(p, 0, 1, "10");
  check("…and the whole frame at its end", "fingers 3;");

  p = pad(5);
  rep(p, 2, 1, "11000"); rep(p, 0, 0, "11111"); rep(p, 7, 0, "00000"); rep(p, 2, 1, "11000");
  check("reports that aren't contacts (a button, say) change nothing", "fingers 2;");

  p = pad(5);
  rep(p, 2, 1, "11000"); rep(p, 0, 1, "00000");
  check("a report with nothing on the touchpad", "fingers 2;fingers 0;");

  p = pad(5);
  rep(p, 1, 1, "p0000"); rep(p, 3, 1, "p1100"); rep(p, 3, 1, "p1100"); rep(p, 3, 1, "p0000"); rep(p, 1, 1, "p0000");
  check("a palm resting on it isn't a finger: two fingers down, then up, the palm still there", "fingers 0;fingers 2;fingers 0;");

  p = padSure(5, 0);
  rep(p, 2, 1, "p1000"); rep(p, 2, 1, "00000");
  check("…unless the touchpad doesn't say which are fingers: then everything touching is", "fingers 2;fingers 0;");

  p = pad(5);
  rep(p, 2, 1, "11000");
  Pad *q = &pads[npads++];
  memset(q, 0, sizeof *q); q->pp = (PHIDP_PREPARSED_DATA)1; q->nslots = 5;
  for (int k = 0; k < 5; k++) q->sure[k] = 1;
  rep(q, 1, 1, "10000"); rep(p, 2, 1, "00000"); rep(q, 1, 1, "00000");
  check("two touchpads: the fingers on both", "fingers 2;fingers 3;fingers 1;fingers 0;");

  printf("\ntouchpad-frames: %d/%d passed\n", total - fails, total);
  return fails ? 1 : 0;
}
