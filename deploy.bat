@echo off
setlocal enabledelayedexpansion

echo ================================================================
echo  VILA Deploy: version bump + commit + tag + push
echo  GitHub Actions will build and release automatically.
echo ================================================================
echo.

:: Read current version using node (always available with npm)
for /f "delims=" %%v in ('node -e "process.stdout.write(require(\"./package.json\").version)"') do set "CURRENT_VERSION=%%v"

if "!CURRENT_VERSION!"=="" (
    echo [ERROR] Cannot read version from package.json
    pause
    exit /b 1
)

echo Current version: !CURRENT_VERSION!
echo.

:: Show git status
echo [Git Status]
git status --short
echo.

:: Prompt for version type
set /p "VERSION_TYPE=Version type (major / minor / patch / or 1.2.3): "
if "!VERSION_TYPE!"=="" (
    echo Version type is required.
    pause
    exit /b 1
)
echo.

:: Prompt for commit message
set /p "COMMIT_MSG=Commit message (leave blank for auto): "
if "!COMMIT_MSG!"=="" set "COMMIT_MSG=Release"
echo.

:: Bump version in package.json only (no git ops)
:: Capture output directly ? some npm versions return errorlevel 1 even on success
echo Bumping version...
for /f "delims=" %%v in ('npm version !VERSION_TYPE! --no-git-tag-version 2^>^&1') do set "NPM_OUT=%%v"

:: Verify by reading actual new version
for /f "delims=" %%v in ('node -e "process.stdout.write(require(\"./package.json\").version)"') do set "NEW_VERSION=%%v"

if "!NEW_VERSION!"=="!CURRENT_VERSION!" (
    echo [ERROR] Version was not changed. npm output: !NPM_OUT!
    echo Check version format: major / minor / patch / or 1.2.3
    pause
    exit /b 1
)

if "!NEW_VERSION!"=="" (
    echo [ERROR] Could not read new version. npm output: !NPM_OUT!
    pause
    exit /b 1
)

echo !CURRENT_VERSION! -^> !NEW_VERSION!
echo.

:: Stage all changes
echo Staging changes...
git add .

:: Commit
echo Creating commit...
git commit -m "!COMMIT_MSG! (v!NEW_VERSION!)"
if errorlevel 1 (
    echo [ERROR] Commit failed.
    pause
    exit /b 1
)

:: Create tag
echo Creating tag: v!NEW_VERSION!
git tag v!NEW_VERSION!
if errorlevel 1 (
    echo [ERROR] Tag creation failed. Tag may already exist.
    pause
    exit /b 1
)

echo.

:: Push commits
echo Pushing commits...
git push
if errorlevel 1 (
    echo [ERROR] Push failed. Check network and authentication.
    pause
    exit /b 1
)

:: Push tags ? triggers GitHub Actions
echo Pushing tags (triggers GitHub Actions)...
git push --tags
if errorlevel 1 (
    echo [ERROR] Tag push failed.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo  Done!  !CURRENT_VERSION! -^> !NEW_VERSION!  ^(tag: v!NEW_VERSION!^)
echo.
echo  GitHub Actions build status:
echo  https://github.com/simpsonys/VILA/actions
echo ================================================================
echo.
pause
endlocal
