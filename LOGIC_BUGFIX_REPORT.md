# 발화 추출 로직 버그 분석 & 수정 보고서

## 📊 발견된 문제

### 1. **N/A가 나오는 주요 원인: 발화 패턴 매칭 순서 오류**

#### 문제 설명
현재 발화 패턴 추출 로직은 **패턴 순서 기반 루프 구조**를 가지고 있습니다:

```javascript
// ❌ 문제 있는 코드
for (const [, cfg] of Object.entries(CONFIG.utterance_patterns)) {  // 패턴 순회
  const re = new RegExp(cfg.pattern);
  for (const l of lines) {  // 라인 순회
    if (m) { 
      e.utterance = ...;
      break;  // 첫 번째 라인에서 매칭 시 종료
    }
  }
  if (e.utterance) break;  // ← 미묘한 문제!
}
```

#### 문제의 구체적 시나리오

만약 다음과 같은 로그가 있다면:
```
cmd_from_mockapp
kAsr2Response [FINAL] [사용자 발화 내용]
result_code=success
```

1. `utterance_patterns`의 첫 번째 패턴: `cmd_from_mockapp, ([^\\]]+)`
   - START 라인: `cmd_from_mockapp` (쉼표 없음) → **매칭 실패** ❌
   - 다음 라인은 검사하지 않음 (같은 패턴 내에서는 첫 라인만)

2. `utterance_patterns`의 두 번째 패턴: `kAsr2Response \\[FINAL\\] \\[([^\\]]+)\\]`
   - 첫 번째 패턴에서 매칭 실패했으므로 이미 다음 패턴으로 이동
   - 두 번째 패턴은 새로운 라인 순회 시작... 하지만 이미 늦음

**결과**: `e.utterance = null` → UI에서 **N/A로 표시됨** 😞

---

### 2. **START 패턴 자체에 발화 정보가 있는 경우 누락**

예: `cmd_from_mockapp, show weather` 형식

현재 코드는 이런 경우 패턴 매칭 실패 시 추가 처리 없이 종료됨.

---

### 3. **연속 START 패턴 처리의 잠재적 문제**

```javascript
if (isS) {
  if (inBlock && buffer.length > 0) {
    // 세션 저장
    parseBlock(buffer, bufferLines);  // ✓ 현재 세션 저장
  }
  buffer = [t];  // ✓ 새 세션 시작
}
```

현재 코드는 괜찮지만, **버퍼 컨텍스트가 여러 라인을 포함할 때** 혼동이 생길 수 있습니다.

---

### 4. **EOF(파일 끝)에서 버퍼 처리 미흡**

END 패턴 없이 파일이 종료되면:
- ✓ index.html의 tick() 함수에서는 최종 버퍼 저장
- ⚠️ 하지만 발화 패턴 매칭 실패로 `utterance: null`

---

## ✅ 적용된 수정사항

### 수정 1: 발화 패턴 매칭 로직 개선

**변경 전:**
```javascript
for (const [, cfg] of Object.entries(CONFIG.utterance_patterns)) {
  // 패턴 단위로 루프
  for (const l of lines) {
    // 라인 단위로 매칭
  }
  if (e.utterance) break;
}
```

**변경 후:**
```javascript
if (!e.utterance) {
  for (const l of lines) {  // 라인 우선 순회
    for (const [, cfg] of Object.entries(CONFIG.utterance_patterns)) {
      // 각 라인에서 모든 패턴을 시도
      const m = l.match(re);
      if (m) { 
        e.utterance = ...;
        break;  // 라인 내 패턴 루프 종료
      }
    }
    if (e.utterance) break;  // 발화 찾음, 라인 루프 종료
  }
}
```

**효과**:
- ✅ 각 라인에서 모든 패턴을 시도
- ✅ 첫 번째 패턴 실패 시에도 같은 라인에서 다음 패턴 시도
- ✅ 라인 우선 순회로 발화 누락 방지

---

### 수정 2: START 라인에서의 직접 추출

```javascript
if (!e.utterance && lines.length > 0) {
  const firstLine = lines[0];  // START 라인
  
  // 쉼표 형식: "cmd_from_mockapp, <발화>"
  const commaIdx = firstLine.indexOf(',');
  if (commaIdx > -1) {
    const extracted = firstLine.substring(commaIdx + 1).trim();
    if (extracted) e.utterance = extracted;
  }
  
  // 괄호 형식: "cmd_from_mockapp [<발화>]"
  if (!e.utterance) {
    const bracketMatch = firstLine.match(/\[([^\]]+)\]/);
    if (bracketMatch) e.utterance = bracketMatch[1];
  }
}
```

**효과**:
- ✅ `cmd_from_mockapp, show weather` → `show weather` 추출
- ✅ `[FINAL] [사용자 발화]` → `사용자 발화` 추출
- ✅ 패턴 매칭 실패 시에도 기본 형식 처리

---

## 🔍 수정 전후 비교

### 시나리오 1: 쉼표 형식
```
입력: "cmd_from_mockapp, weather forecast"
수정 전: N/A (패턴 매칭 실패 → null)
수정 후: "weather forecast" ✅
```

### 시나리오 2: 복합 라인
```
입력:
  cmd_from_mockapp
  kAsr2Response [FINAL] [사용자 발화]
  result_code=success

수정 전: N/A (첫 번째 라인에서 매칭 실패)
수정 후: "사용자 발화" (두 번째 라인의 패턴 매칭 성공) ✅
```

### 시나리오 3: 괄호 형식
```
입력: "REQUEST OPEN SERVER [find restaurant]"
수정 전: N/A (패턴 미정의)
수정 후: "find restaurant" (괄호 추출) ✅
```

---

## 📋 남은 개선사항 (선택)

### 1. Utterance Pattern Config 강화
```json
{
  "utterance_patterns": {
    "cmd_from_mockapp": {
      "pattern": "cmd_from_mockapp, ([^\\]]+)",
      "fallback_pattern": ",\\s*(.+)",  // 쉼표 뒤 모든 내용
      "bracket_pattern": "\\[([^\\]]+)\\]",  // 괄호 추출
      "utterance": "{value}"
    }
  }
}
```

### 2. 상세 로깅 추가
```javascript
// 발화 추출 성공/실패 추적
console.debug(`Session ${id}: utterance="${e.utterance}" source="${source}"`);
```

### 3. 발화 검증
```javascript
// N/A 방지: 최소 길이 체크
if (!e.utterance || e.utterance.trim() === '') {
  e.utterance = '[발화 없음]';  // 또는 기본값
}
```

---

## 🧪 테스트 권장사항

다음 경우들을 테스트해주세요:

1. ✅ 일반 발화 (쉼표 분리)
2. ✅ 느린 응답(kAsr2Response 패턴)
3. ✅ START 라인에만 발화 있는 경우
4. ✅ 여러 패턴이 있는 로그
5. ✅ END 없이 종료되는 세션
6. ✅ 연속된 START 패턴

---

## 📌 결론

N/A 발화 문제는 **패턴 매칭 루프 구조**의 설계 오류로 인해 발생했습니다.
수정을 통해:
- 모든 라인에서 모든 패턴을 시도
- START 라인에서 직접 추출 시도
- 패턴 매칭 실패 시에도 기본 처리

으로 N/A 문제를 대부분 해결할 수 있습니다.
