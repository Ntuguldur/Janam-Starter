@echo off
REM Set ADMIN_PASSWORD in your environment before starting the store.
if not defined ADMIN_PASSWORD (
  echo Please set ADMIN_PASSWORD to a strong value before starting the store.
  pause
  exit /b 1
)
set "DATA_DIR=E:\github\Janam Starter\Starter\"
npm start
pause
