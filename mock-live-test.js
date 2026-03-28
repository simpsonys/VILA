/**
 * mock-live-test.js - VILA Mock Test Command
 *
 * Use as: default_live_test_command = "node mock-live-test.js $utterance"
 *
 * Queues an utterance for mock-live-log.js to process.
 * Reads the resetNext flag set by mock-reset-conv.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const QUEUE_FILE = path.join(os.tmpdir(), 'vila_mock_queue.json');
const STATE_FILE = path.join(os.tmpdir(), 'vila_mock_state.json');

// Utterance is all args joined (handles spaces without quoting issues)
const utterance = process.argv.slice(2).join(' ').trim();

if (!utterance) {
  process.stderr.write('Usage: node mock-live-test.js <utterance>\n');
  process.exit(1);
}

// Read reset flag (set by mock-reset-conv.js) and clear it
let resetConv = false;
try {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  resetConv = !!state.resetNext;
  // Clear flag after reading
  fs.writeFileSync(STATE_FILE, JSON.stringify({ resetNext: false }), 'utf-8');
} catch (e) {
  resetConv = true; // default: reset on first run
}

// Append to queue
let queue = [];
try {
  queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
} catch (e) {
  queue = [];
}
queue.push({ utterance, resetConv, timestamp: Date.now() });
fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue), 'utf-8');

process.stdout.write(`[MOCK] Queued: "${utterance}" (resetConv: ${resetConv})\n`);
