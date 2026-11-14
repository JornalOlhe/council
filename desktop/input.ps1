# IA Council — controle de mouse e teclado no Windows (lê um comando por linha, responde OK/ERR)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class IACIn {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  public static void Click(string b, int n) {
    uint dn = 2, up = 4;
    if (b == "right") { dn = 8; up = 16; }
    for (int i = 0; i < n; i++) { mouse_event(dn, 0, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(30); mouse_event(up, 0, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(70); }
  }
  public static void Down() { mouse_event(2, 0, 0, 0, UIntPtr.Zero); }
  public static void Up() { mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
  public static void Wheel(int d) { mouse_event(0x0800, 0, 0, d, UIntPtr.Zero); }
  static bool Ext(byte vk) { return vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 || vk == 0x2D || vk == 0x2E || vk == 0x21 || vk == 0x22 || vk == 0x23 || vk == 0x24 || vk == 0x5B; }
  public static void Key(byte vk, bool down) { uint f = down ? 0u : 2u; if (Ext(vk)) f |= 1u; keybd_event(vk, 0, f, UIntPtr.Zero); }
}
"@
[IACIn]::SetProcessDPIAware() | Out-Null
[Console]::Out.WriteLine("READY " + [IACIn]::GetSystemMetrics(0) + " " + [IACIn]::GetSystemMetrics(1))
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $out = "OK"
  try {
    $p = $line.Trim().Split(" ")
    switch ($p[0]) {
      "size"  { $out = "OK " + [IACIn]::GetSystemMetrics(0) + " " + [IACIn]::GetSystemMetrics(1) }
      "move"  { [IACIn]::SetCursorPos([int]$p[1], [int]$p[2]) | Out-Null }
      "click" { [IACIn]::Click($p[1], [int]$p[2]) }
      "down"  { [IACIn]::Down() }
      "up"    { [IACIn]::Up() }
      "wheel" { [IACIn]::Wheel([int]$p[1]) }
      "key"   {
        $ks = $p[1].Split("+")
        foreach ($k in $ks) { [IACIn]::Key([byte][int]$k, $true); Start-Sleep -Milliseconds 20 }
        [array]::Reverse($ks)
        foreach ($k in $ks) { [IACIn]::Key([byte][int]$k, $false); Start-Sleep -Milliseconds 20 }
      }
      default { throw "comando desconhecido: " + $p[0] }
    }
  } catch { $out = "ERR " + $_.Exception.Message.Replace("`r", " ").Replace("`n", " ") }
  [Console]::Out.WriteLine($out)
}
