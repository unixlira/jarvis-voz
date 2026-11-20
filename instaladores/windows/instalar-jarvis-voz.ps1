# Instalador de Jarvis Voz para Windows 10/11.
# Se puede correr varias veces: no borra tu configuración, tu memoria ni tus entregas.
#
# Lo que hace, en orden:
#   1) Node.js (para el servidor local)      -> winget, o copia portátil si no hay winget
#   2) Git para Windows (recomendado)          -> winget
#   3) Claude Code (método oficial) y te pide entrar en tu cuenta de Claude (se abre el navegador)
#   4) Te pide la clave de Gemini (para la voz), con el enlace para crearla gratis
#   5) Baja la última versión de Jarvis Voz desde GitHub, configura todo,
#      crea el acceso directo "Jarvis Voz" en el escritorio, prueba y abre la página.
param(
  [string]$Carpeta = "$env:USERPROFILE\JarvisVoz",
  [string]$Repo = 'unixlira/jarvis-voz',
  [string]$Zip = '',            # para pruebas: usar un zip local en vez de bajar de GitHub
  [switch]$SinClaude,           # no instalar ni pedir Claude Code (usarás Codex o Gemini CLI)
  [switch]$SinPreguntas         # pruebas automáticas: no abre navegador ni hace preguntas
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

function Paso($n, $texto) { Write-Host ""; Write-Host "[$n/6] $texto" -ForegroundColor Magenta }
function Ok($texto) { Write-Host "  OK  $texto" -ForegroundColor Green }
function Info($texto) { Write-Host "  ... $texto" -ForegroundColor Gray }
function Aviso($texto) { Write-Host "  !   $texto" -ForegroundColor Yellow }
function Falla($texto) { Write-Host ""; Write-Host "  X   $texto" -ForegroundColor Red; Write-Host ""; if (-not $SinPreguntas) { Read-Host "Presiona Enter para cerrar" | Out-Null }; exit 1 }
function RefrescarPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ";$env:USERPROFILE\.local\bin" }
function Tiene($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Winget($id) {
  if (-not (Tiene winget)) { return $false }
  Info "winget install $id (puede tardar unos minutos)..."
  & winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements --scope user 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { & winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null }
  RefrescarPath
  return $true
}

Write-Host ""
Write-Host "  =============================================" -ForegroundColor DarkMagenta
Write-Host "        JARVIS VOZ  ·  instalador para Windows" -ForegroundColor Green
Write-Host "  =============================================" -ForegroundColor DarkMagenta
Write-Host "  Solo te voy a pedir dos cosas: entrar en tu cuenta de Claude y"
Write-Host "  pegar tu clave de Gemini. Todo lo demás lo hago yo."
Write-Host "  Carpeta: $Carpeta"
RefrescarPath

# ---- 1) Node.js -------------------------------------------------------------------
Paso 1 'Node.js (motor del servidor local)'
$node = $null
function VersionNode($exe) { try { $v = (& $exe --version) -replace '^v',''; return [version]($v.Split('-')[0]) } catch { return $null } }
if ((Tiene node) -and ((VersionNode 'node') -ge [version]'18.17')) { $node = (Get-Command node).Source; Ok "Node.js $(& node --version) ya está instalado" }
elseif (Test-Path "$Carpeta\node\node.exe") { $node = "$Carpeta\node\node.exe"; Ok 'Node.js portátil ya está en la carpeta de Jarvis Voz' }
else {
  if (Winget 'OpenJS.NodeJS.LTS') { if (Tiene node) { $node = (Get-Command node).Source } elseif (Test-Path "$env:ProgramFiles\nodejs\node.exe") { $node = "$env:ProgramFiles\nodejs\node.exe" } }
  if (-not $node) {
    Info 'Sin winget: bajo Node.js portátil desde nodejs.org (solo para Jarvis Voz)...'
    $lista = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $lts = ($lista | Where-Object { $_.lts } | Select-Object -First 1).version
    $arq = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $tmp = Join-Path $env:TEMP "node-$lts.zip"
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$lts/node-$lts-win-$arq.zip" -OutFile $tmp
    New-Item -ItemType Directory -Force $Carpeta | Out-Null
    Expand-Archive $tmp -DestinationPath "$Carpeta\_node" -Force
    if (Test-Path "$Carpeta\node") { Remove-Item "$Carpeta\node" -Recurse -Force }
    Move-Item (Get-ChildItem "$Carpeta\_node" | Select-Object -First 1).FullName "$Carpeta\node"
    Remove-Item "$Carpeta\_node", $tmp -Recurse -Force
    $node = "$Carpeta\node\node.exe"
  }
  if (-not $node) { Falla 'No pude instalar Node.js. Instálalo desde https://nodejs.org (versión LTS) y corre este instalador de nuevo.' }
  Ok "Node.js $(& $node --version)"
}

# ---- 2) Git para Windows (Claude Code lo usa para comandos; es opcional) --------------
Paso 2 'Git para Windows (recomendado para Claude Code)'
if (Tiene git) { Ok 'Git ya está instalado' }
elseif (Winget 'Git.Git') { if (Tiene git) { Ok 'Git instalado' } else { Aviso 'Git no quedó en el PATH; Claude Code funciona igual con PowerShell.' } }
else { Aviso 'Sin winget: sigo sin Git (es opcional; Claude Code usa PowerShell).' }

# ---- 3) Claude Code + cuenta de Claude ------------------------------------------------
Paso 3 'Claude Code (las "manos" de Jarvis: hace las tareas en tu computadora)'
$claudeOk = $false
if ($SinClaude) { Aviso 'Saltado (-SinClaude). Jarvis usará Codex o Gemini CLI si los tienes.' }
else {
  if (-not (Tiene claude)) {
    Info 'Instalando Claude Code con el instalador oficial (claude.ai/install.ps1)...'
    try { Invoke-RestMethod 'https://claude.ai/install.ps1' | Invoke-Expression } catch { Aviso "El instalador oficial falló: $($_.Exception.Message)" }
    RefrescarPath
    if (-not (Tiene claude)) { Winget 'Anthropic.ClaudeCode' | Out-Null }
  }
  if (-not (Tiene claude)) { Falla 'No pude instalar Claude Code. Mira https://code.claude.com/docs/en/setup y corre este instalador de nuevo.' }
  Ok "Claude Code $((& claude --version) -join ' ')"
  function Logueado { try { $s = (& claude auth status --json 2>$null) -join ''; return ($s -match '"loggedIn"\s*:\s*true') } catch { return $false } }
  if (Logueado) { Ok 'Ya entraste en tu cuenta de Claude' ; $claudeOk = $true }
  elseif ($SinPreguntas) { Aviso 'Falta entrar en la cuenta de Claude (modo sin preguntas).' }
  else {
    Write-Host ""
    Write-Host "  Ahora vas a entrar en tu cuenta de Claude (plan Pro, Max o superior)." -ForegroundColor Cyan
    Write-Host "  Se abre el navegador: entra, autoriza y, si te muestra un código, cópialo y pégalo aquí."
    Read-Host "  Presiona Enter para abrir el navegador" | Out-Null
    for ($i = 0; $i -lt 3 -and -not (Logueado); $i++) { & claude auth login }
    if (Logueado) { Ok 'Cuenta de Claude conectada'; $claudeOk = $true } else { Aviso 'No quedó conectada. Puedes hacerlo después con:  claude auth login' }
  }
}

# ---- 4) Clave de Gemini (voz) ---------------------------------------------------------------
Paso 4 'Clave de Gemini (la voz en tiempo real)'
$envArchivo = Join-Path $Carpeta '.env'
$claveActual = ''
if (Test-Path $envArchivo) { $l = Get-Content $envArchivo | Where-Object { $_ -match '^GEMINI_API_KEY=.+' } | Select-Object -First 1; if ($l) { $claveActual = ($l -replace '^GEMINI_API_KEY=','').Trim('" ') } }
if ($env:JARVIS_GEMINI_KEY) { $claveActual = $env:JARVIS_GEMINI_KEY }
function ClaveValida($k) { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 "https://generativelanguage.googleapis.com/v1beta/models?key=$k").StatusCode -eq 200 } catch { $false } }
if ($claveActual -and (ClaveValida $claveActual)) { Ok 'Ya tienes una clave de Gemini válida' }
elseif ($SinPreguntas) { Falla 'Falta la clave de Gemini (variable JARVIS_GEMINI_KEY).' }
else {
  Write-Host ""
  Write-Host "  Crea tu clave GRATIS en Google AI Studio (botón 'Create API key'):" -ForegroundColor Cyan
  Write-Host "     https://aistudio.google.com/apikey"
  Write-Host "  La clave queda solo en tu computadora; no se envía a nadie más que a Google."
  Start-Process 'https://aistudio.google.com/apikey'
  for ($i = 0; $i -lt 5; $i++) {
    $seg = Read-Host '  Pega aquí tu clave de Gemini y presiona Enter' -AsSecureString
    $claveActual = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg)).Trim()
    if ($claveActual -and (ClaveValida $claveActual)) { Ok 'Clave válida'; break }
    Aviso 'Google no aceptó esa clave. Revisa que la copiaste completa.'
    $claveActual = ''
  }
  if (-not $claveActual) { Falla 'Sin clave de Gemini no hay voz. Corre el instalador de nuevo cuando la tengas.' }
}

