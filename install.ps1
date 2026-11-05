# Run PowerShell from this folder. Python 3.11-3.14 is supported by this app.
$ErrorActionPreference = "Stop"

Write-Host "Creating Python virtual environment..."
if (!(Test-Path ".\.venv\Scripts\python.exe")) {
    py -3 -m venv .venv
}
if ($LASTEXITCODE -ne 0) { throw "Gagal membuat virtual environment. Pastikan Python terpasang." }

Write-Host "Upgrading pip..."
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Upgrade pip gagal." }

Write-Host "Installing application dependencies..."
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Instalasi dependency gagal. Periksa pesan error di atas." }

New-Item -ItemType Directory -Force -Path ".\data" | Out-Null
if (!(Test-Path ".\data\cameras.json")) {
    Set-Content ".\data\cameras.json" "[]" -Encoding UTF8
}

if (!(Test-Path ".\mediamtx.exe")) {
    Write-Host ""
    Write-Host "MediaMTX binary belum ada."
    Write-Host "Download Windows AMD64 dari https://github.com/bluenviron/mediamtx/releases"
    Write-Host "Ekstrak mediamtx.exe ke folder ini sebelum menjalankan start.bat."
}
Write-Host "Instalasi dependency selesai."
