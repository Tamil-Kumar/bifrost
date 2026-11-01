// Bifrost's Windows installer and uninstaller (one program).
//
// Bifrost-Setup-<arch>.exe = this program + a zip of the Bifrost folder + a trailer:
//   [zip][meta text][u32 meta length][u64 zip offset][u64 zip size]["BFRSTPK1"]
// Run with the payload it installs; the same program without a payload, saved in the install folder
// as "Uninstall Bifrost.exe", removes it again.
//
// Installs per user (no administrator rights): %LOCALAPPDATA%\Programs\Bifrost by default, a Start menu
// shortcut, an entry in Settings > Apps, and (optionally) the registration that lets Windows offer
// Bifrost as a browser. Bifrost keeps its profile in %APPDATA%\Bifrost, which uninstalling keeps
// unless you ask for it to be removed.
//
// Command line:  /S          silent (no windows; exit code 0 on success)
//                /D=<folder> install folder (last argument; may contain spaces)
//                /desktop    also put a shortcut on the desktop      /noregister  skip the browser registration
//                /start      start Bifrost afterwards (silent mode)
//                /wait       first wait (up to a minute) for a running Bifrost there to quit (updates)
// Uninstaller:   /S          silent        /removedata  also delete %APPDATA%\Bifrost
//                /apply      instead: put in the update Bifrost downloaded (resources\app.next becomes
//                            resources\app) once Bifrost has quit; with /start, start it again
#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <knownfolders.h>
#include <shobjidl.h>
#include <objbase.h>
#include <propsys.h>
#include <wchar.h>
#include <stdio.h>
#include <string.h>
#include "miniz.h"

#define APP_NAME L"Bifrost"
#define PROGID L"BifrostHTML"
#define AUMID L"Bifrost.Browser"
#define EXE_NAME L"Bifrost.exe"
#define UNINSTALLER_NAME L"Uninstall Bifrost.exe"
#define UNINSTALL_KEY L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Bifrost"
#define CLIENT_KEY L"Software\\Clients\\StartMenuInternet\\Bifrost"
#define MAGIC "BFRSTPK1"
#define PATHMAX 4096

static const PROPERTYKEY PK_AppUserModel_ID = { { 0x9F4C2855, 0x9F79, 0x4B39, { 0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3 } }, 5 };

// ---------------------------------------------------------------- state
static wchar_t g_self[PATHMAX];
static wchar_t g_dir[PATHMAX];              // install folder
static wchar_t g_version[64] = L"";
static wchar_t g_arch[32] = L"";
static HANDLE g_selfFile = INVALID_HANDLE_VALUE;
static unsigned long long g_zipOff, g_zipSize;
static int g_silent, g_desktop, g_register = 1, g_start, g_removeData, g_wait, g_apply;
static int g_uninstall;
static wchar_t g_uninstallFrom[PATHMAX];
static wchar_t g_error[2048];
static volatile LONG g_permille;
static HWND g_wnd;

static void fail(const wchar_t *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  _vsnwprintf(g_error, 2047, fmt, ap);
  g_error[2047] = 0;
  va_end(ap);
}

static int file_exists(const wchar_t *p) { DWORD a = GetFileAttributesW(p); return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY); }
static int dir_exists(const wchar_t *p) { DWORD a = GetFileAttributesW(p); return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY); }

static void join(wchar_t *out, const wchar_t *a, const wchar_t *b) {
  _snwprintf(out, PATHMAX, L"%s%s%s", a, (a[0] && a[wcslen(a) - 1] != L'\\') ? L"\\" : L"", b);
  out[PATHMAX - 1] = 0;
}

static int known_folder(REFKNOWNFOLDERID id, wchar_t *out) {
  PWSTR p = NULL;
  if (FAILED(SHGetKnownFolderPath(id, 0, NULL, &p))) return 0;
  wcsncpy(out, p, PATHMAX - 1);
  out[PATHMAX - 1] = 0;
  CoTaskMemFree(p);
  return 1;
}

static int make_dirs(const wchar_t *path) {
  wchar_t tmp[PATHMAX];
  wcsncpy(tmp, path, PATHMAX - 1);
  tmp[PATHMAX - 1] = 0;
  for (wchar_t *p = tmp + 3; *p; p++) {
    if (*p == L'\\') { *p = 0; CreateDirectoryW(tmp, NULL); *p = L'\\'; }
  }
  return CreateDirectoryW(tmp, NULL) || GetLastError() == ERROR_ALREADY_EXISTS;
}

// Deletes a folder and everything in it. Returns 0 (and names the file) if something couldn't go.
static int remove_tree(const wchar_t *dir) {
  wchar_t pat[PATHMAX], p[PATHMAX];
  join(pat, dir, L"*");
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(pat, &fd);
  int ok = 1;
  if (h != INVALID_HANDLE_VALUE) {
    do {
      if (!wcscmp(fd.cFileName, L".") || !wcscmp(fd.cFileName, L"..")) continue;
      join(p, dir, fd.cFileName);
      if (fd.dwFileAttributes & FILE_ATTRIBUTE_READONLY) SetFileAttributesW(p, fd.dwFileAttributes & ~FILE_ATTRIBUTE_READONLY);
      if ((fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && !(fd.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
        if (!remove_tree(p)) ok = 0;
      } else if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
        if (!RemoveDirectoryW(p)) ok = 0;
      } else if (!DeleteFileW(p)) {
        if (ok) fail(L"Couldn't remove %s (error %lu).", p, GetLastError());
        ok = 0;
      }
    } while (FindNextFileW(h, &fd));
    FindClose(h);
  }
  if (ok && !RemoveDirectoryW(dir) && GetLastError() != ERROR_FILE_NOT_FOUND) ok = 0;
  return ok;
}

static int folder_is_empty(const wchar_t *dir) {
  wchar_t pat[PATHMAX];
  join(pat, dir, L"*");
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(pat, &fd);
  if (h == INVALID_HANDLE_VALUE) return 1;
  int empty = 1;
  do { if (wcscmp(fd.cFileName, L".") && wcscmp(fd.cFileName, L"..")) { empty = 0; break; } } while (FindNextFileW(h, &fd));
  FindClose(h);
  return empty;
}

// Bifrost.exe can't be opened exclusively while it runs.
static int bifrost_running(const wchar_t *dir) {
  wchar_t exe[PATHMAX];
  join(exe, dir, EXE_NAME);
  if (!file_exists(exe)) return 0;
  HANDLE h = CreateFileW(exe, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  if (h == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_SHARING_VIOLATION;
  CloseHandle(h);
  return 0;
}

// ---------------------------------------------------------------- registry
static int reg_set(const wchar_t *key, const wchar_t *name, const wchar_t *value) {
  HKEY k;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, key, 0, NULL, 0, KEY_SET_VALUE, NULL, &k, NULL) != ERROR_SUCCESS) return 0;
  LONG r = RegSetValueExW(k, name, 0, REG_SZ, (const BYTE *)value, (DWORD)((wcslen(value) + 1) * sizeof(wchar_t)));
  RegCloseKey(k);
  return r == ERROR_SUCCESS;
}
static int reg_dword(const wchar_t *key, const wchar_t *name, DWORD value) {
  HKEY k;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, key, 0, NULL, 0, KEY_SET_VALUE, NULL, &k, NULL) != ERROR_SUCCESS) return 0;
  LONG r = RegSetValueExW(k, name, 0, REG_DWORD, (const BYTE *)&value, sizeof value);
  RegCloseKey(k);
  return r == ERROR_SUCCESS;
}
static int reg_get(const wchar_t *key, const wchar_t *name, wchar_t *out, DWORD chars) {
  DWORD size = chars * sizeof(wchar_t);
  out[0] = 0;
  if (RegGetValueW(HKEY_CURRENT_USER, key, name, RRF_RT_REG_SZ, NULL, out, &size) != ERROR_SUCCESS) return 0;
  return 1;
}
static void reg_delete_value(const wchar_t *key, const wchar_t *name) {
  HKEY k;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, key, 0, KEY_SET_VALUE, &k) == ERROR_SUCCESS) { RegDeleteValueW(k, name); RegCloseKey(k); }
}

