@echo off
cd /d "%~dp0"
set "CODEX_NODE=C:\Users\tarun\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" scripts\refresh-fpl.mjs
) else (
  node scripts\refresh-fpl.mjs
)

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" scripts\refresh-analytics.py
  ".venv\Scripts\python.exe" scripts\refresh-enrichment.py
) else (
  echo Python environment not found; FPL data refreshed, analytics snapshot unchanged.
)

pause
