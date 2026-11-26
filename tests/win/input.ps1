# Real mouse input on Windows for tests/win/cursor-check.mjs, and the pointer as Windows shows it: one command a
# line on stdin, one answer a line on stdout. Coordinates are the screen's pixels.
#   move X Y     the pointer to X, Y (SendInput, absolute: as a mouse moves it)
#   nudge DX DY  the pointer by DX, DY (SendInput, relative; 0 0 is a move that goes nowhere)
#   click        the left button down and up where the pointer is
#   setpos X Y   SetCursorPos
#   cursor       {flags, h, shape (none, arrow, hand, ibeam, other), x, y, under (class of the window there), top}
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinInput {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
  [DllImport("user32.dll", SetLastError = true)] public static extern bool GetCursorInfo(ref CURSORINFO ci);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, IntPtr id);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  static uint Send(int dx, int dy, uint flags) {
    var i = new INPUT[1];
    i[0].type = 0; i[0].mi.dx = dx; i[0].mi.dy = dy; i[0].mi.dwFlags = flags;
    return SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static string Move(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    int ax = (int)Math.Round((x - vx) * 65535.0 / (vw - 1)), ay = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
    return "sent " + Send(ax, ay, 0x0001 | 0x8000 | 0x4000);
  }
  public static string Nudge(int dx, int dy) { return "sent " + Send(dx, dy, 0x0001); }
  public static string Click() { return "sent " + (Send(0, 0, 0x0002) + Send(0, 0, 0x0004)); }
  public static string SetPos(int x, int y) { return SetCursorPos(x, y) ? "ok" : "failed"; }
  static long Sys(int id) { return LoadCursor(IntPtr.Zero, (IntPtr)id).ToInt64(); }
  public static string Cursor() {
    var ci = new CURSORINFO();
    ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
    if (!GetCursorInfo(ref ci)) return "{\"error\":" + Marshal.GetLastWin32Error() + "}";
    long h = ci.hCursor.ToInt64();
    string shape = h == 0 ? "none" : h == Sys(32512) ? "arrow" : h == Sys(32649) ? "hand" : h == Sys(32513) ? "ibeam" : "other";
    var w = WindowFromPoint(ci.pt);
    return "{\"flags\":" + ci.flags + ",\"h\":" + h + ",\"shape\":\"" + shape + "\",\"x\":" + ci.pt.X + ",\"y\":" + ci.pt.Y
      + ",\"under\":\"" + Cls(w) + "\",\"top\":\"" + Cls(GetAncestor(w, 2)) + "\",\"screen\":\"" + GetSystemMetrics(0) + "x" + GetSystemMetrics(1) + "\"}";
  }
}
'@
[WinInput]::SetProcessDPIAware() | Out-Null
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $a = $line.Trim().Split(' ')
  try {
    switch ($a[0]) {
      'move' { $r = [WinInput]::Move([int]$a[1], [int]$a[2]) }
      'nudge' { $r = [WinInput]::Nudge([int]$a[1], [int]$a[2]) }
      'click' { $r = [WinInput]::Click() }
      'setpos' { $r = [WinInput]::SetPos([int]$a[1], [int]$a[2]) }
      'cursor' { $r = [WinInput]::Cursor() }
      default { $r = 'unknown ' + $a[0] }
    }
  } catch { $r = 'error ' + $_.Exception.Message }
  [Console]::Out.WriteLine($r)
  [Console]::Out.Flush()
}
