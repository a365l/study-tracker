@echo off
setlocal
cd /d "%~dp0"
set "PYW="
for %%P in ("%LOCALAPPDATA%\Programs\Python\Python313-arm64\pythonw.exe" "%LOCALAPPDATA%\Programs\Python\Python313\pythonw.exe" "%LOCALAPPDATA%\Programs\Python\Python312-arm64\pythonw.exe" "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe" "%ProgramFiles%\Python313\pythonw.exe" "%ProgramFiles%\Python312\pythonw.exe") do if not defined PYW if exist "%%~P" set "PYW=%%~P"
if not defined PYW for /f "delims=" %%P in ('where pyw 2^>nul') do if not defined PYW set "PYW=%%P"
if not defined PYW goto nopython
start "" "%PYW%" "%~dp0app.py"
exit /b 0

:nopython
echo Python 3 was not found. Install it from https://www.python.org/downloads/ and run this again.
pause
exit /b 1
