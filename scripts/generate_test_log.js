const fs = require('fs');
const path = require('path');

// 생성될 로그 파일 경로
const destFile = path.join(__dirname, '..', 'test_cmd_mybixby_large.log');
const stream = fs.createWriteStream(destFile);

// 시작 시간 설정 (테스트용)
const startTime = new Date('2026-05-20T10:00:00.000');

console.log(`Generating log file: ${destFile}`);

for (let i = 1; i <= 100; i++) {
    // 5의 배수마다 결함이 있는 테스트 케이스 생성
    let missingType = null;
    if (i % 5 === 0) {
        const typeIndex = (i / 5) % 5;
        // 0: ResultCode 누락 (25, 50...)
        // 1: Goal/Utterance 누락 (5, 30...)
        // 2: ConversationID 누락 (10, 35...)
        // 3: Action/URL 누락 (15, 40...)
        // 4: DialogText 누락 (20, 45...)
        if (typeIndex === 0) missingType = 'NO_RESULT';
        if (typeIndex === 1) missingType = 'NO_GOAL';
        if (typeIndex === 2) missingType = 'NO_CONV_ID';
        if (typeIndex === 3) missingType = 'NO_ACTION';
        if (typeIndex === 4) missingType = 'NO_DIALOG';
    }
    
    // 타임스탬프 포맷팅 (MM-DD HH:mm:ss.ms)
    const currentTime = new Date(startTime.getTime() + i * 1000); // 1초 간격
    const tsStr = currentTime.toISOString();
    const ts = tsStr.slice(5, 10) + ' ' + tsStr.slice(11, 23); // "05-20 10:00:01.000"

    // 1. Start Pattern & Utterance
    if (missingType === 'NO_GOAL') {
        // Goal 누락: 콤마 뒤 내용 없음
        stream.write(`${ts} I/VOICE_CLIENT ( 1000): cmd_from_mockapp\n`);
    } else {
        stream.write(`${ts} I/VOICE_CLIENT ( 1000): cmd_from_mockapp, Test Utterance ${i}\n`);
    }

    // 2. Conversation ID
    if (missingType !== 'NO_CONV_ID') {
        stream.write(`${ts} I/VOICE_CLIENT ( 1000): conversationId[conv-id-test-${String(i).padStart(3, '0')}]\n`);
    }
    
    // 3. Request ID (항상 존재)
    stream.write(`${ts} I/VOICE_CLIENT ( 1000): requestId[req-id-${String(i).padStart(3, '0')}]\n`);
    
    // 4. CapsuleGoal (NO_GOAL일 때 누락)
    if (missingType !== 'NO_GOAL') {
        stream.write(`${ts} I/VOICE_CLIENT ( 1000): CapsuleGoal: PlayMusicIntent\n`);
    }

    // 5. Action, URL, Config
    if (missingType !== 'NO_ACTION') {
        stream.write(`${ts} I/VOICE_CLIENT ( 1000): Action: Bixby.AudioPlayer.Play\n`);
        stream.write(`${ts} I/VOICE_CLIENT ( 1000): URL: https://bixby.audio/play/track_${i}\n`);
        stream.write(`${ts} I/VOICE_CLIENT ( 1000): config: { "volume": 80, "shuffle": true }\n`);
    }

    // 6. DialogText
    if (missingType !== 'NO_DIALOG') {
        stream.write(`${ts} I/VOICE_CLIENT ( 1000): DialogText: Playing music for you.\n`);
    }
    
    // 7. 결과 (NO_RESULT일 때 누락 -> Unknown 상태 예상)
    if (missingType !== 'NO_RESULT') {
        stream.write(`${ts} I/VOICE_CLIENT ( 1000): result_code=success\n`);
    }

    // 8. 종료 패턴
    stream.write(`${ts} I/VOICE_CLIENT ( 1000): Process Finished!\n`);
}

stream.end();
console.log('Done! 100 utterances generated.');