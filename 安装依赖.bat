@echo off
chcp 65001 >nul
echo ================================================
echo        星系粒子可视化 - 依赖安装工具
echo ================================================
echo.
echo 正在检查 Node.js 安装...
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js！
    echo.
    echo 请先安装 Node.js：
    echo 1. 访问 https://nodejs.org/
    echo 2. 下载并安装 LTS 版本
    echo 3. 安装完成后重启电脑
    echo 4. 再次运行本脚本
    echo.
    pause
    exit /b 1
)

echo [成功] Node.js 已安装
node -v
echo.
echo ------------------------------------------------
echo 开始安装项目依赖...
echo ------------------------------------------------
echo.

cmd /c npm install

if %errorlevel% equ 0 (
    echo.
    echo ================================================
    echo        依赖安装完成！
    echo ================================================
    echo.
    echo 下一步：双击【启动服务.bat】启动程序
    echo.
) else (
    echo.
    echo ================================================
    echo        依赖安装失败！
    echo ================================================
    echo.
    echo 可能的解决方案：
    echo 1. 检查网络连接
    echo 2. 使用管理员权限运行
    echo 3. 切换 npm 镜像源：
    echo    npm config set registry https://registry.npmmirror.com
    echo.
)

pause
