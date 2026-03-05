@echo off
chcp 65001 > nul
git add .
npm version patch -m "chore: release"
git push
git push --tags
npx electron-builder --publish always
