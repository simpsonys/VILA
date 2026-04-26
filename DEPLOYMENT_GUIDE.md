# 배포 가이드 (Deployment Guide)

## 개요

Voice Log Analyzer는 **소스 코드 보호**와 **안전한 배포**를 위해 두 개의 GitHub 저장소를 사용합니다.

| 저장소 | 타입 | 용도 |
|--------|------|------|
| **VILA** | Private | 소스 코드, 빌드 설정 |
| **VILA-Releases** | Public | 최종 배포 파일, 사용자 다운로드 |

---

## 1️⃣ 초기 설정

### Private 저장소 설정 (VILA)

이 저장소는 이미 설정되어 있습니다.

```bash
# package.json의 publish 설정
"publish": {
  "provider": "github",
  "owner": "simpsonys",
  "repo": "VILA-Releases"  # 배포 저장소를 가리킴
}
```

### Public 저장소 생성 (VILA-Releases)

1. **GitHub에서 새 저장소 생성**
   - 이름: `VILA-Releases`
   - 공개 설정: **Public** ✅
   - README.md 추가: Yes
   - `.gitignore`: None
   - License: MIT (선택)

2. **초기 설정**
   ```bash
   git clone https://github.com/simpsonys/VILA-Releases.git
   cd VILA-Releases
   
   # README 작성 (선택사항)
   echo "# Voice Log Analyzer Releases" > README.md
   git add README.md
   git commit -m "Initial commit"
   git push
   ```

---

## 2️⃣ 빌드 프로세스

### Private 저장소에서 빌드

```bash
# VILA 저장소 (Private)
cd /path/to/VILA

# 1. 소스 코드 업데이트 및 커밋
git add .
git commit -m "Fix: update feature XYZ"
git push origin main

# 2. 버전 업데이트
# package.json에서 version 수정
# "version": "1.0.1"

# 3. 빌드 생성
npm run build
# → dist/Voice Log Analyzer Setup 1.0.1.exe 생성
# → dist/Voice Log Analyzer Setup 1.0.1.exe.blockmap 생성
```

---

## 3️⃣ 배포 프로세스

### Recommended automated release (from Private repo)

Instead of committing large installer files into the public repo, use the CI workflow in the private repo to build and publish releases into the public `VILA_Release` repo. This avoids polluting git history with big binaries and keeps source private.

Prerequisites:
- Create a Personal Access Token (PAT) with `repo` scope (repo access to the target public repo). Add it to the **Private** repo secrets as `RELEASE_PAT`.
- Make sure the public repo exists: `simpsonys/VILA_Release`.

How it works:
1. Push a tag in the private repo (e.g. `v1.0.2`).
2. GitHub Actions in the private repo runs on `windows-latest`, builds the installer, creates a Release on `simpsonys/VILA_Release`, and uploads the `dist/*.exe` and `.blockmap` assets.

Workflow file (already added to this repo): `.github/workflows/build-and-release.yml`

Important: define the secret `RELEASE_PAT` in the private repo settings (Repository > Settings > Secrets > Actions). The workflow uses this PAT to create releases in the public repo and upload assets.

### Optional: Use GitHub CLI or GH Actions locally

If you want to manually publish a built artifact without committing it to the public repo, you can use `gh` CLI:

```bash
# Authenticate: gh auth login
gh release create v1.0.2 \
  "dist/Voice Log Analyzer Setup 1.0.2.exe" \
  "dist/Voice Log Analyzer Setup 1.0.2.exe.blockmap" \
  --repo simpsonys/VILA_Release \
  --title "Voice Log Analyzer v1.0.2" \
  --notes "Release notes here"
```

### Git LFS recommendation

GitHub warns on files >50MB. We recommend NOT storing large binary installers in the main repository history. Two options:

1. Use the CI workflow above that builds and uploads directly to the Release (recommended).
2. If you must keep binaries in the repo, enable Git LFS on the **public** repo and track `.exe` and `.blockmap` files:

```bash
# On developer machine
git lfs install
git lfs track "dist/*.exe"
git lfs track "dist/*.blockmap"
git add .gitattributes
git add dist/*
git commit -m "Add release assets via LFS"
git push
```

Using LFS will store large files outside main git objects and is better for repo size management.


VILA-Releases(Public) 저장소에 Release를 생성합니다.

#### 방법 1: GitHub UI (권장)

1. **VILA-Releases 저장소 접속**
   - https://github.com/simpsonys/VILA-Releases

2. **Releases 탭 클릭**
   - 상단 메뉴 > "Releases"

3. **"Create a new release" 클릭**

4. **Release 정보 입력**
   ```
   Tag: v1.0.1
   Title: Voice Log Analyzer v1.0.1
   Description: 
     - Feature: 자동 업데이트 기능 추가
     - Fix: 버그 수정
     - Improvement: 성능 개선
   ```

