param([string]$InstallRoot = 'D:\造世界编辑器', [int]$Port = 49221)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid local debugging port' }
$executable = Join-Path $InstallRoot '造世界编辑器.exe'
$running = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $executable -and $_.CommandLine -notmatch '--type=' }
if ($running) {
  if ($running.CommandLine -match "--remote-debugging-port=$Port(?:\s|$)") { Write-Output 'Editor already started with the requested local connection.'; exit 0 }
  throw 'Save your scene and exit all editor windows first, then rerun this script. Existing processes are never killed.'
}
# This is an interactive editor window the user needs to view, not a background helper.
Start-Process -FilePath $executable -ArgumentList '--remote-debugging-address=127.0.0.1', "--remote-debugging-port=$Port"
Write-Output "Editor started. Open a project to connect MCP at http://127.0.0.1:$Port"