// The keys Windows reads to list Bifrost in Default apps (the same ones Bifrost writes itself).
static void register_browser(const wchar_t *exe) {
  wchar_t q[PATHMAX], icon[PATHMAX], cmd[PATHMAX], k[512];
  _snwprintf(q, PATHMAX, L"\"%s\"", exe);
  _snwprintf(icon, PATHMAX, L"\"%s\",0", exe);
  _snwprintf(cmd, PATHMAX, L"\"%s\" --single-argument %%1", exe);
  reg_set(CLIENT_KEY, NULL, APP_NAME);
  reg_set(CLIENT_KEY L"\\Capabilities", L"ApplicationName", APP_NAME);
  reg_set(CLIENT_KEY L"\\Capabilities", L"ApplicationDescription", L"A fast, customizable browser");
  reg_set(CLIENT_KEY L"\\Capabilities", L"ApplicationIcon", icon);
  static const wchar_t *protos[] = { L"http", L"https", L"ftp" };
  for (int i = 0; i < 3; i++) reg_set(CLIENT_KEY L"\\Capabilities\\URLAssociations", protos[i], PROGID);
  static const wchar_t *exts[] = { L".htm", L".html", L".shtml", L".xhtml", L".svg", L".webp", L".pdf" };
  for (int i = 0; i < 7; i++) reg_set(CLIENT_KEY L"\\Capabilities\\FileAssociations", exts[i], PROGID);
  reg_set(CLIENT_KEY L"\\Capabilities\\StartMenu", L"StartMenuInternet", APP_NAME);
  reg_set(CLIENT_KEY L"\\DefaultIcon", NULL, icon);
  reg_set(CLIENT_KEY L"\\shell\\open\\command", NULL, q);
  _snwprintf(k, 512, L"Software\\Classes\\%s", PROGID);
  reg_set(k, NULL, L"Bifrost HTML Document");
  reg_set(k, L"AppUserModelId", AUMID);
  _snwprintf(k, 512, L"Software\\Classes\\%s\\Application", PROGID);
  reg_set(k, L"ApplicationName", APP_NAME);
  reg_set(k, L"ApplicationIcon", icon);
  reg_set(k, L"AppUserModelId", AUMID);
  _snwprintf(k, 512, L"Software\\Classes\\%s\\DefaultIcon", PROGID);
  reg_set(k, NULL, icon);
  _snwprintf(k, 512, L"Software\\Classes\\%s\\shell\\open\\command", PROGID);
  reg_set(k, NULL, cmd);
  reg_set(L"Software\\RegisteredApplications", APP_NAME, CLIENT_KEY L"\\Capabilities");
}

static int StrStrIW_compat(const wchar_t *hay, const wchar_t *needle) {
  size_t n = wcslen(needle);
  for (; *hay; hay++) if (!_wcsnicmp(hay, needle, n)) return 1;
  return 0;
}

// Removes the browser registration, but only if it points at this install (a portable Bifrost may
// have registered itself under the same name).
static void unregister_browser(const wchar_t *dir) {
  wchar_t v[PATHMAX];
  if (reg_get(CLIENT_KEY L"\\shell\\open\\command", NULL, v, PATHMAX) && StrStrIW_compat(v, dir)) {
    RegDeleteTreeW(HKEY_CURRENT_USER, CLIENT_KEY);
    reg_delete_value(L"Software\\RegisteredApplications", APP_NAME);
  }
  if (reg_get(L"Software\\Classes\\" PROGID L"\\shell\\open\\command", NULL, v, PATHMAX) && StrStrIW_compat(v, dir))
    RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\Classes\\" PROGID);
}

// ---------------------------------------------------------------- shortcuts
static int make_shortcut(const wchar_t *lnk, const wchar_t *exe, const wchar_t *dir) {
  IShellLinkW *sl = NULL;
  if (FAILED(CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void **)&sl))) return 0;
  IShellLinkW_SetPath(sl, exe);
  IShellLinkW_SetWorkingDirectory(sl, dir);
  IShellLinkW_SetIconLocation(sl, exe, 0);
  IShellLinkW_SetDescription(sl, L"Bifrost browser");
  IPropertyStore *ps = NULL;
  if (SUCCEEDED(IShellLinkW_QueryInterface(sl, &IID_IPropertyStore, (void **)&ps))) {
    PROPVARIANT pv;
    ZeroMemory(&pv, sizeof pv);
    pv.vt = VT_LPWSTR;
    pv.pwszVal = (LPWSTR)AUMID;
    IPropertyStore_SetValue(ps, &PK_AppUserModel_ID, &pv);
    IPropertyStore_Commit(ps);
    IPropertyStore_Release(ps);
  }
  IPersistFile *pf = NULL;
  int ok = 0;
  if (SUCCEEDED(IShellLinkW_QueryInterface(sl, &IID_IPersistFile, (void **)&pf))) {
    ok = SUCCEEDED(IPersistFile_Save(pf, lnk, TRUE));
    IPersistFile_Release(pf);
  }
  IShellLinkW_Release(sl);
  return ok;
}

