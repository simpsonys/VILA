# Tauri Migration Architecture Plan (Voice Log Analyzer)

## 1. 프레임워크 전환 (Electron -> Tauri)
- **완료된 작업**:
  - `feature/tauri-migration` 브랜치 생성 완료.
  - `@tauri-apps/cli` 설치 및 `src-tauri` 기본 구조 초기화 완료.
- **예정된 작업**:
  - `package.json`에서 `electron`, `electron-builder` 관련 의존성 제거.
  - `main.js` (Electron 메인 프로세스)와 `preload.js` (IPC 브릿지)를 제거하고 Tauri의 `src-tauri/src/main.rs` 및 `@tauri-apps/api` 로 대체.

## 2. 백엔드 구조 설계 (Rust)
로그 파싱 로직의 병목 현상을 해결하기 위해 무거운 작업은 Rust로 이관합니다.
- **파일 읽기 및 스트리밍**: 
  - Rust의 `std::fs::File` 및 `BufReader`를 사용하여 대용량 파일을 메모리에 모두 올리지 않고 청크 단위로 스트리밍합니다.
- **정규식 매칭 (Regex)**:
  - `regex` 크레이트를 활용하여 `start_patterns`, `end_patterns`, `success_patterns` 등의 필터링을 백엔드에서 수행합니다.
  - 가공된 최종 구조체(Utterance Data)만 직렬화(JSON)하여 프론트엔드로 전달합니다.
- **Tauri IPC**:
  - `#[tauri::command]` 매크로를 이용해 프론트엔드에서 호출할 수 있는 `open_log_file`, `parse_log_chunk` 커맨드를 구현합니다.

## 3. 프론트엔드 최적화 (가상 스크롤 및 Web Worker)
- **Web Worker 활용 (옵션)**:
  - 만약 Rust에서 완전히 가공된 데이터를 넘기는 대신 프론트엔드에서 일부 파싱을 해야 한다면, 메인 스레드 렌더링 블로킹을 막기 위해 Web Worker(`parser.js` 로직 이관)를 사용합니다.
  - Rust로 모두 이관하는 방안을 우선순위로 합니다. (가장 성능이 좋음)
- **Virtual Scrolling (가상 스크롤)**:
  - 현재 `js/renderer.js`의 `renderTable()` 함수는 수천~수만 줄의 DOM을 한 번에 생성합니다 (UI Freezing의 주원인).
  - 바닐라 JS 기반의 가상 스크롤 라이브러리(예: `clusterize.js`)를 도입하거나, Intersection Observer 기반의 커스텀 가상 스크롤을 구현하여 화면에 보이는 `<tr>` 요소만 렌더링하도록 `renderTable()` 로직을 수정합니다.

## 4. 진행 단계 (Next Steps)
1. **Phase 1**: `package.json` 정리 및 기존 Electron IPC(`window.electronAPI`)를 Tauri API로 래핑.
2. **Phase 2**: Rust 백엔드에 파일 파서 구조체(`LogParser`) 구현 및 Tauri 커맨드 노출.
3. **Phase 3**: `js/renderer.js`에 가상 스크롤 구현 (DOM 렌더링 최적화).
4. **Phase 4**: 빌드 최적화 및 테스트 (`npm run tauri build`).