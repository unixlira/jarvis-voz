# Jarvis Voz (Windows): inicia el servidor local si no está corriendo y abre la página.
param([switch]$SinAbrir)
$ErrorActionPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot
$puerto = 8787
$linea = Get-Content .env | Where-Object { $_ -match '^PUERTO=' } | Select-Object -First 1
if ($linea) { $puerto = [int]($linea -replace '^PUERTO=','').Trim('" ') }
$node = 'node'
if (Test-Path "$PSScriptRoot\node\node.exe") { $node = "$PSScriptRoot\node\node.exe" }
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ";$env:USERPROFILE\.local\bin"
function Vivo { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$puerto/salud").StatusCode -eq 200 } catch { $false } }
if (-not (Vivo)) {
  New-Item -ItemType Directory -Force datos | Out-Null
  Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput "datos\servidor.log" -RedirectStandardError "datos\servidor-error.log"
  for ($i = 0; $i -lt 40 -and -not (Vivo); $i++) { Start-Sleep -Milliseconds 500 }
}
if ($SinAbrir) { exit 0 }
$url = (& $node server.mjs --enlace).Trim()
$navegadores = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$nav = $navegadores | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($nav) { Start-Process -FilePath $nav -ArgumentList "--app=$url", '--window-size=1600,900' } else { Start-Process $url }
