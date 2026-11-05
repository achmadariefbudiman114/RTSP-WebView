@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found. Run install.ps1 first.
  pause
  exit /b 1
)
if not exist "mediamtx.exe" (
  echo mediamtx.exe not found. Download MediaMTX Windows AMD64 and place it beside app.py.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m uvicorn app:app --host 0.0.0.0 --port 8080
pause
