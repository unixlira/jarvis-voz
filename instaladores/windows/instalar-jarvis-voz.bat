@echo off
chcp 65001 >nul
title Instalador de Jarvis Voz
rem Instalador de Jarvis Voz para Windows. Doble clic y sigue las instrucciones.
rem Usa el .ps1 de al lado si existe; si no, lo baja de GitHub (unixlira/jarvis-voz).
if exist "%~dp0instalar-jarvis-voz.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-jarvis-voz.ps1" %*
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=Join-Path $env:TEMP 'instalar-jarvis-voz.ps1'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/unixlira/jarvis-voz/main/instaladores/windows/instalar-jarvis-voz.ps1' -OutFile $f; & $f"
)
