@echo off
setlocal enabledelayedexpansion

echo ===================================
echo 微软Rewards脚本自动安装程序
echo ===================================
echo.

:: 检查Node.js是否已安装
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Node.js未安装，正在下载安装...
    
    :: 创建临时目录
    mkdir %TEMP%\node-install >nul 2>nul
    cd %TEMP%\node-install
    
    :: 下载Node.js安装程序
    echo 正在下载Node.js安装程序...
    powershell -Command "(New-Object System.Net.WebClient).DownloadFile('https://npmmirror.com/mirrors/node/v24.13.0/node-v24.13.0-x64.msi', 'node-installer.msi')"
    
    :: 安装Node.js
    echo 正在安装Node.js...
    start /wait msiexec /i node-installer.msi /quiet /norestart
    
    :: 清理临时文件
    cd %~dp0
    rmdir /s /q %TEMP%\node-install >nul 2>nul
    

    :: 检查Node.js是否安装成功
    where node >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo 错误: Node.js安装完成，但系统仍然无法识别
        echo 请关闭此窗口，然后重新打开并运行setup.bat进行安装
        pause
        exit
    )
) else (
    echo Node.js已安装，版本信息:
    node -v
)

:: 检查npm是否已安装
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo npm未安装...
    call npm install -g npm
    echo npm未安装，正在安装...

    if %ERRORLEVEL% neq 0 (
        echo 安装npm失败，请手动前往官网安装
        pause
        exit /b 1
    )
) else (
    echo npm已安装
)

echo.

:: 安装项目依赖
echo 正在安装项目依赖...
call npm install
if %ERRORLEVEL% neq 0 (
    echo 安装依赖失败，请检查网络连接
    pause
    exit /b 1
)

:: 安装Playwright
echo 正在安装Playwright...
call npx patchright install chromium
if %ERRORLEVEL% neq 0 (
    echo 安装Playwright失败，请检查网络连接
    pause
    exit /b 1
)

:: 复制默认账户配置文件
if not exist "src\accounts.json" (
    if exist "src\accounts.example.json" (
        echo 正在复制账户配置文件...
        copy "src\accounts.example.json" "src\accounts.json"
        echo 已生成accounts.json文件，请在运行脚本前编辑该文件添加您的账户信息
    ) else (
        echo 错误: 未找到accounts.example.json文件，请手动创建accounts.json文件
    )
) else (
    echo accounts.json文件已存在
)
:: 预构建项目
echo 开始预构建项目...
call npm run pre-build
if %ERRORLEVEL% neq 0 (
    echo 预构建项目失败，请检查错误信息
    pause
    exit /b 1
)

:: 构建项目
echo 正在构建项目...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo 构建项目失败，请检查错误信息
    pause
    exit /b 1
)

:: 检查配置文件
if exist "dist\config.json" (
    echo config.json文件已存在，请确保已正确配置您的偏好设置
) else (
    echo 错误: 未找到config.json文件，请确保该文件存在并正确配置
)

echo.
echo ===================================
echo 安装完成！
echo 后续步骤：
echo 1. 编辑构建后的具体路径：Microsoft-Rewards-Script-3.0.2.1\dist\accounts.json 文件添加您的账户信息
echo 2. （可选）修改构建后的具体路径：Microsoft-Rewards-Script-3.0.2.1\dist\config.json 配置文件
echo 3. 执行以下命令：npm start 或直接运行run.bat
echo ===================================

pause