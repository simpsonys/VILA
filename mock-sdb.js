const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'Sample2.Log');
const logLines = fs.readFileSync(logFilePath, 'utf-8').split(/\r?\n/);

let currentIndex = 0;

function streamLog() {
    if (currentIndex < logLines.length) {
        console.log(logLines[currentIndex]);
        currentIndex++;
        setTimeout(streamLog, 1000); // 1-second delay
    }
}

streamLog();
