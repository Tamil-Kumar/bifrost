@echo off
rem Bifrost setup: builds portable Bifrost (x64 + ARM64) and the two installers (see files\setup.ps1).
title Bifrost setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0files\setup.ps1" %*
