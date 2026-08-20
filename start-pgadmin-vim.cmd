@echo off
setlocal
cd /d "%~dp0runtime"
corepack yarn start
endlocal
