# Voice Interaction Log Analyzer (VILA)

VILA는 복잡한 음성 인터랙션 로그를 **발화(Utterance) 단위**로 신속하게 분석·시각화하기 위해 개발된 Electron 기반 데스크톱 애플리케이션입니다.
로그 파일을 드래그·드롭하는 **Batch 모드**와, SDB/ADB 단말과 직접 연동하는 **Live 스트리밍 모드**를 모두 지원합니다.
개발자와 QA 엔지니어가 디버깅·품질 분석에 소요되는 시간을 획기적으로 단축할 수 있도록 설계되었습니다.

---

## 📋 목차

1. [주요 기능](#-주요-기능)
2. [화면 구성 및 사용법](#-화면-구성-및-사용법)
3. [pattern_config.json 설정 가이드](#-pattern_configjson-설정-가이드)
4. [프리셋(Preset) 관리](#-프리셋preset-관리)
5. [Live 모드 상세](#-live-모드-상세)
6. [Sequence Diagram 뷰](#-sequence-diagram-뷰)
7. [단축키 및 조작](#-단축키-및-조작)
8. [빌드 및 배포](#️-빌드-및-배포)
9. [프로젝트 구조](#-프로젝트-구조)

---

## ✨ 주요 기능

### 1. 로그 수집 — 3가지 입력 방식

| 방식 | 설명 |
|------|------|
| **Batch (드래그·드롭)** | `.log` / `.txt` 파일을 드롭 존에 드래그하거나 클릭하여 선택. 전체 내용을 자동 고속 파싱. |
| **Live (실시간 스트리밍)** | `sdb shell dlogutil` 등 명령을 통해 단말과 직접 연결, 실시간 로그를 발화 단위로 즉시 분석. |
| **클립보드 붙여넣기** | 텍스트 에디터나 웹에서 복사한 로그를 `Ctrl+V` 한 번으로 바로 분석 시작. |

- **자동 인코딩 감지**: UTF-8, EUC-KR, UTF-16 등 다양한 파일 인코딩을 자동 감지하여 한글 깨짐 없이 처리.
- **Batch / Stream 모드 전환**: Batch 모드는 분석 완료 후 결과 표시, Stream 모드는 파싱 중 실시간으로 테이블 업데이트.
- **멀티 인스턴스 지원**: VILA를 여러 개 동시에 실행하여 복수 단말·복수 로그를 병렬 분석 가능.

---

### 2. 사용자 맞춤형 분석 설정 — 프리셋 & 패턴

#### 프리셋(Preset) 관리
- UI 상단 **🎛️ Preset** 버튼으로 분석 설정 전환. 클릭 시 펼쳐지는 메뉴에서:
  - **➕ Custom**: 로컬 JSON 파일을 불러와 새 프리셋으로 즉시 등록 (앱 실행 위치에서 탐색 시작).
  - **🔄 Reset**: 현재 프리셋을 내장 기본값으로 초기화.
  - **🗑️ Delete**: 사용자 정의 프리셋 삭제.
  - **프리셋 선택**: 버튼 클릭만으로 즉시 전환, 현재 로드된 파일 자동 재분석.

#### 📋 Pattern List 버튼 (신규)
- Header의 **📋 Patterns** 버튼을 클릭하면 현재 프리셋의 **전체 패턴 목록**이 우상단 패널로 표시.
- **Pattern Groups**는 개별 **ON/OFF 토글** 가능 → Sequence Diagram에 즉시 반영.
  - 복잡한 상세 분석(전체 On)과 핵심만 보는 간소화 뷰(선택적 On) 사이를 빠르게 오갈 수 있음.
- **All On / All Off** 버튼으로 전체 일괄 제어.

#### 패턴 설정 (pattern_config.json)
```jsonc
{
  "start_patterns":   ["..."],   // 발화 블록 시작 패턴
  "end_patterns":     ["..."],   // 발화 블록 종료 패턴
  "success_patterns": ["..."],   // 성공 판별 패턴
  "failure_patterns": ["..."],   // 실패 판별 패턴
  "utterance_patterns": { },     // 발화문(utterance) 추출용 정규식
  "clickable_patterns": { },     // ID 추출 + 하이퍼링크 URL 생성
  "pattern_groups":   { },       // Sequence Diagram에 표시할 패턴 그룹
  "table_columns":    [ ],       // 결과 테이블 열 구성
  "default_sdb_device": "...",   // SDB Device 기본 주소
  "default_live_log_command": "..." // Live Log 기본 명령어
}
```

---

### 3. 결과 테이블

- **컬럼 리사이즈**: 헤더 경계선 드래그로 너비 자유 조절.
- **통합 검색**: 상단 검색창에서 전체 컬럼 대상 키워드 검색.
- **컬럼별 필터**: 각 컬럼 헤더 아래 입력창에서 개별 필터 적용.
  - `n/a` → 빈 값만 표시 / `!n/a` → 비어있지 않은 값 / `!term` → 제외 필터
- **정렬**: 컬럼 헤더 클릭 → 오름차순 → 내림차순 → 정렬 해제 순환.
- **페이지 크기**: 50 / 100 / 150 / ALL 선택.
- **TSV 내보내기**: 현재 필터 결과를 클립보드 복사 또는 파일 저장.

---

### 4. 발화 상세 뷰 (Detail Window)

- 결과 테이블의 발화 행을 클릭하면 **별도 창**으로 상세 분석 결과 표시.
- **Conversation ID / Request ID / Utterance** 등 메타 정보 카드.
- **성공/실패 매칭 라인**, **패턴 그룹별 추출 로그**.
- **전체 유효 로그 라인** — 개별 복사 및 브라우저에서 열기 지원.
- **자동 스크린샷 연동**: 로그 파일과 같은 위치 또는 지정 폴더의 스크린샷을 시점(Index)에 맞춰 자동 매칭·표시.
  - 썸네일 클릭 → 확대/축소(마우스 휠) 뷰어 모달.
  - 📋 Copy / 💾 Save As / 📂 Reveal 지원.

---

### 5. Sequence Diagram 뷰

- **Table / Sequence** 탭으로 전환.
- `pattern_groups`의 PlantUML 설정에 따라 SVG 시퀀스 다이어그램 자동 생성.
- **발화 헤더 클릭 (신규)**: `#1: Test Utterance` 형식의 구분자를 클릭하면 해당 발화의 상세 뷰 즉시 오픈. 글자 크기도 확대되어 가독성 향상.
- **Note 복사 버튼**: Note 우상단의 ⊞ 버튼 클릭 시 **라인 번호(L2: 등) 제외** 본문만 클립보드 복사.
- **📋 Patterns 토글**: 일부 Pattern Group을 OFF하면 Sequence Diagram에서 해당 그룹 라인 즉시 제거.

---

### 6. Live 모드 — 실시간 스트리밍

- **SDB Device 입력 → 🔌 Connect 버튼 (신규)**:
  - 버튼 클릭 시 `sdb connect <ip>` → `sdb root on` 순차 자동 실행.
  - 연결 성공/실패 결과를 버튼 옆에 즉시 표시.
- **⏸ Pause / ▶ Resume 버튼 (신규)**:
  - Pause: SDB 프로세스는 유지한 채 화면 업데이트·파싱만 일시정지. 수신 데이터는 내부 버퍼에 보존.
  - Resume: 버퍼에 쌓인 데이터를 순서대로 일괄 처리하여 손실 없이 복구.
- **■ Stop**: 스트리밍 완전 종료 후 분석 요약 표시.
- **🗑 Clear**: Raw 로그와 파싱 결과를 초기화하여 새 세션 시작.
- **Raw Log 내 실시간 검색**: 로그 뷰어 상단 검색창으로 즉시 필터·하이라이팅.

---

### 7. Ctrl+F 앱 내 검색 (신규)

- `Ctrl+F` 단축키로 화면 상단에 검색 바 등장.
- Electron 네이티브 `findInPage` 사용 — 앱 전체 텍스트 대상 Chromium 검색.
- `Enter` 다음 / `Shift+Enter` 이전 / `Esc` 닫기.
- 현재 일치 위치와 전체 개수를 실시간 표시.

---

### 8. 완벽한 리포트 내보내기

- **HTML + JSON Export**: 분석 결과를 단일 HTML 파일로 내보내기.
  VILA 앱 없이 웹 브라우저만으로도 테이블 필터·정렬·상세 뷰 가능.

---

### 9. 자동 업데이트

- 실행 시 백그라운드에서 GitHub 릴리스 체크.
- 최신 버전 감지 시 팝업 안내 → 원클릭 다운로드 및 재시작.

---

## 🖥️ 화면 구성 및 사용법

### 기본 분석 시작하기

**Batch 모드 (파일 분석)**
1. 앱 실행 후 `📋 Batch` 모드를 선택(기본값).
2. 화면 중앙 Drop Zone에 `.log` / `.txt` 파일을 드래그하거나 클릭하여 선택.
3. 분석 완료 후 결과 테이블이 표시됨.
4. 행 클릭 → 발화 상세 뷰 오픈.

**Live 모드 (실시간 단말 연결)**
1. `🔴 Start Live Log` 버튼 영역에서 SDB Device IP를 입력 (예: `192.168.250.250:26101`).
2. **🔌 Connect** 버튼으로 `sdb connect` + `sdb root on` 자동 실행.
3. Live Log 명령어를 확인 후 **🔴 Start Live Log** 클릭.
4. 실시간으로 발화가 파싱되어 테이블·시퀀스 다이어그램에 표시됨.
5. **⏸ Pause** 로 화면 업데이트 잠깐 멈추기, **▶ Resume** 으로 버퍼 데이터 일괄 복원.

**클립보드 붙여넣기**
- 앱 화면 어디서나 `Ctrl+V` → 클립보드 텍스트를 즉시 분석.

---

## ⚙️ pattern_config.json 설정 가이드

설정 파일의 위치: `%APPDATA%\voice-log-analyzer\` (Windows)
프리셋 메뉴의 **📂 Preset Config** 버튼으로 해당 폴더를 바로 열 수 있습니다.

### 주요 섹션

#### start_patterns / end_patterns
발화 로그 블록의 경계를 정의하는 정규식 배열.
```json
{
  "start_patterns": ["cmd_from_mockapp", "REQUEST OPEN SERVER"],
  "end_patterns":   ["Process Finished!"]
}
```

#### utterance_patterns
발화문 텍스트를 추출하는 패턴. `{value}` 자리에 캡처 그룹 값이 대입됩니다.
```json
{
  "utterance_patterns": {
    "my_pattern": {
      "pattern": "utterance=\\[([^\\]]+)\\]",
      "utterance": "{value}"
    }
  }
}
```

#### success_patterns / failure_patterns
성공/실패 판별 패턴. 하나라도 매칭되면 해당 결과가 테이블에 표시됩니다.
```json
{
  "success_patterns": ["result_code=success"],
  "failure_patterns": ["result_code=fail", "ERROR"]
}
```

#### pattern_groups
Sequence Diagram에 표시할 패턴 그룹. `PlantUML` 필드에 시퀀스 다이어그램 문법을 지정합니다.
```json
{
  "pattern_groups": {
    "ASR": {
      "name": "ASR",
      "patterns": [
        {
          "pattern": "kAsr2Response \\[FINAL\\] \\[([^\\]]+)\\]",
          "PlantUML": "App -> Server : ASR: {value}"
        }
      ]
    }
  }
}
```

#### clickable_patterns
특정 ID 값을 추출하여 클릭 시 브라우저에서 URL을 여는 패턴.
```json
{
  "clickable_patterns": {
    "conversationId": {
      "pattern": "conversationId\\[([^\\]]+)\\]",
      "url_template": "https://your-system.com/search?id={value}",
      "display_name": "ConversationID"
    }
  }
}
```

#### table_columns
결과 테이블에 표시할 열 목록과 순서.
```json
{
  "table_columns": [
    { "key": "utterance",       "label": "Utterance",        "width": 200 },
    { "key": "result",          "label": "Result",           "width": 80  },
    { "key": "conversationId",  "label": "Conversation ID",  "width": 120 }
  ]
}
```

#### 기타 옵션
```json
{
  "default_sdb_device":        "192.168.250.250:26101",
  "default_live_log_command":  "sdb -s {deviceId} shell dlogutil -v VOICE_CLIENT",
  "enable_result_judgment":    true
}
```

---

## 🗂️ 프리셋(Preset) 관리

| 동작 | 설명 |
|------|------|
| **🎛️ Preset 버튼** | 클릭하면 프리셋 메뉴 토글 |
| **📋 Patterns 버튼** | 현재 프리셋의 전체 패턴 목록 표시. Pattern Group 개별 ON/OFF 토글 가능 |
| **➕ Custom** | 로컬 JSON 파일을 불러와 새 프리셋으로 등록 (VILA 실행 폴더에서 탐색 시작) |
| **🔄 Reset** | 현재 프리셋을 내장 기본값으로 복원 |
| **🗑️ Delete** | 현재 프리셋 파일 삭제 (Default 프리셋은 삭제 불가) |
| **📂 Preset Config** | 프리셋 JSON 파일이 저장된 폴더 열기 |

- 프리셋을 전환하면 현재 열려있는 파일을 **새 설정으로 자동 재분석**.
- 여러 프리셋을 등록해두고 프로젝트 또는 로그 타입에 따라 원클릭 전환.

---

## 📡 Live 모드 상세

### 연결 흐름

```
VILA ──[sdb connect <ip>]──> 단말 연결
     ──[sdb root on]──────> root 권한 획득
     ──[sdb shell dlogutil]─> 실시간 로그 수신
```

### 버튼 설명

| 버튼 | 역할 |
|------|------|
| **🔌 Connect** | SDB 단말 자동 연결 (`sdb connect` + `sdb root on`) |
| **🔴 Start Live Log** | 로그 스트리밍 시작 |
| **⏸ Pause** | 화면 업데이트·파싱 일시정지 (SDB 프로세스 유지, 수신 데이터 버퍼 보존) |
| **▶ Resume** | 재개 — 버퍼 데이터 일괄 처리하여 손실 없이 복원 |
| **■ Stop** | 스트리밍 완전 종료 |
| **🗑 Clear** | Raw 로그 및 파싱 결과 초기화 |

### 뷰 전환
- **📋 Table**: 발화별 분석 결과 테이블
- **📈 Sequence**: 실시간 업데이트되는 Sequence Diagram

---

## 📊 Sequence Diagram 뷰

- `pattern_groups` 설정에 `PlantUML` 필드가 있는 항목이 다이어그램에 표시.
- **발화 구분자 클릭**: `#1: 발화문` 형식의 헤더를 클릭하면 해당 발화 상세 뷰 바로 오픈.
- **Note 복사**: Note 우상단 ⊞ 버튼 → 라인 번호(L2:) 제외 본문만 클립보드 복사.
- **📋 Patterns 패널**에서 Pattern Group OFF → 해당 그룹 화살표 즉시 숨김.

### PlantUML 문법 예시
```
App -> Server : {value}           // 화살표 (실선)
App --> Server : {value}          // 화살표 (점선)
note right of App : {value}       // Note
== 구분선 텍스트 ==               // 섹션 구분자
```

---

## ⌨️ 단축키 및 조작

| 단축키 / 조작 | 기능 |
|---------------|------|
| `Ctrl+V` | 클립보드 텍스트 붙여넣기 분석 |
| `Ctrl+F` | 앱 내 텍스트 검색 바 열기 |
| `Ctrl++` / `Ctrl+-` | 화면 줌 인/아웃 |
| `Ctrl+스크롤` | 화면 줌 인/아웃 |
| `Esc` | 모달 / 검색 바 닫기 |
| 테이블 행 클릭 | 발화 상세 뷰 오픈 |
| Sequence 구분자 클릭 | 해당 발화 상세 뷰 오픈 |
| Note ⊞ 버튼 클릭 | Note 텍스트 복사 (라인번호 제외) |
| 컬럼 헤더 경계 드래그 | 컬럼 너비 조절 |
| 컬럼 헤더 클릭 | 정렬 (오름/내림/해제 순환) |

---

## 🏗️ 빌드 및 배포

### 의존성 설치 및 실행

```bash
npm install       # 의존성 설치
npm start         # 개발 모드 실행
```

> **팁**: Live Log 모드 UI 테스트 시 SDB 없이 `node mock-sdb.js` 명령어를 Live Log Command에 입력하면 가상 로그 스트리밍을 테스트할 수 있습니다.

### 빌드

```bash
npm run build           # Windows 인스톨러 (.exe Setup)
npm run build:portable  # 무설치 단일 실행 파일 (Portable .exe)
```

빌드 결과물은 `dist/` 폴더에 생성됩니다.

### 배포 워크플로우

VILA는 소스 저장소(`VILA`, Private)와 배포 저장소(`VILA_Release`, Public)를 분리하여 운영합니다.

1. `npm run build`로 생성된 `Setup.exe`를 `VILA_Release` 저장소의 새 릴리스에 업로드.
2. 앱에 내장된 자동 업데이트 로직이 해당 릴리스를 감지하고 다운로드.

---

## 📂 프로젝트 구조

```text
VILA/
├── .github/                          # GitHub Actions 워크플로우
├── css/
│   └── styles.css                    # 전체 UI 스타일시트
├── js/
│   └── renderer.js                   # 파싱·스트리밍·테이블·SVG 렌더링 (프론트엔드 메인 로직)
├── scripts/
│   └── update-build-time.js          # 빌드 타임 주입 유틸리티
├── main.js                           # Electron 메인 프로세스 (윈도우·파일 IO·SDB child_process)
├── preload.js                        # 메인↔렌더러 IPC 브릿지 (Context Isolation)
├── index.html                        # 앱 메인 레이아웃 및 뷰
├── default_config.json               # 최초 실행 시 %APPDATA%로 복사되는 기본 설정 템플릿
├── Preset0_CmdMyBixby_pattern_config.json   # 내장 프리셋 예시
├── Preset1_kAsr2Response_pattern_config.json
├── mock-sdb.js                       # 개발·테스트용 가상 SDB 스트리밍 스크립트
└── package.json                      # 버전·의존성·electron-builder 설정
```

---

## 🔖 버전 히스토리

| 버전 | 주요 변경 내용 |
|------|--------------|
| **v1.8.0** | 멀티 인스턴스, Pattern 개별 ON/OFF, SDB Connect 버튼, Live Pause/Resume, Ctrl+F 검색, Sequence 발화 헤더 클릭, Note 복사 라인번호 제거, Custom Preset 초기 경로 |
| v1.7.4 | Note 패딩·수직 정렬 수정 |
| v1.7.3 | Sequence Diagram 레이아웃·UX 개선 |
| v1.7.2 | Sequence Diagram 간격 조정 |
| v1.7.1 | Note 텍스트 좌측정렬·흰색, 구분선 `== ==`, hidden arrow 지원 |

---

## 📄 라이선스

MIT License — © VD Division