static void shortcut_paths(wchar_t *startMenu, wchar_t *desktop) {
  wchar_t d[PATHMAX];
  startMenu[0] = desktop[0] = 0;
  if (known_folder(&FOLDERID_Programs, d)) join(startMenu, d, L"Bifrost.lnk");
  if (known_folder(&FOLDERID_Desktop, d)) join(desktop, d, L"Bifrost.lnk");
}

// ---------------------------------------------------------------- payload
static int read_at(unsigned long long ofs, void *buf, DWORD n) {
  OVERLAPPED ov;
  ZeroMemory(&ov, sizeof ov);
  ov.Offset = (DWORD)ofs;
  ov.OffsetHigh = (DWORD)(ofs >> 32);
  DWORD got = 0;
  return ReadFile(g_selfFile, buf, n, &got, &ov) && got == n;
}

static void meta_value(const char *meta, const char *key, wchar_t *out, int chars) {
  size_t kl = strlen(key);
  for (const char *p = meta; p && *p;) {
    const char *e = strchr(p, '\n');
    size_t len = e ? (size_t)(e - p) : strlen(p);
    if (len > kl && !strncmp(p, key, kl) && p[kl] == '=') {
      char tmp[256];
      size_t vl = len - kl - 1;
      if (vl > 255) vl = 255;
      memcpy(tmp, p + kl + 1, vl);
      tmp[vl] = 0;
      MultiByteToWideChar(CP_UTF8, 0, tmp, -1, out, chars);
      return;
    }
    p = e ? e + 1 : NULL;
  }
}

static unsigned long long g_installBytes;

// Finds the payload at the end of this program. Returns 0 when there isn't one (the uninstaller).
static int open_payload(void) {
  g_selfFile = CreateFileW(g_self, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
  if (g_selfFile == INVALID_HANDLE_VALUE) return 0;
  LARGE_INTEGER size;
  if (!GetFileSizeEx(g_selfFile, &size) || size.QuadPart < 64) return 0;
  unsigned char tail[28];
  if (!read_at(size.QuadPart - 28, tail, 28) || memcmp(tail + 20, MAGIC, 8)) return 0;
  DWORD metaLen;
  memcpy(&metaLen, tail, 4);
  memcpy(&g_zipOff, tail + 4, 8);
  memcpy(&g_zipSize, tail + 12, 8);
  if (metaLen > 4096 || g_zipOff + g_zipSize + metaLen + 28 != (unsigned long long)size.QuadPart) return 0;
  char meta[4097];
  if (!read_at(g_zipOff + g_zipSize, meta, metaLen)) return 0;
  meta[metaLen] = 0;
  meta_value(meta, "version", g_version, 64);
  meta_value(meta, "arch", g_arch, 32);
  wchar_t bytes[64] = L"";
  meta_value(meta, "bytes", bytes, 64);
  g_installBytes = _wcstoui64(bytes, NULL, 10);
  return 1;
}

static size_t zip_read(void *opaque, mz_uint64 ofs, void *buf, size_t n) {
  (void)opaque;
  size_t done = 0;
  while (done < n) {
    DWORD chunk = (DWORD)((n - done) > (1u << 30) ? (1u << 30) : (n - done));
    if (!read_at(g_zipOff + ofs + done, (char *)buf + done, chunk)) break;
    done += chunk;
  }
  return done;
}

static unsigned long long g_written, g_total;
static size_t file_write(void *opaque, mz_uint64 ofs, const void *buf, size_t n) {
  (void)ofs;
  DWORD put = 0;
  if (!WriteFile((HANDLE)opaque, buf, (DWORD)n, &put, NULL) || put != n) return 0;
  g_written += n;
  LONG pm = g_total ? (LONG)(g_written * 1000 / g_total) : 0;
  if (pm != g_permille) { g_permille = pm; if (g_wnd) PostMessageW(g_wnd, WM_APP + 1, (WPARAM)pm, 0); }
  return n;
}

// A zip entry name as a safe path inside the install folder (no "..", no drive letters).
static int safe_path(const char *name, wchar_t *out) {
  wchar_t rel[PATHMAX];
  if (!MultiByteToWideChar(CP_UTF8, 0, name, -1, rel, PATHMAX)) return 0;
  for (wchar_t *p = rel; *p; p++) if (*p == L'/') *p = L'\\';
  if (rel[0] == L'\\' || wcschr(rel, L':')) return 0;
  for (wchar_t *seg = rel; *seg;) {
    wchar_t *e = wcschr(seg, L'\\');
    size_t len = e ? (size_t)(e - seg) : wcslen(seg);
    if (len == 2 && seg[0] == L'.' && seg[1] == L'.') return 0;
    if (!e) break;
    seg = e + 1;
  }
  join(out, g_dir, rel);
  return 1;
}

static int extract_all(void) {
  mz_zip_archive za;
  ZeroMemory(&za, sizeof za);
  za.m_pRead = zip_read;
  if (!mz_zip_reader_init(&za, g_zipSize, 0)) { fail(L"The installer is damaged (its archive can't be read). Download it again."); return 0; }
  mz_uint n = mz_zip_reader_get_num_files(&za);
  g_total = 0;
  for (mz_uint i = 0; i < n; i++) { mz_zip_archive_file_stat st; if (mz_zip_reader_file_stat(&za, i, &st)) g_total += st.m_uncomp_size; }
  g_written = 0;
  int ok = 1;
  for (mz_uint i = 0; i < n && ok; i++) {
    mz_zip_archive_file_stat st;
    wchar_t path[PATHMAX];
    if (!mz_zip_reader_file_stat(&za, i, &st) || !safe_path(st.m_filename, path)) { fail(L"The installer is damaged (bad entry %u).", i); ok = 0; break; }
    if (st.m_is_directory) { make_dirs(path); continue; }
    wchar_t parent[PATHMAX];
    wcsncpy(parent, path, PATHMAX - 1);
    parent[PATHMAX - 1] = 0;
    wchar_t *s = wcsrchr(parent, L'\\');
    if (s) { *s = 0; make_dirs(parent); }
    HANDLE f = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) { fail(L"Couldn't write %s (error %lu).", path, GetLastError()); ok = 0; break; }
    if (!mz_zip_reader_extract_to_callback(&za, i, file_write, f, 0)) { fail(L"Couldn't unpack %s: %S.", path, mz_zip_get_error_string(mz_zip_get_last_error(&za))); ok = 0; }
    CloseHandle(f);
  }
  mz_zip_reader_end(&za);
  return ok;
}

