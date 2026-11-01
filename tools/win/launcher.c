// BifrostPortable.exe: starts the Bifrost build that matches this PC (ARM64 or x64) from App\.
// Built as 32-bit x86 so the one file runs on x64 Windows and on ARM64 Windows (10 and 11).
// Both builds share the Data folder next to this file (see portable.ini in each build's folder).
//
// Layout:  BifrostPortable\BifrostPortable.exe
//          BifrostPortable\App\Bifrost-x64\Bifrost.exe
//          BifrostPortable\App\Bifrost-arm64\Bifrost.exe
//          BifrostPortable\Data   (shared)
//
// Updates: Bifrost downloads them next to the builds and this puts them in before starting Bifrost:
//   App\Bifrost-<arch>.next                    a whole new build (a newer Electron)
//   App\Bifrost-<arch>\resources\app.next      just Bifrost's own files
// each complete once it has bifrost-update.json in it. With --bifrost-apply-update (first argument, from
// Bifrost's "Restart to update"), it waits for Bifrost to quit first; otherwise a build that's in use is
// left for next time.
#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <wchar.h>

#ifndef IMAGE_FILE_MACHINE_ARM64
#define IMAGE_FILE_MACHINE_ARM64 0xAA64
#endif
#ifndef PROCESSOR_ARCHITECTURE_ARM64
#define PROCESSOR_ARCHITECTURE_ARM64 12
#endif

typedef BOOL(WINAPI *IsWow64Process2Fn)(HANDLE, USHORT *, USHORT *);

static int native_arm64(void) {
  IsWow64Process2Fn f = (IsWow64Process2Fn)(void *)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "IsWow64Process2");
  if (f) {
    USHORT proc = 0, native = 0;
    if (f(GetCurrentProcess(), &proc, &native)) return native == IMAGE_FILE_MACHINE_ARM64;
  }
  SYSTEM_INFO si;
  GetNativeSystemInfo(&si);
  return si.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_ARM64;
}

static int exists(const wchar_t *p) {
  DWORD a = GetFileAttributesW(p);
  return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

static int dir_exists(const wchar_t *p) {
  DWORD a = GetFileAttributesW(p);
  return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY);
}

