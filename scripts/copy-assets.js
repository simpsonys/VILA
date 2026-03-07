const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..');
const distDir = path.join(__dirname, '../dist');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
}

const foldersToCopy = ['css', 'js'];
const filesToCopy = ['index.html'];

for (const folder of foldersToCopy) {
    fs.cpSync(path.join(srcDir, folder), path.join(distDir, folder), { recursive: true });
}

for (const file of filesToCopy) {
    fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
}

console.log('Assets copied to dist folder.');
