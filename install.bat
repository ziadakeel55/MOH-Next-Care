@echo off
setlocal
chcp 65001 >nul
color 0B
cls

echo.
echo =======================================================
echo    SEHA INSTALLER (SAFE MODE)
echo =======================================================
echo.

echo [1] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js NOT found.
    echo [*] Downloading Node.js...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi' -OutFile 'node_installer.msi'"
    
    if exist "node_installer.msi" (
        echo [+] Installing Node.js...
        start /wait msiexec /i node_installer.msi /qn
        del "node_installer.msi"
        echo [!] Please RESTART this script after Node.js installs.
        pause
        exit
    ) else (
        echo [X] Download failed.
        pause
        exit
    )
) else (
    echo [OK] Node.js is installed.
    node -v
)

echo.
echo [2] Cleaning old files...
if exist "node_modules" rmdir /s /q "node_modules"
if exist "package-lock.json" del "package-lock.json"

echo.
echo [3] Installing Dependencies...
call npm install

if %errorlevel% neq 0 (
    echo [X] Installation failed.
    pause
    exit
)

echo.
echo =======================================================
echo    INSTALLATION COMPLETE!
echo =======================================================
echo Now run: run.bat
pause 