@echo off
chcp 65001 >nul
rem 커밋된 daily_tracker 폴더 내용만 GitHub Pages(miir1/daily-tracker)로 올린다.
rem 먼저 C:\dev 에서 변경사항을 커밋한 뒤 실행할 것.
cd /d "%~dp0.."
git subtree split --prefix=daily_tracker -b daily-tracker-deploy
git push https://github.com/miir1/daily-tracker.git daily-tracker-deploy:main
echo.
echo 1~2분 뒤 https://miir1.github.io/daily-tracker/ 에 반영됩니다.
pause
