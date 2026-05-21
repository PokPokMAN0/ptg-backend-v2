@echo off
:: =============================================================================
:: Prime Tech Gallery – Catalog Engine Launcher (Windows)
:: Double-click this file to start the entire catalog engine.
:: =============================================================================
cd /d "%~dp0"
echo 🔍 Checking dependencies...
call node init.server.js
pause