# EasyVideo - Windows tray host.
#
# Runs a NotifyIcon in a hidden WinForms message loop and speaks a line protocol
# on stdout / stdin so the Node server can own the icon without a native module.
#
#   stdout: READY | CLICK | MENU <id> | DOUBLE | QUIT
#   stdin : TITLE <text> | TIP <text> | ICON <png-path> | STATE idle|live|offline|error | EXIT
param(
  [Parameter(Mandatory = $true)][string]$IconPath,
  [string]$Title = 'EasyVideo',
  [string]$Tip = 'EasyVideo - 流式直播与视频'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

function Load-Icon([string]$p) {
  try {
    $bmp = [System.Drawing.Bitmap]::FromFile($p)
    $ico = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    return $ico
  } catch { return [System.Drawing.SystemIcons]::Application }
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = Load-Icon $IconPath
$notify.Text = $Tip
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$items = @(
  @{ id = 'open';     text = '打开 EasyVideo' },
  @{ id = 'live';     text = '打开直播页' },
  @{ id = 'video';    text = '打开视频页' },
  @{ id = 'sep1';     text = '-' },
  @{ id = 'copyurl';  text = '复制本机地址' },
  @{ id = 'logs';     text = '打开日志目录' },
  @{ id = 'data';     text = '打开数据目录' },
  @{ id = 'sep2';     text = '-' },
  @{ id = 'quit';     text = '退出 EasyVideo' }
)
foreach ($it in $items) {
  if ($it.text -eq '-') { [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)); continue }
  $entry = New-Object System.Windows.Forms.ToolStripMenuItem
  $entry.Text = $it.text
  $entry.Tag = $it.id
  $entry.add_Click({ param($s, $e) [Console]::Out.WriteLine('MENU ' + $s.Tag); [Console]::Out.Flush() })
  [void]$menu.Items.Add($entry)
}
$notify.ContextMenuStrip = $menu

$notify.add_MouseClick({
  param($s, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    [Console]::Out.WriteLine('CLICK'); [Console]::Out.Flush()
  }
})
$notify.add_DoubleClick({ [Console]::Out.WriteLine('DOUBLE'); [Console]::Out.Flush() })

$script:alive = $true

# Poll stdin for commands on a background runspace-free timer.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150
$timer.add_Tick({
  try {
    while ([Console]::In.Peek() -ne -1) {
      $line = [Console]::In.ReadLine()
      if ($null -eq $line) { continue }
      $line = $line.Trim()
      if ($line -eq '') { continue }
      if ($line -eq 'EXIT') { $script:alive = $false; [System.Windows.Forms.Application]::ExitThread(); return }
      if ($line.StartsWith('TIP ')) { $notify.Text = $line.Substring(4); continue }
      if ($line.StartsWith('ICON ')) {
        $p = $line.Substring(5)
        if (Test-Path $p) { $notify.Icon = Load-Icon $p }
        continue
      }
      if ($line.StartsWith('TITLE ')) { $menu.Items[0].Text = '打开 ' + $line.Substring(6); continue }
      if ($line.StartsWith('BALLOON ')) {
        $parts = $line.Substring(8).Split('|', 2)
        $notify.BalloonTipTitle = $Title
        $notify.BalloonTipText = $parts[0]
        $notify.ShowBalloonTip(4000)
        continue
      }
    }
  } catch { }
})
$timer.Start()

[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

[System.Windows.Forms.Application]::Run()

$timer.Stop()
$notify.Visible = $false
$notify.Dispose()
[Console]::Out.WriteLine('QUIT')
