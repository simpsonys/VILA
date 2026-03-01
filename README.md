# Voice Interaction Log Analyzer - Desktop App

음성 인터랙션 로그를 발화(utterance) 단위로 분석하여 리포트를 생성하는 도구입니다.

## 기능
- **로그 파일 분석**: 드래그앤드롭, 파일선택, 클립보드 붙여넣기 (Ctrl+V) 지원
- **자동 인코딩 감지**: UTF-8, EUC-KR, UTF-16 자동 감지
- **실시간 스트리밍 파싱**: 대용량 로그도 실시간 결과 표시
- **Configurable**: `pattern_config.json`으로 패턴, 테이블 컬럼 설정 가능
- **HTML + JSON Export**: 분석 결과를 HTML 리포트 + JSON 데이터로 내보내기
- **Clickable 패턴**: ConversationID 등 클릭 시 외부 URL 연결
- **Dark Theme UI**: 개발자 친화적 다크 테마

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

## Config 파일

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