5. **exe 파일 업로드**
   - "Artifacts" 섹션에서 파일 드래그
   - 두 파일 모두 업로드:
     ```
     Voice Log Analyzer Setup 1.0.1.exe
     Voice Log Analyzer Setup 1.0.1.exe.blockmap
     ```

6. **"Publish release" 클릭**

#### 방법 2: GitHub CLI

```bash
# 사전 준비
gh auth login
gh release create v1.0.1 \
  dist/Voice\ Log\ Analyzer\ Setup\ 1.0.1.exe \
  dist/Voice\ Log\ Analyzer\ Setup\ 1.0.1.exe.blockmap \
  --title "Voice Log Analyzer v1.0.1" \
  --notes "새로운 기능 추가"
```

---

## 4️⃣ 자동 업데이트 확인

### 사용자 입장에서

1. **앱 실행**
   - Voice Log Analyzer 시작

2. **업데이트 확인**
   - 헤더의 🔄 **Update** 버튼 클릭

3. **자동 감지**
   - VILA-Releases의 최신 Release 자동 감지
   - 새 버전 가능 시 알림

4. **다운로드 및 설치**
   - "설치 및 재시작" 버튼 클릭
   - 자동으로 최신 버전 설치 완료

### 개발자 입장에서 테스트

```javascript
// index.html에서 수동 테스트
// 브라우저 개발자 도구 열기 (F12)

// 업데이트 확인
await window.electronAPI.checkUpdates();

// 진행 상황 확인
window.electronAPI.onDownloadProgress((progress) => {
  console.log(`Downloaded: ${progress.transferred} / ${progress.total}`);
});
```

---

## 5️⃣ 버전 관리

### 버전 규칙 (Semantic Versioning)

```
MAJOR.MINOR.PATCH
1     .0     .0

- MAJOR: 대규모 기능 변경
- MINOR: 새로운 기능 추가 (하위 호환성 유지)
- PATCH: 버그 수정, 소규모 개선
```

### 업데이트 예시

| 상황 | 현재 버전 | 새 버전 | 태그 |
|------|---------|--------|------|
| 버그 수정 | 1.0.0 | 1.0.1 | v1.0.1 |
| 새 기능 | 1.0.1 | 1.1.0 | v1.1.0 |
| 대규모 변경 | 1.1.0 | 2.0.0 | v2.0.0 |

### 버전 업데이트 방법

```bash
# 1. package.json 수정
{
  "version": "1.0.1"  # 이전: 1.0.0
}

# 2. 빌드 (자동으로 build-time.json도 생성)
npm run build

# 3. 결과 확인
# dist/Voice Log Analyzer Setup 1.0.1.exe
# 앱 시작 시: [1.0.1-2603011755] by SimpsonYS
```

---

## 6️⃣ 체크리스트

배포 전 확인 사항:

- [ ] Private 저장소(VILA)에 소스 코드 커밋 완료
- [ ] `package.json` 버전 업데이트
- [ ] `npm run build` 실행 및 exe 파일 생성 확인
- [ ] 테스트 완료 (수동 또는 자동)
- [ ] VILA-Releases 저장소에서 Release 생성
- [ ] Release 태그 = `v${package.json version}` 확인
- [ ] exe 파일 2개 업로드 (.exe + .blockmap)
- [ ] Release Publish 완료
- [ ] 기존 사용자에게 업데이트 알림 (메일, 채팅 등)

---

## 7️⃣ 문제 해결

### Q: 자동 업데이트가 작동하지 않음

**A:** 다음을 확인하세요:

1. VILA-Releases 저장소가 **Public**인지 확인
2. Release 태그가 정확한지 확인 (예: `v1.0.1`)
3. exe 파일명이 정확한지 확인
4. GitHub API 레이트 제한 확인

```javascript
// 수동 테스트
const result = await window.electronAPI.checkUpdates();
console.log(result);  // 응답 확인
```

### Q: Release를 재생성해야 함

**A:** 다음 순서로 진행:

```bash
# 1. Release 삭제 (GitHub UI에서)
#    Releases > 해당 Release > Delete

# 2. Tag 삭제 (로컬)
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1

# 3. 새로 빌드 및 Release 생성
npm run build
# → GitHub UI에서 새 Release 생성
```

---

## 📚 참고 자료

- [electron-updater Documentation](https://www.electron.build/auto-update)
- [GitHub Releases API](https://docs.github.com/en/rest/releases)
- [Semantic Versioning](https://semver.org/)

---

## 💡 팁

### 자동 배포 스크립트 (선택)

향후 자동화를 위해, GitHub Actions를 사용하여 다음을 자동화할 수 있습니다:

```yaml
# .github/workflows/release.yml
name: Build and Release
on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build
      - uses: softprops/action-gh-release@v1
        with:
          files: dist/*.exe*
          repository: simpsonys/VILA-Releases
```

하지만 보안상 현재는 수동 배포를 권장합니다.

---

**Last Updated**: 2026-03-01
**Author**: Voice Log Analyzer Team
