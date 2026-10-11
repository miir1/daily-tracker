@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  데일리 체크 트래커 실행 중 (끄려면 이 창을 닫으세요)
echo  PC에서:  http://localhost:8510
echo  폰에서 (같은 와이파이):  아래 IPv4 주소 뒤에 :8510 을 붙여 접속
ipconfig | findstr /C:"IPv4"
echo.
python -m http.server 8510 --bind 0.0.0.0
