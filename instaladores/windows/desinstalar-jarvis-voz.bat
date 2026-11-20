@echo off
chcp 65001 >nul
title Desinstalar Jarvis Voz
if exist "%~dp0desinstalar-jarvis-voz.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0desinstalar-jarvis-voz.ps1" %*
) else if exist "%USERPROFILE%\JarvisVoz\instaladores\windows\desinstalar-jarvis-voz.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\JarvisVoz\instaladores\windows\desinstalar-jarvis-voz.ps1" %*
)
pause
