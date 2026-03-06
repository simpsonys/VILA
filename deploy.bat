@echo off
chcp 65001 > nul

echo Git 변경 사항을 확인합니다...
git status --porcelain > git_status.tmp
set /p GIT_STATUS=<git_status.tmp
del git_status.tmp

if "%GIT_STATUS%"=="" (
    echo 변경 사항이 없습니다. 릴리스를 진행하려면 먼저 커밋할 내용이 있어야 합니다.
    pause
    exit /b
)

echo Submodule 변경 사항을 커밋합니다...
git submodule foreach "git add . && git commit -m \"Update submodule\" || exit 0"

set /p VERSION_TYPE="릴리스할 버전을 입력하세요 (major, minor, patch, or specific version): "
if "%VERSION_TYPE%"=="" (
    echo 버전이 필요합니다.
    pause
    exit /b
)

set /p COMMIT_MESSAGE="커밋 메시지를 입력하세요 (비워두면 'Release v[version]' 사용): "

git add .

if defined COMMIT_MESSAGE (
    npm version %VERSION_TYPE% -m "%COMMIT_MESSAGE%"
) else (
    npm version %VERSION_TYPE%
)

if errorlevel 1 (
    echo 버전 업데이트 실패.
    pause
    exit /b
)

echo 원격 저장소에 푸시합니다...
git push --recurse-submodules=on-demand
git push --tags

echo 빌드 및 배포를 시작합니다...
npx electron-builder --publish always

if errorlevel 1 (
    echo 배포 실패.
    pause
    exit /b
)

echo 성공적으로 배포되었습니다.
pause
