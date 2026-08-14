@echo off
title Gomoku Online
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0play-online.ps1"
echo.
echo [exit] press any key to close...
pause >nul