// ---------------------------------------------------------------- updates
static void start_bifrost(void);

// Waits (up to a minute) until Bifrost in dir has quit.
static void wait_for_exit(const wchar_t *dir) {
  for (int i = 0; i < 600 && bifrost_running(dir); i++) Sleep(100);
}

// Moves a folder, trying for a while if something still has it open (Bifrost quitting, antivirus).
static int move_dir(const wchar_t *from, const wchar_t *to) {
  for (int i = 0; i < 100; i++) {
    if (MoveFileExW(from, to, 0)) return 1;
    Sleep(150);
  }
  return 0;
}

// The update Bifrost downloaded: resources\app.next (complete once bifrost-update.json is in it) takes the
// place of resources\app. Returns 1 if it went in, 0 if there was none, -1 if it couldn't.
static int apply_app_update(const wchar_t *build) {
  wchar_t next[PATHMAX], cur[PATHMAX], old[PATHMAX], mark[PATHMAX];
  _snwprintf(next, PATHMAX, L"%s\\resources\\app.next", build);
  _snwprintf(cur, PATHMAX, L"%s\\resources\\app", build);
  _snwprintf(old, PATHMAX, L"%s\\resources\\app.old", build);
  join(mark, next, L"bifrost-update.json");
  if (!file_exists(mark)) return 0;
  if (dir_exists(old)) remove_tree(old);
  if (!move_dir(cur, old)) return -1;
  if (!MoveFileExW(next, cur, 0)) { MoveFileExW(old, cur, 0); return -1; }
  join(mark, cur, L"bifrost-update.json");
  DeleteFileW(mark);
  remove_tree(old);
  return 1;
}

static int apply_main(void) {
  if (!g_dir[0]) {
    wcsncpy(g_dir, g_self, PATHMAX - 1);
    wchar_t *slash = wcsrchr(g_dir, L'\\');
    if (slash) *slash = 0;
  }
  wait_for_exit(g_dir);
  int r = apply_app_update(g_dir);
  if (r >= 0) {
    // Settings > Apps shows the version now in.
    wchar_t pkg[PATHMAX];
    _snwprintf(pkg, PATHMAX, L"%s\\resources\\app\\package.json", g_dir);
    HANDLE f = CreateFileW(pkg, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f != INVALID_HANDLE_VALUE) {
      char buf[8192]; DWORD n = 0;
      if (ReadFile(f, buf, sizeof buf - 1, &n, NULL)) {
        buf[n] = 0;
        char *v = strstr(buf, "\"version\"");
        if (v && (v = strchr(v + 9, '"'))) {
          char *e = strchr(++v, '"');
          if (e && e - v < 60) { *e = 0; MultiByteToWideChar(CP_UTF8, 0, v, -1, g_version, 64); reg_set(UNINSTALL_KEY, L"DisplayVersion", g_version); }
        }
      }
      CloseHandle(f);
    }
  }
  if (g_start) start_bifrost();
  return r < 0 ? 1 : 0;
}

