const fs = require('fs');
const path = require('path');

// Generate timestamp in YYMMDDhhmm format
function generateBuildTime() {
  const now = new Date();
  
  // YYMMDDhhmm format
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  
  return `${yy}${mm}${dd}${hh}${min}`;
}

const buildTime = generateBuildTime();
const buildTimePath = path.join(__dirname, '..', 'build-time.json');

try {
  fs.writeFileSync(buildTimePath, JSON.stringify({ buildTime }, null, 2), 'utf-8');
  console.log(`Build time updated: ${buildTime}`);
} catch (err) {
  console.error('Failed to update build time:', err);
  process.exit(1);
}
