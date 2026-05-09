@echo off
REM Lance un mini-serveur HTTP local + ouvre le jeu dans le navigateur.
cd /d "%~dp0"
echo ============================================
echo   IA EXPLORERS - Serveur local
echo ============================================
echo.

REM Essaie plusieurs commandes Python possibles
set PYCMD=
where py >nul 2>&1 && set PYCMD=py
if "%PYCMD%"=="" where python >nul 2>&1 && set PYCMD=python
if "%PYCMD%"=="" where python3 >nul 2>&1 && set PYCMD=python3

if "%PYCMD%"=="" (
  echo [!] Python n'est pas trouve sur ton systeme.
  echo Solution : installe Python depuis https://www.python.org/downloads/
  echo Coche "Add Python to PATH" pendant l'installation.
  pause
  exit /b 1
)

echo Commande Python detectee : %PYCMD%
echo Le jeu s'ouvre sur http://localhost:8765/
echo Pour arreter, ferme cette fenetre.
echo.

start "" cmd /c "timeout /t 2 >nul && start http://localhost:8765/index.html"
REM lancer_jeu.py = serveur statique + endpoint POST /api/save-calibration
REM (pour persister les calibrations dans calibration.json sur disque)
%PYCMD% lancer_jeu.py 8765
pause
