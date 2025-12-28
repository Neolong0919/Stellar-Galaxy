@echo off
chcp 65001 >nul
title Stellar Galaxy - 启动中...
echo ================================================
echo        星系粒子可视化 - 全能启动器
echo ================================================

:: 1. 环境检测
set "LOCAL_NODE=%~dp0bin\node.exe"
set "API_DIR=%~dp0NeteaseCloudMusicApi"

if exist "%LOCAL_NODE%" (
    echo [模式] 独立便携环境 - Portable
    set "NODE_EXE=%LOCAL_NODE%"
    set "NPM_CLI=%~dp0bin\node_modules\npm\bin\npm-cli.js"
    set "IS_PORTABLE=1"
) else (
    echo [模式] 系统全局环境 - System
    set "NODE_EXE=node"
    set "IS_PORTABLE=0"
)

:: 2. 检查前端依赖
cd /d "%~dp0"
if not exist "node_modules" (
    echo.
    echo [1/2] 正在安装前端依赖...
    
    if "%IS_PORTABLE%"=="1" (
        "%NODE_EXE%" "%NPM_CLI%" install --verbose --userconfig "%~dp0.npmrc"
    ) else (
        call npm install
    )
    
    if %errorlevel% neq 0 pause && exit /b 1
) else (
    echo [1/2] 前端依赖已就绪
)

:: 3. 检查后端依赖
if exist "%API_DIR%" (
    cd /d "%API_DIR%"
    if not exist "node_modules" (
        echo.
        echo [2/2] 正在安装云音乐依赖...
        
        if "%IS_PORTABLE%"=="1" (
            "%NODE_EXE%" "%NPM_CLI%" install --verbose --userconfig "%~dp0.npmrc"
        ) else (
            call npm install
        )
        
        if %errorlevel% neq 0 pause && exit /b 1
    ) else (
        echo [2/2] 后端依赖已就绪
    )
)

:: 4. 启动服务
echo.
echo ================================================
echo        正在启动双端服务...
echo ================================================
echo.

:: 启动音乐后端
cd /d "%API_DIR%"
set PORT=4000
start "NeteaseCloudMusicApi (Do Not Close)" "%NODE_EXE%" app.js
echo [启动] 音乐服务已在后台运行 (端口 4000)

:: 启动前端
cd /d "%~dp0"
echo [启动] 前端可视化正在开启...

if "%IS_PORTABLE%"=="1" (
    "%NODE_EXE%" "%NPM_CLI%" run dev
) else (
    call npm run dev
)