// Deletes a folder and everything in it (best effort).
static void remove_tree(const wchar_t *dir) {
  static wchar_t pat[32768];
  _snwprintf(pat, 32768, L"%s\\*", dir);
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(pat, &fd);
  if (h != INVALID_HANDLE_VALUE) {
    do {
      if (!wcscmp(fd.cFileName, L".") || !wcscmp(fd.cFileName, L"..")) continue;
      size_t n = wcslen(dir) + wcslen(fd.cFileName) + 2;
      wchar_t *p = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, n * sizeof(wchar_t));
      if (!p) continue;
      _snwprintf(p, n, L"%s\\%s", dir, fd.cFileName);
      if ((fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && !(fd.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) remove_tree(p);
      else { SetFileAttributesW(p, FILE_ATTRIBUTE_NORMAL); DeleteFileW(p); }
      HeapFree(GetProcessHeap(), 0, p);
    } while (FindNextFileW(h, &fd));
    FindClose(h);
  }
  RemoveDirectoryW(dir);
}

// Moves a folder; when patient, keeps trying for a while (Bifrost still quitting, antivirus scanning).
static int move_dir(const wchar_t *from, const wchar_t *to, int patient) {
  for (int i = 0; i < (patient ? 150 : 1); i++) {
    if (MoveFileExW(from, to, 0)) return 1;
    if (patient) Sleep(150);
  }
  return 0;
}

// from (a staged update, complete once it has bifrost-update.json) takes the place of to.
static void swap_in(const wchar_t *from, const wchar_t *to, int patient) {
  static wchar_t mark[32768], old[32768];
  _snwprintf(mark, 32768, L"%s\\bifrost-update.json", from);
  if (!exists(mark)) return;
  _snwprintf(old, 32768, L"%s.old", to);
  if (dir_exists(old)) remove_tree(old);
  if (!move_dir(to, old, patient)) return;              // in use: next time
  if (!MoveFileExW(from, to, 0)) { MoveFileExW(old, to, 0); return; }
  _snwprintf(mark, 32768, L"%s\\bifrost-update.json", to);
  DeleteFileW(mark);
  remove_tree(old);
}

static void apply_updates(const wchar_t *here, int patient) {
  static wchar_t build[32768], next[32768];
  const wchar_t *arches[2] = { L"x64", L"arm64" };
  for (int i = 0; i < 2; i++) {
    _snwprintf(build, 32768, L"%s\\App\\Bifrost-%s", here, arches[i]);
    _snwprintf(next, 32768, L"%s.next", build);
    if (dir_exists(next)) swap_in(next, build, patient);
    _snwprintf(next, 32768, L"%s\\resources\\app.next", build);
    static wchar_t app[32768];
    _snwprintf(app, 32768, L"%s\\resources\\app", build);
    if (dir_exists(next)) swap_in(next, app, patient);
  }
}

// The command line after our own program name.
static const wchar_t *rest_of_command_line(void) {
  const wchar_t *c = GetCommandLineW();
  if (*c == L'"') { c++; while (*c && *c != L'"') c++; if (*c) c++; }
  else { while (*c && *c != L' ' && *c != L'\t') c++; }
  while (*c == L' ' || *c == L'\t') c++;
  return c;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmd, int show) {
  (void)inst; (void)prev; (void)cmd;
  static wchar_t here[32768], exe[32768], dir[32768];
  DWORD n = GetModuleFileNameW(NULL, here, 32768);
  if (!n || n >= 32768) return 1;
  wchar_t *slash = wcsrchr(here, L'\\');
  if (slash) *slash = 0;

  const wchar_t *args = rest_of_command_line();
  static const wchar_t FLAG[] = L"--bifrost-apply-update";
  int patient = 0;
  if (!wcsncmp(args, FLAG, wcslen(FLAG)) && (args[wcslen(FLAG)] == 0 || args[wcslen(FLAG)] == L' ')) {
    patient = 1;
    args += wcslen(FLAG);
    while (*args == L' ' || *args == L'\t') args++;
  }
  apply_updates(here, patient);

  const wchar_t *order[2];
  if (native_arm64()) { order[0] = L"arm64"; order[1] = L"x64"; }
  else { order[0] = L"x64"; order[1] = NULL; }   // an ARM64 build can't run on x64
  int found = 0;
  for (int i = 0; i < 2 && order[i]; i++) {
    _snwprintf(dir, 32768, L"%s\\App\\Bifrost-%s", here, order[i]);
    _snwprintf(exe, 32768, L"%s\\Bifrost.exe", dir);
    if (exists(exe)) { found = 1; break; }
  }
  if (!found) {
    MessageBoxW(NULL, L"Bifrost's program files are missing from the App folder next to BifrostPortable.exe.\n\nRun the Bifrost setup again to repair it.", L"Bifrost", MB_ICONERROR);
    return 2;
  }

  size_t len = wcslen(exe) + wcslen(args) + 8;
  wchar_t *line = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, len * sizeof(wchar_t));
  if (!line) return 1;
  _snwprintf(line, len, L"\"%s\"%s%s", exe, *args ? L" " : L"", args);

  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof si);
  si.cb = sizeof si;
  si.dwFlags = STARTF_USESHOWWINDOW;
  si.wShowWindow = (WORD)show;
  AllowSetForegroundWindow(ASFW_ANY);
  if (!CreateProcessW(exe, line, NULL, NULL, FALSE, 0, NULL, dir, &si, &pi)) {
    wchar_t msg[600];
    _snwprintf(msg, 600, L"Bifrost couldn't be started (error %lu).", GetLastError());
    MessageBoxW(NULL, msg, L"Bifrost", MB_ICONERROR);
    return 3;
  }
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return 0;
}
