/**
 * mock-reset-conv.js - VILA Mock ConversationID Reset
 *
 * Use as the command for PreConditionEach "Reset ConversationID":
 *   "command": "node mock-reset-conv.js"
 *
 * Sets a flag so the next mock-live-test.js call starts a new conversationId.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_FILE = path.join(os.tmpdir(), 'vila_mock_state.json');

fs.writeFileSync(STATE_FILE, JSON.stringify({ resetNext: true }), 'utf-8');
process.stdout.write('[MOCK] ConversationID will reset on next test\n');
process.stdout.write('done\n');