// ---------------------------------------------------------------- install
static int do_install(void) {
  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  int ok = 0;
  wchar_t exe[PATHMAX], lnk[PATHMAX], desk[PATHMAX], v[PATHMAX];
  if (g_wait) wait_for_exit(g_dir);
  if (bifrost_running(g_dir)) { fail(L"Bifrost is running from %s. Close it, then try again.", g_dir); goto out; }
  join(exe, g_dir, EXE_NAME);
  if (dir_exists(g_dir) && !folder_is_empty(g_dir)) {
    if (!file_exists(exe)) { fail(L"%s already has other files in it. Choose an empty folder, or the folder Bifrost is installed in.", g_dir); goto out; }
    // An earlier Bifrost: replace it completely (its profile is elsewhere, in %%APPDATA%%\\Bifrost).
    if (!remove_tree(g_dir)) { if (!g_error[0]) fail(L"Couldn't replace the Bifrost that's in %s. Is it running?", g_dir); goto out; }
  }
  if (!make_dirs(g_dir)) { fail(L"Couldn't create %s (error %lu).", g_dir, GetLastError()); goto out; }
  if (!extract_all()) goto out;
  if (!file_exists(exe)) { fail(L"The installer is damaged (no Bifrost.exe in it)."); goto out; }

  // Settings > Apps entry.
  wchar_t un[PATHMAX], tmp[PATHMAX];
  join(un, g_dir, UNINSTALLER_NAME);
  reg_set(UNINSTALL_KEY, L"DisplayName", APP_NAME);
  reg_set(UNINSTALL_KEY, L"DisplayVersion", g_version);
  reg_set(UNINSTALL_KEY, L"Publisher", APP_NAME);
  _snwprintf(tmp, PATHMAX, L"%s,0", exe);
  reg_set(UNINSTALL_KEY, L"DisplayIcon", tmp);
  reg_set(UNINSTALL_KEY, L"InstallLocation", g_dir);
  _snwprintf(tmp, PATHMAX, L"\"%s\"", un);
  reg_set(UNINSTALL_KEY, L"UninstallString", tmp);
  _snwprintf(tmp, PATHMAX, L"\"%s\" /S", un);
  reg_set(UNINSTALL_KEY, L"QuietUninstallString", tmp);
  reg_set(UNINSTALL_KEY, L"Architecture", g_arch);
  reg_dword(UNINSTALL_KEY, L"NoModify", 1);
  reg_dword(UNINSTALL_KEY, L"NoRepair", 1);
  reg_dword(UNINSTALL_KEY, L"EstimatedSize", (DWORD)(g_total / 1024));
  SYSTEMTIME now;
  GetLocalTime(&now);
  _snwprintf(tmp, 16, L"%04u%02u%02u", now.wYear, now.wMonth, now.wDay);
  reg_set(UNINSTALL_KEY, L"InstallDate", tmp);
  // "bifrost" in the Run box.
  reg_set(L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Bifrost.exe", NULL, exe);
  reg_set(L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Bifrost.exe", L"Path", g_dir);
  if (g_register) register_browser(exe);

  shortcut_paths(lnk, desk);
  if (lnk[0]) make_shortcut(lnk, exe, g_dir);
  if (desk[0]) { if (g_desktop) make_shortcut(desk, exe, g_dir); }
  (void)v;
  SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
  ok = 1;
out:
  CoUninitialize();
  return ok;
}

// ---------------------------------------------------------------- uninstall
static wchar_t g_rmdirLater[PATHMAX];

static int only_uninstaller_left(const wchar_t *dir) {
  wchar_t pat[PATHMAX];
  join(pat, dir, L"*");
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(pat, &fd);
  if (h == INVALID_HANDLE_VALUE) return 0;
  int other = 0, found = 0;
  do {
    if (!wcscmp(fd.cFileName, L".") || !wcscmp(fd.cFileName, L"..")) continue;
    if (!_wcsicmp(fd.cFileName, UNINSTALLER_NAME)) found = 1; else other = 1;
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return found && !other;
}

static int do_uninstall(const wchar_t *dir) {
  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  int ok = 1;
  // Give the copy we were started from a moment to exit, and Bifrost a chance to be closed.
  for (int i = 0; i < 20 && bifrost_running(dir); i++) Sleep(250);
  if (bifrost_running(dir)) { fail(L"Bifrost is running. Close it, then try again."); CoUninitialize(); return 0; }
  wchar_t lnk[PATHMAX], desk[PATHMAX];
  shortcut_paths(lnk, desk);
  if (lnk[0]) DeleteFileW(lnk);
  if (desk[0]) DeleteFileW(desk);
  unregister_browser(dir);
  wchar_t v[PATHMAX];
  if (reg_get(UNINSTALL_KEY, L"InstallLocation", v, PATHMAX) && !_wcsicmp(v, dir)) RegDeleteTreeW(HKEY_CURRENT_USER, UNINSTALL_KEY);
  if (reg_get(L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Bifrost.exe", L"Path", v, PATHMAX) && !_wcsicmp(v, dir))
    RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Bifrost.exe");
  // The uninstaller copy in the folder may still be closing; try a few times.
  for (int i = 0; i < 10; i++) { if (remove_tree(dir) || !dir_exists(dir)) break; if (only_uninstaller_left(dir)) break; Sleep(300); }
  // A silent uninstall waits for us from the uninstaller in the folder, so that one file stays until
  // it exits; it goes right after (see delete_self_later).
  if (dir_exists(dir) && only_uninstaller_left(dir)) { wcsncpy(g_rmdirLater, dir, PATHMAX - 1); g_error[0] = 0; }
  else if (dir_exists(dir)) ok = 0;
  if (g_removeData) {
    wchar_t ad[PATHMAX], data[PATHMAX];
    if (known_folder(&FOLDERID_RoamingAppData, ad)) { join(data, ad, L"Bifrost"); if (dir_exists(data)) remove_tree(data); }
  }
  SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
  CoUninitialize();
  if (!ok && !g_error[0]) fail(L"Some files in %s couldn't be removed. Delete the folder yourself.", dir);
  return ok;
}

// Deletes this temporary copy of the uninstaller once it has exited.
static void delete_self_later(void) {
  wchar_t cmd[PATHMAX], sys[MAX_PATH];
  GetSystemDirectoryW(sys, MAX_PATH);
  if (g_rmdirLater[0]) _snwprintf(cmd, PATHMAX, L"\"%s\\cmd.exe\" /c ping -n 4 127.0.0.1 >nul & rmdir /s /q \"%s\" & del /f /q \"%s\"", sys, g_rmdirLater, g_self);
  else _snwprintf(cmd, PATHMAX, L"\"%s\\cmd.exe\" /c ping -n 3 127.0.0.1 >nul & del /f /q \"%s\"", sys, g_self);
  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof si);
  si.cb = sizeof si;
  if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); }
}

// ---------------------------------------------------------------- UI
enum { ID_PATH = 100, ID_BROWSE, ID_DESKTOP, ID_REGISTER, ID_START, ID_INSTALL, ID_CANCEL, ID_PROGRESS, ID_STATUS, ID_DEFAULTAPPS };
static HWND h_title, h_sub, h_pathLabel, h_path, h_browse, h_desktop, h_register, h_start, h_note, h_progress, h_status, h_install, h_cancel, h_defapps, h_icon;
static HFONT f_ui, f_title;
static int g_dpi = 96, g_phase;     // 0 options, 1 installing, 2 done, 3 failed
static HBRUSH g_bg;
#define S(x) MulDiv((x), g_dpi, 96)

static HWND mk(const wchar_t *cls, const wchar_t *text, DWORD style, int x, int y, int w, int h, int id, HFONT font) {
  HWND c = CreateWindowExW(0, cls, text, WS_CHILD | WS_VISIBLE | style, S(x), S(y), S(w), S(h), g_wnd, (HMENU)(INT_PTR)id, GetModuleHandleW(NULL), NULL);
  SendMessageW(c, WM_SETFONT, (WPARAM)font, TRUE);
  return c;
}

static void set_check(HWND h, int on) { SendMessageW(h, BM_SETCHECK, on ? BST_CHECKED : BST_UNCHECKED, 0); }
static int get_check(HWND h) { return SendMessageW(h, BM_GETCHECK, 0, 0) == BST_CHECKED; }

static void browse(void) {
  IFileOpenDialog *d = NULL;
  if (FAILED(CoCreateInstance(&CLSID_FileOpenDialog, NULL, CLSCTX_INPROC_SERVER, &IID_IFileOpenDialog, (void **)&d))) return;
  DWORD o = 0;
  IFileOpenDialog_GetOptions(d, &o);
  IFileOpenDialog_SetOptions(d, o | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
  IFileOpenDialog_SetTitle(d, L"Where should Bifrost go?");
  if (SUCCEEDED(IFileOpenDialog_Show(d, g_wnd))) {
    IShellItem *it = NULL;
    if (SUCCEEDED(IFileOpenDialog_GetResult(d, &it))) {
      PWSTR p = NULL;
      if (SUCCEEDED(IShellItem_GetDisplayName(it, SIGDN_FILESYSPATH, &p))) {
        wchar_t out[PATHMAX];
        const wchar_t *leaf = wcsrchr(p, L'\\');
        // Like other installers: a folder you pick gets a Bifrost folder inside it.
        if (leaf && !_wcsicmp(leaf + 1, L"Bifrost")) wcsncpy(out, p, PATHMAX - 1);
        else join(out, p, L"Bifrost");
        out[PATHMAX - 1] = 0;
        SetWindowTextW(h_path, out);
        CoTaskMemFree(p);
      }
      IShellItem_Release(it);
    }
  }
  IFileOpenDialog_Release(d);
}

static DWORD WINAPI worker(LPVOID arg) {
  (void)arg;
  int ok = do_install();
  PostMessageW(g_wnd, WM_APP + 2, ok, 0);
  return 0;
}

static void show_phase(int phase) {
  g_phase = phase;
  int opts = phase == 0;
  HWND optCtl[] = { h_pathLabel, h_path, h_browse, h_desktop, h_register, h_start, h_note };
  for (int i = 0; i < 7; i++) ShowWindow(optCtl[i], opts ? SW_SHOW : SW_HIDE);
  ShowWindow(h_progress, phase == 1 ? SW_SHOW : SW_HIDE);
  ShowWindow(h_status, phase >= 1 ? SW_SHOW : SW_HIDE);
  ShowWindow(h_defapps, phase == 2 && g_register ? SW_SHOW : SW_HIDE);
  // Finished (or failed): the message moves up into the space the progress bar used.
  SetWindowPos(h_status, NULL, S(28), S(phase >= 2 ? 112 : 160), S(504), S(phase >= 2 ? 80 : 120), SWP_NOZORDER);
  SetWindowPos(h_defapps, NULL, S(28), S(184), S(504), S(22), SWP_NOZORDER);
  wchar_t t[256];
  if (phase == 0) {
    SetWindowTextW(h_title, L"Install Bifrost");
    SetWindowTextW(h_install, L"Install");
    ShowWindow(h_cancel, SW_SHOW);
  } else if (phase == 1) {
    SetWindowTextW(h_title, L"Installing Bifrost\x2026");
    SetWindowTextW(h_status, L"Unpacking\x2026");
    EnableWindow(h_install, FALSE);
    EnableWindow(h_cancel, FALSE);
  } else if (phase == 2) {
    SetWindowTextW(h_title, L"Bifrost is installed");
    _snwprintf(t, 256, L"Find it in the Start menu. Your bookmarks and settings live in %%APPDATA%%\\Bifrost, so updates and reinstalls keep them.");
    SetWindowTextW(h_status, t);
    SetWindowTextW(h_install, L"Finish");
    EnableWindow(h_install, TRUE);
    ShowWindow(h_cancel, SW_HIDE);
  } else {
    SetWindowTextW(h_title, L"Bifrost wasn't installed");
    SetWindowTextW(h_status, g_error);
    SetWindowTextW(h_install, L"Try again");
    EnableWindow(h_install, TRUE);
    EnableWindow(h_cancel, TRUE);
    ShowWindow(h_cancel, SW_SHOW);
    SetWindowTextW(h_cancel, L"Close");
  }
}

static void start_bifrost(void) {
  wchar_t exe[PATHMAX];
  join(exe, g_dir, EXE_NAME);
  ShellExecuteW(NULL, L"open", exe, NULL, g_dir, SW_SHOWNORMAL);
}

static LRESULT CALLBACK wndproc(HWND w, UINT m, WPARAM wp, LPARAM lp) {
  switch (m) {
  case WM_CTLCOLORSTATIC: {
    HDC dc = (HDC)wp;
    SetBkColor(dc, GetSysColor(COLOR_WINDOW));
    SetTextColor(dc, (HWND)lp == h_note ? RGB(96, 96, 108) : GetSysColor(COLOR_WINDOWTEXT));
    return (LRESULT)g_bg;
  }
  case WM_COMMAND:
    switch (LOWORD(wp)) {
    case ID_BROWSE: browse(); return 0;
    case ID_CANCEL: DestroyWindow(w); return 0;
    case ID_INSTALL:
      if (g_phase == 2) {
        if (get_check(h_defapps)) ShellExecuteW(NULL, L"open", L"ms-settings:defaultapps?registeredAppUser=Bifrost", NULL, NULL, SW_SHOWNORMAL);
        if (g_start) start_bifrost();
        DestroyWindow(w);
        return 0;
      }
      GetWindowTextW(h_path, g_dir, PATHMAX);
      while (wcslen(g_dir) > 3 && g_dir[wcslen(g_dir) - 1] == L'\\') g_dir[wcslen(g_dir) - 1] = 0;
      if (wcslen(g_dir) < 4 || g_dir[1] != L':' || g_dir[2] != L'\\') {
        if (!(g_dir[0] == L'\\' && g_dir[1] == L'\\')) { MessageBoxW(w, L"Enter a full folder path, like C:\\Users\\you\\AppData\\Local\\Programs\\Bifrost.", L"Bifrost Setup", MB_ICONWARNING); return 0; }
      }
      g_desktop = get_check(h_desktop);
      g_register = get_check(h_register);
      g_start = get_check(h_start);
      g_error[0] = 0;
      show_phase(1);
      CloseHandle(CreateThread(NULL, 0, worker, NULL, 0, NULL));
      return 0;
    }
    break;
  case WM_APP + 1:
    SendMessageW(h_progress, PBM_SETPOS, wp, 0);
    return 0;
  case WM_APP + 2:
    SendMessageW(h_progress, PBM_SETPOS, 1000, 0);
    show_phase(wp ? 2 : 3);
    return 0;
  case WM_CLOSE:
    if (g_phase == 1) return 0;
    DestroyWindow(w);
    return 0;
  case WM_DESTROY:
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(w, m, wp, lp);
}

static int run_ui(void) {
  INITCOMMONCONTROLSEX icc = { sizeof icc, ICC_PROGRESS_CLASS | ICC_STANDARD_CLASSES };
  InitCommonControlsEx(&icc);
  HDC sdc = GetDC(NULL);
  g_dpi = GetDeviceCaps(sdc, LOGPIXELSY);
  ReleaseDC(NULL, sdc);
  NONCLIENTMETRICSW ncm;
  ZeroMemory(&ncm, sizeof ncm);
  ncm.cbSize = sizeof ncm;
  SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof ncm, &ncm, 0);
  f_ui = CreateFontIndirectW(&ncm.lfMessageFont);
  LOGFONTW lf = ncm.lfMessageFont;
  lf.lfHeight = -S(22);
  lf.lfWeight = FW_SEMIBOLD;
  wcscpy(lf.lfFaceName, L"Segoe UI");
  f_title = CreateFontIndirectW(&lf);
  g_bg = GetSysColorBrush(COLOR_WINDOW);

  HINSTANCE inst = GetModuleHandleW(NULL);
  WNDCLASSEXW wc;
  ZeroMemory(&wc, sizeof wc);
  wc.cbSize = sizeof wc;
  wc.lpfnWndProc = wndproc;
  wc.hInstance = inst;
  wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
  wc.hIconSm = (HICON)LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
  wc.hCursor = LoadCursorW(NULL, (LPCWSTR)IDC_ARROW);
  wc.hbrBackground = g_bg;
  wc.lpszClassName = L"BifrostSetup";
  RegisterClassExW(&wc);
  wchar_t title[128];
  _snwprintf(title, 128, L"Bifrost %s Setup (%s)", g_version, g_arch);
  RECT r = { 0, 0, S(560), S(372) };
  DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
  AdjustWindowRect(&r, style, FALSE);
  int ww = r.right - r.left, wh = r.bottom - r.top;
  g_wnd = CreateWindowExW(0, wc.lpszClassName, title, style, (GetSystemMetrics(SM_CXSCREEN) - ww) / 2, (GetSystemMetrics(SM_CYSCREEN) - wh) / 2, ww, wh, NULL, NULL, inst, NULL);

  h_icon = mk(L"STATIC", NULL, SS_ICON | SS_REALSIZECONTROL, 28, 26, 56, 56, 0, f_ui);
  SendMessageW(h_icon, STM_SETICON, (WPARAM)LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, S(56), S(56), 0), 0);
  h_title = mk(L"STATIC", L"Install Bifrost", SS_LEFT, 100, 26, 430, 32, 0, f_title);
  wchar_t sub[160];
  _snwprintf(sub, 160, L"Version %s for %s Windows. A fast, customizable browser.", g_version, !_wcsicmp(g_arch, L"arm64") ? L"ARM64" : L"x64");
  h_sub = mk(L"STATIC", sub, SS_LEFT, 100, 60, 430, 22, 0, f_ui);
  h_pathLabel = mk(L"STATIC", L"Install to:", SS_LEFT, 28, 104, 500, 20, 0, f_ui);
  h_path = mk(L"EDIT", g_dir, WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL, 28, 126, 400, 26, ID_PATH, f_ui);
  h_browse = mk(L"BUTTON", L"Browse\x2026", WS_TABSTOP | BS_PUSHBUTTON, 438, 125, 94, 28, ID_BROWSE, f_ui);
  h_desktop = mk(L"BUTTON", L"Put a shortcut on the desktop", WS_TABSTOP | BS_AUTOCHECKBOX, 28, 168, 500, 22, ID_DESKTOP, f_ui);
  h_register = mk(L"BUTTON", L"Let Windows offer Bifrost as a browser (needed to make it your default)", WS_TABSTOP | BS_AUTOCHECKBOX, 28, 194, 504, 22, ID_REGISTER, f_ui);
  h_start = mk(L"BUTTON", L"Start Bifrost when setup finishes", WS_TABSTOP | BS_AUTOCHECKBOX, 28, 220, 500, 22, ID_START, f_ui);
  h_note = mk(L"STATIC", L"Installs for you only: no administrator rights needed. Your bookmarks, history and settings are kept in %APPDATA%\\Bifrost.", SS_LEFT, 28, 256, 504, 40, 0, f_ui);
  h_progress = mk(PROGRESS_CLASSW, NULL, 0, 28, 130, 504, 18, ID_PROGRESS, f_ui);
  SendMessageW(h_progress, PBM_SETRANGE32, 0, 1000);
  h_status = mk(L"STATIC", L"", SS_LEFT, 28, 160, 504, 120, ID_STATUS, f_ui);
  h_defapps = mk(L"BUTTON", L"Open Default apps to make Bifrost my default browser", WS_TABSTOP | BS_AUTOCHECKBOX, 28, 230, 504, 22, ID_DEFAULTAPPS, f_ui);
  h_cancel = mk(L"BUTTON", L"Cancel", WS_TABSTOP | BS_PUSHBUTTON, 332, 322, 96, 30, ID_CANCEL, f_ui);
  h_install = mk(L"BUTTON", L"Install", WS_TABSTOP | BS_DEFPUSHBUTTON, 436, 322, 96, 30, ID_INSTALL, f_ui);
  set_check(h_register, 1);
  set_check(h_start, 1);
  show_phase(0);
  ShowWindow(g_wnd, SW_SHOW);
  SetFocus(h_install);
  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) {
    if (!IsDialogMessageW(g_wnd, &msg)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  }
  return g_phase == 2 ? 0 : 1;
}

// The uninstaller's question: remove Bifrost, and optionally its data.
static int confirm_uninstall(void) {
  TASKDIALOGCONFIG tc;
  ZeroMemory(&tc, sizeof tc);
  tc.cbSize = sizeof tc;
  tc.dwFlags = TDF_ALLOW_DIALOG_CANCELLATION | TDF_POSITION_RELATIVE_TO_WINDOW;
  tc.pszWindowTitle = L"Uninstall Bifrost";
  tc.hInstance = GetModuleHandleW(NULL);
  tc.pszMainIcon = MAKEINTRESOURCEW(1);
  tc.dwFlags |= TDF_USE_HICON_MAIN;
  tc.hMainIcon = (HICON)LoadImageW(GetModuleHandleW(NULL), MAKEINTRESOURCEW(1), IMAGE_ICON, 32, 32, 0);
  tc.pszMainInstruction = L"Remove Bifrost from this computer?";
  tc.pszContent = L"Bifrost's program files, its Start menu shortcut and its browser registration will be removed.";
  tc.pszVerificationText = L"Also delete my Bifrost data (bookmarks, history, settings, extensions)";
  TASKDIALOG_BUTTON b[1] = { { IDOK, L"Uninstall" } };
  tc.cButtons = 1;
  tc.pButtons = b;
  tc.dwCommonButtons = TDCBF_CANCEL_BUTTON;
  int button = 0;
  BOOL verify = FALSE;
  if (FAILED(TaskDialogIndirect(&tc, &button, NULL, &verify))) {
    button = MessageBoxW(NULL, L"Remove Bifrost from this computer? Your bookmarks and settings in %APPDATA%\\Bifrost are kept.", L"Uninstall Bifrost", MB_OKCANCEL | MB_ICONQUESTION);
  }
  g_removeData = verify;
  return button == IDOK;
}

// ---------------------------------------------------------------- main
static void parse_args(void) {
  int argc = 0;
  LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  for (int i = 1; i < argc; i++) {
    const wchar_t *a = argv[i];
    if (!_wcsicmp(a, L"/S") || !_wcsicmp(a, L"/silent")) g_silent = 1;
    else if (!_wcsicmp(a, L"/desktop")) g_desktop = 1;
    else if (!_wcsicmp(a, L"/noregister")) g_register = 0;
    else if (!_wcsicmp(a, L"/start")) g_start = 1;
    else if (!_wcsicmp(a, L"/wait")) g_wait = 1;
    else if (!_wcsicmp(a, L"/apply")) g_apply = 1;
    else if (!_wcsicmp(a, L"/removedata")) g_removeData = 1;
    else if (!_wcsicmp(a, L"/uninstall")) g_uninstall = 1;
    else if (!_wcsnicmp(a, L"/uninstall-from=", 16)) { g_uninstall = 2; wcsncpy(g_uninstallFrom, a + 16, PATHMAX - 1); }
  }
  LocalFree(argv);
  // /D= takes the rest of the line, spaces and all (as NSIS does).
  const wchar_t *d = wcsstr(GetCommandLineW(), L"/D=");
  if (d) { wcsncpy(g_dir, d + 3, PATHMAX - 1); g_dir[PATHMAX - 1] = 0; size_t n = wcslen(g_dir); while (n && (g_dir[n - 1] == L' ' || g_dir[n - 1] == L'"' || g_dir[n - 1] == L'\\')) g_dir[--n] = 0; if (g_dir[0] == L'"') memmove(g_dir, g_dir + 1, n * sizeof(wchar_t)); }
}

static int uninstall_main(void) {
  wchar_t dir[PATHMAX];
  if (g_uninstall != 2) {
    // Started from the install folder: run from a temporary copy so the folder can be deleted.
    wcsncpy(dir, g_self, PATHMAX - 1);
    dir[PATHMAX - 1] = 0;
    wchar_t *s = wcsrchr(dir, L'\\');
    if (s) *s = 0;
    wchar_t tmpDir[MAX_PATH], copy[PATHMAX], cmd[PATHMAX];
    GetTempPathW(MAX_PATH, tmpDir);
    _snwprintf(copy, PATHMAX, L"%sBifrost-uninstall-%lu.exe", tmpDir, GetCurrentProcessId());
    if (!CopyFileW(g_self, copy, FALSE)) { if (!g_silent) MessageBoxW(NULL, L"The uninstaller couldn't start.", L"Uninstall Bifrost", MB_ICONERROR); return 1; }
    _snwprintf(cmd, PATHMAX, L"\"%s\" \"/uninstall-from=%s\"%s%s", copy, dir, g_silent ? L" /S" : L"", g_removeData ? L" /removedata" : L"");
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof si);
    si.cb = sizeof si;
    if (!CreateProcessW(copy, cmd, NULL, NULL, FALSE, 0, NULL, tmpDir, &si, &pi)) return 1;
    // Silent uninstalls (Settings > Apps, scripts) expect us to finish the job before exiting.
    if (g_silent) { WaitForSingleObject(pi.hProcess, INFINITE); DWORD code = 1; GetExitCodeProcess(pi.hProcess, &code); CloseHandle(pi.hProcess); CloseHandle(pi.hThread); return (int)code; }
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return 0;
  }
  wcsncpy(dir, g_uninstallFrom, PATHMAX - 1);
  dir[PATHMAX - 1] = 0;
  wchar_t check[PATHMAX];
  join(check, dir, EXE_NAME);
  int code = 0;
  if (!file_exists(check) && !dir_exists(dir)) { if (!g_silent) MessageBoxW(NULL, L"Bifrost isn't installed there any more.", L"Uninstall Bifrost", MB_ICONINFORMATION); }
  else if (g_silent || confirm_uninstall()) {
    if (do_uninstall(dir)) { if (!g_silent) MessageBoxW(NULL, L"Bifrost was removed.", L"Uninstall Bifrost", MB_ICONINFORMATION); }
    else { code = 1; if (!g_silent) MessageBoxW(NULL, g_error, L"Uninstall Bifrost", MB_ICONWARNING); }
  } else code = 2;
  delete_self_later();
  return code;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmdline, int show) {
  (void)inst; (void)prev; (void)cmdline; (void)show;
  GetModuleFileNameW(NULL, g_self, PATHMAX);
  parse_args();
  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  int has_payload = g_apply ? 0 : open_payload();
  int code;
  if (g_apply) {
    code = apply_main();
  } else if (g_uninstall || !has_payload) {
    code = uninstall_main();
  } else {
    if (!g_dir[0]) {
      // Update an existing install where it is; otherwise %LOCALAPPDATA%\Programs\Bifrost.
      wchar_t prevDir[PATHMAX], la[PATHMAX];
      if (reg_get(UNINSTALL_KEY, L"InstallLocation", prevDir, PATHMAX) && prevDir[0] && dir_exists(prevDir)) wcsncpy(g_dir, prevDir, PATHMAX - 1);
      else if (known_folder(&FOLDERID_LocalAppData, la)) _snwprintf(g_dir, PATHMAX, L"%s\\Programs\\Bifrost", la);
    }
    if (g_silent) {
      code = do_install() ? 0 : 1;
      if (code == 0 && g_start) start_bifrost();
      if (code) { HANDLE e = GetStdHandle(STD_ERROR_HANDLE); if (e && e != INVALID_HANDLE_VALUE) { char buf[4096]; int n = WideCharToMultiByte(CP_UTF8, 0, g_error, -1, buf, 4096, NULL, NULL); DWORD w; if (n > 1) WriteFile(e, buf, n - 1, &w, NULL); } }
    } else {
      code = run_ui();
    }
  }
  if (g_selfFile != INVALID_HANDLE_VALUE) CloseHandle(g_selfFile);
  CoUninitialize();
  return code;
}
