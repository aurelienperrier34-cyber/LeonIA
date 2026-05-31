@echo off
chcp 65001 >nul
title Demo WE - Le monde de Leon
cd /d "%~dp0.claude\worktrees\eloquent-buck-980d8d"

echo ============================================
echo    DEMO - IA : Le monde de Leon
echo ============================================
echo.
echo Demarrage du serveur de Leon...
echo (laisse la fenetre noire "Leon backend" OUVERTE pendant la demo)
echo.

start "Leon backend" cmd /k python server\app.py

echo Attente du demarrage du serveur (5 s)...
timeout /t 5 /nobreak >nul

echo Ouverture de la demo dans le navigateur...
start "" "http://localhost:8787/?demo=1"

echo.
echo Recherche de l'adresse reseau (pour les telephones)...
set "IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
  if not defined IP set "IP=%%a"
)
set "IP=%IP: =%"

echo.
echo ============================================
echo  C'est pret !  La demo est ouverte sur ce PC.
echo.
echo  Sur un TELEPHONE (meme wifi que ce PC) :
if defined IP (
  echo      http://%IP%:8787/?demo=1
) else (
  echo      [IP introuvable] tape  ipconfig  et cherche "IPv4"
)
echo.
echo  - Tout est debloque (5 chapitres + Livre magique)
echo  - Heros et histoires de demo deja prets dans
echo    "Mes heros" et "Mes histoires"
echo.
echo  Pour ARRETER : ferme la fenetre "Leon backend".
echo ============================================
echo.
pause
