# Desinstalador de Jarvis Voz para Windows.
# Quita el programa, el acceso directo y el inicio automático. No desinstala Node.js,
# Git ni Claude Code (puedes usarlos para otras cosas). Te pregunta antes de borrar tus entregas.
param([string]$Carpeta = "$env:USERPROFILE\JarvisVoz", [switch]$BorrarTodo)
$ErrorActionPreference = 'SilentlyContinue'
Write-Host "Desinstalando Jarvis Voz de $Carpeta" -ForegroundColor Magenta
$puerto = 8787
$l = Get-Content "$Carpeta\.env" | Where-Object { $_ -match '^PUERTO=\d+' } | Select-Object -First 1
if ($l) { $puerto = [int]($l -replace '^PUERTO=','') }
$llave = ((Get-Content "$Carpeta\.env" | Where-Object { $_ -match '^LLAVE_LOCAL=' } | Select-Object -First 1) -replace '^LLAVE_LOCAL=','').Trim('" ')
try { Invoke-WebRequest -UseBasicParsing -Method Post -TimeoutSec 3 "http://127.0.0.1:$puerto/apagar?llave=$llave" | Out-Null; Start-Sleep -Seconds 1 } catch {}
Write-Host "  OK  servidor detenido" -ForegroundColor Green
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Jarvis Voz.lnk') -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'Jarvis Voz (servidor).lnk') -Force
Write-Host "  OK  accesos directos quitados" -ForegroundColor Green
$borrar = $BorrarTodo
if (-not $BorrarTodo -and (Test-Path "$Carpeta\espacio")) {
  $r = Read-Host '  ¿Borrar también tus entregas, memoria y conversaciones? (s/N)'
  $borrar = $r -match '^[sSyY]'
}
if ($borrar) { Remove-Item $Carpeta -Recurse -Force; Write-Host "  OK  carpeta borrada" -ForegroundColor Green }
else {
  Get-ChildItem $Carpeta | Where-Object { $_.Name -notin @('espacio', 'datos') } | Remove-Item -Recurse -Force
  Write-Host "  OK  programa borrado; tus entregas y memoria quedaron en $Carpeta\espacio" -ForegroundColor Green
}
Write-Host "Listo."
