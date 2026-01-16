#!/usr/bin/env node
// Development runner with auto-restart on file changes
// Usage: node dev.js

import { spawn } from 'child_process';
import { watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, 'src');

let child = null;
let restartTimeout = null;

function start() {
  console.log('\n\x1b[36m[dev] Starting app...\x1b[0m\n');

  child = spawn('node', ['src/index.js'], {
    cwd: __dirname,
    stdio: 'inherit'
  });

  child.on('exit', (code) => {
    if (code !== null) {
      console.log(`\n\x1b[33m[dev] Process exited with code ${code}\x1b[0m`);
    }
  });
}

function restart() {
  if (restartTimeout) {
    clearTimeout(restartTimeout);
  }

  // Debounce restarts
  restartTimeout = setTimeout(() => {
    console.log('\n\x1b[33m[dev] File changed, restarting...\x1b[0m');

    if (child) {
      child.kill();
      child.on('exit', () => {
        start();
      });
    } else {
      start();
    }
  }, 100);
}

// Watch src directory for changes
watch(srcDir, { recursive: true }, (eventType, filename) => {
  if (filename && filename.endsWith('.js')) {
    console.log(`\x1b[90m[dev] Changed: ${filename}\x1b[0m`);
    restart();
  }
});

// Also watch .env file
watch(__dirname, (eventType, filename) => {
  if (filename === '.env') {
    console.log(`\x1b[90m[dev] Changed: .env\x1b[0m`);
    restart();
  }
});

console.log('\x1b[36m[dev] Watching for changes in src/*.js and .env\x1b[0m');
console.log('\x1b[36m[dev] Press Ctrl+C to stop\x1b[0m');

start();

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\x1b[36m[dev] Shutting down...\x1b[0m');
  if (child) {
    child.kill();
  }
  process.exit(0);
});
