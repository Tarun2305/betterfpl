@echo off
cd /d "%~dp0"
set "CODEX_NODE=C:\Users\tarun\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" scripts\refresh-fpl.mjs
  if exist ".venv\Scripts\python.exe" ".venv\Scripts\python.exe" scripts\refresh-analytics.py
  if exist ".venv\Scripts\python.exe" start "" /b ".venv\Scripts\python.exe" scripts\refresh-enrichment.py ^> "data\enrichment-refresh.log" 2^>^&1
  "%CODEX_NODE%" node_modules\next\dist\bin\next dev
) else (
  node scripts\refresh-fpl.mjs
  if exist ".venv\Scripts\python.exe" ".venv\Scripts\python.exe" scripts\refresh-analytics.py
  if exist ".venv\Scripts\python.exe" start "" /b ".venv\Scripts\python.exe" scripts\refresh-enrichment.py ^> "data\enrichment-refresh.log" 2^>^&1
  node node_modules\next\dist\bin\next dev
)

pause
