@echo off
REM Stop Python server on port 3030 (MT5 Connector)

echo Finding process on port 3030...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3030 ^| findstr LISTENING') do (
    set PID=%%a
)

if defined PID (
    echo Stopping process PID: %PID%
    taskkill /PID %PID% /F
    if %errorlevel% equ 0 (
        echo Successfully stopped!
    ) else (
        echo Failed to stop process
    )
) else (
    echo No process found on port 3030
)

pause

