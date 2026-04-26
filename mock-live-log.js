/**
 * mock-live-log.js - VILA Mock Live Log Server
 *
 * Use as: default_live_log_command = "node mock-live-log.js"
 *
 * Simulates a dlogutil stream. Waits for utterances queued by mock-live-test.js
 * and generates realistic voice-interaction log lines for each.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const QUEUE_FILE = path.join(os.tmpdir(), 'vila_mock_queue.json');
const STATE_FILE = path.join(os.tmpdir(), 'vila_mock_state.json');

// Reset queue on startup
try { fs.writeFileSync(QUEUE_FILE, '[]', 'utf-8'); } catch (e) {}
try { fs.writeFileSync(STATE_FILE, JSON.stringify({ resetNext: true }), 'utf-8'); } catch (e) {}

let processedCount = 0;
let currentConvId = null;
let requestSeq = 0;
let busy = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ts() {
  const now = new Date();
  return (
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + '-' +
    now.getFullYear() + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0') + '.' +
    String(now.getMilliseconds()).padStart(3, '0')
  );
}

function logLine(tag, msg) {
  process.stdout.write(`[${ts()}] D/${tag}: ${msg}\n`);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function newConvId() {
  const now = new Date();
  const d =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  const r = Math.floor(Math.random() * 1e9).toString().padStart(9, '0');
  return `tr-${d}${ms}.${r}`;
}

// ── Mock Response Table ───────────────────────────────────────────────────────

const RESPONSES = [
  { keys: ['날씨', '기온', 'weather'],        capsule: 'weather.get',      dialog: '오늘 서울의 날씨는 맑고 기온은 최고 18°C 예상됩니다.' },
  { keys: ['내일', '모레', 'tomorrow'],        capsule: 'weather.tomorrow',  dialog: '내일은 흐리고 오후에 비가 올 수 있습니다.' },
  { keys: ['음악', 'music', '틀어', '재생'],   capsule: 'music.play',       dialog: '요청하신 음악을 재생합니다.' },
  { keys: ['알람', '알림', 'reminder'],        capsule: 'reminder.set',     dialog: '알림을 설정했습니다.' },
  { keys: ['검색', 'search', '찾아'],          capsule: 'search.web',       dialog: '검색 결과를 보여드립니다.' },
  { keys: ['안녕', 'hello', 'hi'],             capsule: 'greeting',         dialog: '안녕하세요! 무엇을 도와드릴까요?' },
  { keys: ['시간', '몇시', 'time'],            capsule: 'clock.query',      dialog: `현재 시각은 ${new Date().getHours()}시 ${new Date().getMinutes()}분입니다.` },
  { keys: ['볼륨', '소리', 'volume'],          capsule: 'device.volume',    dialog: '볼륨을 조절했습니다.' },
];

function getResponse(utterance) {
  const lower = utterance.toLowerCase();
  for (const r of RESPONSES) {
    if (r.keys.some(k => lower.includes(k))) return r;
  }
  return { capsule: 'general.query', dialog: `"${utterance}"에 대한 응답입니다.` };
}

// ── Utterance Processor ───────────────────────────────────────────────────────

async function processItem(item) {
  const { utterance, resetConv } = item;

  if (resetConv || !currentConvId) {
    currentConvId = newConvId();
    requestSeq = 0;
  }
  requestSeq++;
  const reqId = `req-${String(requestSeq).padStart(3, '0')}-${Date.now().toString().slice(-4)}`;
  const resp = getResponse(utterance);

  logLine('VOICE_CLIENT', `cmd_from_mockapp, ${utterance}`);
  await delay(50 + Math.random() * 30);
  logLine('VOICE_CLIENT', `conversationId[${currentConvId}]`);
  await delay(30 + Math.random() * 20);
  logLine('VOICE_CLIENT', `requestId[${reqId}]`);
  await delay(80 + Math.random() * 40);
  logLine('VOICE_CLIENT', `GetConfig: mock-voice-config v0.1 (mock mode)`);
  await delay(120 + Math.random() * 80);
  logLine('VOICE_CLIENT', `setExecutionCapsuleGoal(1) > ${resp.capsule}`);
  await delay(200 + Math.random() * 150);
  logLine('VOICE_CLIENT', `MakeMetaDataParams server=mock-dev locale=ko-KR`);
  await delay(300 + Math.random() * 200);
  logLine('VOICE_CLIENT', `DialogText: ${resp.dialog}`);
  await delay(60 + Math.random() * 40);
  logLine('VOICE_CLIENT', `PROCESS ACTION URL: intent://mock/${resp.capsule}`);
  await delay(50 + Math.random() * 30);
  logLine('VOICE_CLIENT', `result_code[SUCCESS]`);
  await delay(40);
  logLine('VOICE_CLIENT', `GRPC CLOSE OUT`);
}

// ── Queue Poller ──────────────────────────────────────────────────────────────

async function poll() {
  if (!busy) {
    try {
      const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
      const queue = JSON.parse(content);
      if (queue.length > processedCount) {
        busy = true;
        const newItems = queue.slice(processedCount);
        processedCount = queue.length;
        for (const item of newItems) {
          await processItem(item);
          await delay(100);
        }
        busy = false;
      }
    } catch (e) {
      busy = false;
    }
  }
  setTimeout(poll, 150);
}

// ── Start ─────────────────────────────────────────────────────────────────────

logLine('VOICE_CLIENT', '[MOCK] Vila Mock Live Log started — waiting for utterances');
poll();
