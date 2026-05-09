@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   PUSH SUR GITHUB
echo   IA : Le monde de Leon
echo ============================================
echo.

echo --- Fichiers modifies ---
git status -s
echo.

set /p MSG="Message de commit (decrit ce que tu as change) : "

if "%MSG%"=="" (
  echo.
  echo [!] Message vide, push annule.
  pause
  exit /b 1
)

echo.
echo --- Ajout des fichiers ---
git add .

echo.
echo --- Commit ---
git commit -m "%MSG%"

echo.
echo --- Push vers GitHub ---
git push

echo.
echo ============================================
echo   TERMINE
echo ============================================
pause