# ---- 5) Jarvis Voz desde GitHub ---------------------------------------------------------------
Paso 5 "Bajando Jarvis Voz (github.com/$Repo) y configurando"
New-Item -ItemType Directory -Force $Carpeta | Out-Null
# Si ya estaba corriendo, lo detengo para actualizar los archivos.
$puertoViejo = 8787
if (Test-Path $envArchivo) { $l = Get-Content $envArchivo | Where-Object { $_ -match '^PUERTO=\d+' } | Select-Object -First 1; if ($l) { $puertoViejo = [int]($l -replace '^PUERTO=','') } }
$llaveVieja = ''
if (Test-Path $envArchivo) { $l = Get-Content $envArchivo | Where-Object { $_ -match '^LLAVE_LOCAL=.+' } | Select-Object -First 1; if ($l) { $llaveVieja = ($l -replace '^LLAVE_LOCAL=','').Trim('" ') } }
if ($llaveVieja) { try { Invoke-WebRequest -UseBasicParsing -Method Post -TimeoutSec 3 "http://127.0.0.1:$puertoViejo/apagar?llave=$llaveVieja" | Out-Null; Start-Sleep -Seconds 1 } catch {} }
$tmpZip = Join-Path $env:TEMP 'jarvis-voz.zip'
if ($Zip) { Copy-Item $Zip $tmpZip -Force } else { Invoke-WebRequest -UseBasicParsing "https://github.com/$Repo/releases/latest/download/jarvis-voz.zip" -OutFile $tmpZip }
$tmpDir = Join-Path $env:TEMP 'jarvis-voz-nuevo'
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
Expand-Archive $tmpZip -DestinationPath $tmpDir -Force
$origen = if (Test-Path "$tmpDir\jarvis-voz\server.mjs") { "$tmpDir\jarvis-voz" } else { $tmpDir }
# Copia el programa nuevo; nunca toca .env, datos\ ni espacio\ (tu configuración, memoria y entregas).
Get-ChildItem $origen | ForEach-Object { Copy-Item $_.FullName -Destination $Carpeta -Recurse -Force }
Remove-Item $tmpDir, $tmpZip -Recurse -Force
$version = (Get-Content "$Carpeta\VERSION").Trim()
Ok "Jarvis Voz $version en $Carpeta"

