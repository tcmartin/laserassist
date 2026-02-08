@echo off
REM Complete build script for Insighto with ASR server (Windows)
REM This script builds the Python ASR server binary and packages the Electron app

echo 🚀 Building Insighto with ASR Server
echo ====================================

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is required but not installed
    exit /b 1
)

echo [SUCCESS] Python found

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is required but not installed
    exit /b 1
)

echo [SUCCESS] Node.js found

REM Install Node.js dependencies
echo [INFO] Installing Node.js dependencies...
npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Node.js dependencies
    exit /b 1
)

echo [SUCCESS] Node.js dependencies installed

REM Create Python virtual environment
if not exist "venv" (
    echo [INFO] Creating Python virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Build ASR server binary
echo [INFO] Building ASR server binary...
python build-asr-binary.py
if %errorlevel% neq 0 (
    echo [ERROR] Failed to build ASR server binary
    exit /b 1
)

if not exist "dist\cluely-asr.exe" (
    echo [ERROR] ASR binary not found after build
    exit /b 1
)

echo [SUCCESS] ASR server binary built: dist\cluely-asr.exe

REM Create build configuration
echo [INFO] Creating build configuration...
(
echo const config = {
echo   appId: "com.yourcompany.insighto",
echo   productName: "Insighto",
echo   directories: {
echo     output: "dist-app"
echo   },
echo   files: [
echo     "**/*",
echo     "!dist/**/*",
echo     "!venv/**/*",
echo     "!build-asr-binary.py",
echo     "!asr_server.spec",
echo     "!requirements.txt",
echo     "!*.sh",
echo     "!*.bat",
echo     "!test-*.js",
echo     "!.kiro/**/*"
echo   ],
echo   win: {
echo     icon: "icons/icon-256.png",
echo     target: [
echo       {
echo         target: "nsis",
echo         arch: ["x64"]
echo       }
echo     ],
echo     extraFiles: [
echo       {
echo         from: "dist/cluely-asr.exe",
echo         to: "cluely-asr.exe"
echo       }
echo     ]
echo   }
echo };
echo module.exports = config;
) > electron-builder-config.js

REM Build Electron app
echo [INFO] Building Electron application...
npx electron-builder --config electron-builder-config.js

if %errorlevel% neq 0 (
    echo [ERROR] Electron app build failed
    exit /b 1
)

echo [SUCCESS] 🎉 Build completed successfully!
echo [INFO] The ASR server binary has been included in the app bundle.
echo [INFO] You can find the built application in the 'dist-app' directory.

REM Cleanup
del electron-builder-config.js
call venv\Scripts\deactivate.bat

echo [SUCCESS] Build process completed!