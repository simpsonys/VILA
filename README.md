# Voice Interaction Log Analyzer - Desktop App

음성 인터랙션 로그를 발화(utterance) 단위로 분석하여 리포트를 생성하는 도구입니다. 데스크톱 환경에서 실행되며, 로그 파일을 드래그·드롭하거나 클립보드에 복사된 텍스트를 붙여넣어 빠르게 분석할 수 있습니다. 앱 창 상단에는 현재 빌드 버전이 표시되며(예: `[1.0.0] by SimpsonYS`), 프로그램의 변경 사항이 반영된 상태인지 즉시 확인할 수 있습니다.

## 🏗️ 저장소 구조

이 프로젝트는 **두 개의 저장소**로 분리되어 있습니다:

| 저장소 | 설명 | 접근성 | 용도 |
|--------|------|--------|------|
| **VILA** (Private) | 소스 코드 저장소 | Private | 개발, 빌드, 설정 관리 |
| **VILA-Releases** (Public) | 배포 저장소 | Public | 최종 exe 파일 및 릴리스 배포 |

### 워크플로우
1. **개발 단계**: Private 저장소 (`VILA`)에서 코드 수정
2. **빌드**: `npm run build` → `dist/Voice Log Analyzer Setup 1.0.0.exe` 생성
3. **배포**: 생성된 exe 파일을 Public 저장소 (`VILA-Releases`)의 Release로 업로드
4. **자동 업데이트**: 앱 사용자는 🔄 Update 버튼을 통해 Public 저장소에서 최신 버전 다운로드

이를 통해 **소스 코드 보호**와 **안전한 배포**를 동시에 실현합니다.