# .env: crea o actualiza sin perder lo que ya tenías
$valores = [ordered]@{}
if (Test-Path $envArchivo) { foreach ($l in Get-Content $envArchivo) { if ($l -match '^([A-Z_]+)=(.*)$') { $valores[$matches[1]] = $matches[2] } } }
if (-not $valores['LLAVE_LOCAL'] -or $valores['LLAVE_LOCAL'].Length -lt 24) { $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $valores['LLAVE_LOCAL'] = -join ($b | ForEach-Object { $_.ToString('x2') }) }
$valores['GEMINI_API_KEY'] = $claveActual
if (-not $valores['ZONA_HORARIA']) { $valores['ZONA_HORARIA'] = (& $node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)").Trim() }
if (-not $valores['PUERTO']) { $valores['PUERTO'] = '8787' }
if (-not $valores['ASISTENTE_NOMBRE']) { $valores['ASISTENTE_NOMBRE'] = 'Jarvis' }
$texto = (Get-Content "$Carpeta\env.ejemplo" -Raw)
foreach ($k in $valores.Keys) { if ($texto -match "(?m)^#?\s*$k=.*$") { $texto = [regex]::Replace($texto, "(?m)^#?\s*$k=.*$", "$k=$($valores[$k])") } else { $texto += "`r`n$k=$($valores[$k])" } }
[IO.File]::WriteAllText($envArchivo, $texto, (New-Object Text.UTF8Encoding $false))
# Solo tu usuario puede leer el .env (tiene tu clave).
& icacls $envArchivo /inheritance:r /grant:r "$($env:USERNAME):(R,W)" 2>&1 | Out-Null
Ok 'Configuración guardada (.env solo para tu usuario)'

# Complemento Conexiones (Google Calendar/Gmail/Drive): solo si lo compraste.
if (Test-Path "$Carpeta\espacio\.claude\skills\conexiones-google\SKILL.md") {
  Write-Host ""
  Write-Host "  Tienes el complemento Conexiones. Para conectar tu cuenta Google:" -ForegroundColor Cyan
  Write-Host "  claude.ai > Personalizar > Conectores > conecta Google Calendar, Gmail y Google Drive."
  Write-Host "  (Claude Code usa esos conectores con la misma cuenta de Claude.)"
  if (-not $SinPreguntas) { Start-Process 'https://claude.ai/customize/connectors' }
}

# Complemento Videos virales: necesita ffmpeg.
if ((Test-Path "$Carpeta\espacio\.claude\skills\videos\SKILL.md") -and -not (Tiene ffmpeg)) {
  Info 'Complemento Videos virales: instalando ffmpeg...'
  if ((Winget 'Gyan.FFmpeg') -and (Tiene ffmpeg)) { Ok 'ffmpeg instalado' } else { Aviso 'No pude instalar ffmpeg. Instálalo con:  winget install Gyan.FFmpeg' }
}
# Complemento Publicaciones automáticas: clave de Zernio (opcional, se puede poner después).
if ((Test-Path "$Carpeta\espacio\.claude\skills\redes\SKILL.md") -and -not $valores['ZERNIO_API_KEY'] -and -not $SinPreguntas) {
  Write-Host ""
  Write-Host "  Tienes el complemento Publicaciones automáticas. Pega tu clave de Zernio" -ForegroundColor Cyan
  Write-Host "  (o presiona Enter para ponerla después en el archivo .env)."
  $z = Read-Host '  Clave de Zernio' -AsSecureString
  $z = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($z)).Trim()
  if ($z) {
    $t2 = Get-Content $envArchivo -Raw
    if ($t2 -match '(?m)^ZERNIO_API_KEY=') { $t2 = [regex]::Replace($t2, '(?m)^ZERNIO_API_KEY=.*$', "ZERNIO_API_KEY=$z") } else { $t2 += "`r`nZERNIO_API_KEY=$z" }
    [IO.File]::WriteAllText($envArchivo, $t2, (New-Object Text.UTF8Encoding $false)); Ok 'Clave de Zernio guardada'
  }
}

