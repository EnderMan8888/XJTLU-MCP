@echo off
setlocal

pushd "%~dp0" || (
    echo Could not open the XJTLU-MCP project folder.
    pause
    exit /b 1
)

call npm.cmd start %*
set "start_status=%errorlevel%"
popd

if not "%start_status%"=="0" pause
exit /b %start_status%