## 기능
- **로그 파일 분석**: 드래그앤드롭, 파일선택, 클립보드 붙여넣기 (Ctrl+V) 지원
- **자동 인코딩 감지**: UTF-8, EUC-KR, UTF-16 자동 감지
- **실시간 스트리밍 파싱**: 대용량 로그도 끊김 없이 처리
- **Configurable**: `pattern_config.json`으로 시작/종료/성공/실패 패턴, 발화 추출, 클릭 가능한 패턴, 테이블 열 구성 등을 자유롭게 변경
- **HTML + JSON Export**: 분석 결과를 HTML 리포트 + JSON 데이터로 내보내기하여 다른 팀과 공유
- **Clickable 패턴**: ConversationID, RequestID 등 클릭 시 외부 URL 열기
- **버전 표시**: 창 제목 바로 아래에 `[AppVersion] by SimpsonYS` 형태로 현재 앱 버전이 표시되어 수정 사항이 반영된 앱인지 확인 가능
- **자동 업데이트**: 🔄 Update 버튼을 클릭하면 자동으로 최신 버전 확인 및 다운로드, "설치 및 재시작" 버튼으로 즉시 업그레이드 가능
- **줌 기능**: 모든 창에서 **Ctrl+휠**로 글자 크기 확대/축소, **Ctrl+**/**Ctrl-** 키도 지원. UI가 작을 때 편리하게 화면 배율을 조절할 수 있습니다.
- **Dark Theme UI**: 눈에 부담 적은 다크 테마 디자인

## 사용법

### 기본 사용
1. 앱을 실행합니다.
2. 로그 파일을 드래그하거나 **파일 열기** 버튼을 이용해 선택합니다. 또는 텍스트를 클립보드에 복사한 뒤 **Ctrl+V**를 눌러 붙여넣습니다.
3. 파싱이 진행되면 실시간으로 진행률과 통계가 표시됩니다.
4. 검색창에 키워드를 입력하면 전체 컬럼을 대상으로 필터링합니다.
5. 테이블 행을 클릭하면 발화 상세 정보와 관련 로그를 확인할 수 있습니다.
6. ⚙ Config 버튼을 눌러 설정 파일 폴더를 열어 패턴을 수정할 수 있습니다.
7. 결과를 저장하려면 **Export HTML + JSON** 버튼을 클릭하세요.

### 줌 조절
- **Ctrl + 마우스 휠**: 화면 배율 확대/축소
- **Ctrl + + / Ctrl + -**: 글자 크기 키보드 단축
- 배율은 50%~300% 사이로 제한되며, app 환경에 따라 자동 저장되지는 않습니다.

### 리뷰/디버그
- 앱을 재배포할 때 소스의 `package.json` `version` 값을 변경하면 제목과 내보낸 리포트에도 자동 반영됩니다.

## 빌드 방법 (Windows exe)

### 사전 준비
- Node.js 18+ 설치 (https://nodejs.org)
- Git (선택사항)

### 빌드 순서

```bash
# 1. 프로젝트 폴더로 이동
cd voice-log-analyzer-electron

# 2. 의존성 설치
npm install

# 3. 개발 모드 실행 (테스트)
npm start

# 4. Windows exe 빌드 (인스톨러)
npm run build

# 5. 또는 Portable exe 빌드 (설치 없이 실행)
npm run build:portable
```

빌드 결과물은 `dist/` 폴더에 생성됩니다.

### 아이콘 추가 (선택)
- `icon.png` (256x256 이상) 파일을 프로젝트 루트에 추가하면 exe 아이콘으로 사용됩니다.

### 🚀 배포 (Public Releases)

빌드 후 최종 exe 파일을 배포하려면:

1. **GitHub에서 VILA-Releases 저장소 준비**
   - Public 저장소로 설정 (https://github.com/simpsonys/VILA-Releases)
   - README 파일 추가 (선택사항)

2. **새 Release 생성**
   ```
   Tag: v1.0.0 (package.json의 version과 동일)
   Title: Version 1.0.0
   ```

3. **exe 파일 업로드**
   - `dist/Voice Log Analyzer Setup 1.0.0.exe` 업로드
   - `dist/Voice Log Analyzer Setup 1.0.0.exe.blockmap` 업로드 (차이 업데이트용)

4. **Publish Release**

**자동 업데이트 확인:**
- 앱 사용자가 🔄 Update 버튼 클릭 → VILA-Releases의 최신 Release에서 자동 감지
- 새 버전이 있으면 다운로드 → "설치 및 재시작" 버튼 클릭으로 자동 업그레이드

## Config 파일

(이후 내용은 기존과 동일합니다.)
첫 실행 시 `%APPDATA%/voice-log-analyzer/pattern_config.json`에 기본 설정 파일이 자동 생성됩니다.

앱 헤더의 ⚙ Config 버튼을 클릭하면 설정 파일이 있는 폴더를 열어줍니다.

### Config 구조

```json
{
  "start_patterns": ["패턴1", "패턴2"],
  "end_patterns": ["종료패턴"],
  "success_patterns": ["성공패턴"],
  "failure_patterns": ["실패패턴"],
  "clickable_patterns": {
    "키": {
      "pattern": "정규식",
      "url_template": "https://example.com?id={value}",
      "display_name": "표시명"
    }
  },
  "utterance_patterns": {
    "키": {
      "pattern": "정규식 (캡처그룹)",
      "utterance": "{value}"
    }
  },
  "pattern_groups": {
    "키": {
      "name": "그룹명",
      "patterns": ["정규식1", "정규식2"]
    }
  },
  "table_columns": [
    { "key": "conversationId", "label": "Conversation ID", "width": "22%", "clickable_key": "conversationId" },
    { "key": "requestId", "label": "Request ID", "width": "12%" },
    { "key": "utterance", "label": "Utterance", "width": "30%", "type": "utterance" },
    { "key": "result", "label": "Result", "width": "8%", "type": "badge" },
    { "key": "successLine", "label": "Success Match", "width": "28%", "type": "log" }
  ]
}
```

### table_columns 타입
- `utterance`: 클릭 가능한 발화 텍스트 (클릭 시 상세보기)
- `badge`: 결과 상태 뱃지 (SUCCESS/FAIL/PARTIAL/Unknown)
- `log`: 로그 라인 (timestamp 자동 제거)
- `clickable_key`: clickable_patterns의 키 참조 → 클릭 시 URL 이동

## 프로젝트 구조
```
voice-log-analyzer-electron/
├── package.json          # 의존성 및 빌드 설정
├── main.js               # Electron 메인 프로세스
├── preload.js            # 보안 브릿지
├── index.html            # 앱 UI (자체 완결)
├── default_config.json   # 기본 설정 파일
└── README.md             # 이 파일
```