# ---- 6) Acceso directo, prueba y apertura -----------------------------------------------------
Paso 6 'Acceso directo en el escritorio, prueba y apertura'
$escritorio = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path $escritorio 'Jarvis Voz.lnk'))
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
$lnk.Arguments = "`"$Carpeta\iniciar.vbs`""
$lnk.WorkingDirectory = $Carpeta
$lnk.IconLocation = "$Carpeta\web\icono.ico"
$lnk.Description = 'Jarvis Voz: háblale a tu asistente'
$lnk.Save()
Ok 'Acceso directo "Jarvis Voz" creado en el escritorio'

if (-not $SinPreguntas) {
  $r = Read-Host '  ¿Iniciar el servidor de Jarvis Voz al encender la computadora? (s/N)'
  $inicio = Join-Path ([Environment]::GetFolderPath('Startup')) 'Jarvis Voz (servidor).lnk'
  if ($r -match '^[sSyY]') {
    $l2 = $sh.CreateShortcut($inicio); $l2.TargetPath = "$env:WINDIR\System32\wscript.exe"; $l2.Arguments = "`"$Carpeta\iniciar.vbs`" -SinAbrir"; $l2.WorkingDirectory = $Carpeta; $l2.Save()
    Ok 'Se iniciará con Windows (sin abrir la página)'
  } elseif (Test-Path $inicio) { Remove-Item $inicio -Force }
}

Info 'Probando la instalación...'
Push-Location $Carpeta
& $node server.mjs --diagnostico
$diag = $LASTEXITCODE
Pop-Location
if ($diag -ne 0) { Aviso 'El diagnóstico marcó algo con X (arriba). Jarvis Voz abre igual, pero corrígelo.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Carpeta\iniciar.ps1" -SinAbrir
$puerto = $valores['PUERTO']
try { $ok = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$puerto/salud").StatusCode -eq 200 } catch { $ok = $false }
if ($ok) { Ok "Servidor local funcionando en http://localhost:$puerto (solo esta computadora)" } else { Falla "El servidor no arrancó. Mira $Carpeta\datos\servidor-error.log" }

Write-Host ""
Write-Host "  LISTO. Jarvis Voz está instalado." -ForegroundColor Green
Write-Host "  Para abrirlo: doble clic en 'Jarvis Voz' en el escritorio."
Write-Host "  En la página: clic en el micrófono (o barra espaciadora) y háblale."
Write-Host "  Tus archivos: $Carpeta\espacio\entregas"
if (-not $SinPreguntas) {
  & "$env:WINDIR\System32\wscript.exe" "$Carpeta\iniciar.vbs"
  Read-Host "`n  Presiona Enter para cerrar esta ventana" | Out-Null
}
