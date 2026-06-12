@echo off
setlocal
call "C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo vcvars64.bat failed
  exit /b 1
)
echo === cl.exe location ===
where cl.exe
echo === link.exe location ===
where link.exe
echo === MSVC env loaded ===
cd /d %~dp0src-tauri
echo === cargo build --release ===
cargo build --release 2>&1
echo === cargo exit code: %ERRORLEVEL% ===
exit /b %ERRORLEVEL%
