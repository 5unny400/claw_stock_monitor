@echo off
REM 股票盯票验票系统 - 开机自启脚本
REM 使用 PM2 管理 Node.js 服务

cd /D "%~dp0"

REM 检查 PM2 是否已安装
where pm2 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo PM2 未安装，正在安装...
    npm install -g pm2
)

REM 停止并删除旧进程（如果存在）
pm2 stop stock-monitor 2>nul
pm2 delete stock-monitor 2>nul

REM 启动服务
pm2 start server.js --name stock-monitor

REM 保存 PM2 进程列表
pm2 save

echo 股票盯票验票系统已启动！
echo 访问地址：http://localhost:3000
echo.
echo 按任意键退出...
pause >nul
