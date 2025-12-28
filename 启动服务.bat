@echo off
chcp 65001 >nul
title Stellar Galaxy - 星系生成器

echo ================================================
echo    🌌 Stellar Galaxy - 奇点喷发星系生成器
echo ================================================
echo.

cd /d "%~dp0"

echo [1/3] 检查依赖...
if not exist "node_modules\" (
    echo 首次运行，正在安装依赖包...
    echo 这可能需要几分钟时间，请耐心等待...
    echo.
    cmd /c npm install
    if errorlevel 1 (
        echo.
        echo ❌ 依赖安装失败！
        echo 请检查网络连接或 Node.js 是否正确安装
        pause
        exit /b 1
    )
    echo.
    echo ✅ 依赖安装完成！
    echo.
) else (
    echo ✅ 依赖已就绪
    echo.
)

echo [2/3] 启动开发服务器...
echo.
echo ================================================
echo    服务器将自动在浏览器中打开
echo    如果没有自动打开，请访问:
echo    http://localhost:3000
echo ================================================
echo.
echo 💡 使用说明:
echo    1. 点击"上传音乐"选择你喜欢的音乐
echo    2. 点击"启动创世"上传图片生成星系
echo    3. 鼠标拖拽旋转视角，滚轮缩放
echo    4. 支持视频录制功能
echo.
echo ⚠️  关闭此窗口将停止服务器
echo ================================================
echo.

cmd /c npm run dev

echo.
echo 服务器已停止
pause
