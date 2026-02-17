@echo off
title SEHA V1.7 Launcher
cls
echo.
echo =======================================================
echo    STARTING SEHA V1.7...
echo =======================================================
echo.

node bin/seha.js simulate

:: Keep window open if it crashes
if %errorlevel% neq 0 (
    echo.
    echo [!] Application exited with errors.
    pause
)
