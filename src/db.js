// SQLite-based storage (Node.js 22+ built-in)
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'thermostat.db');

const db = new DatabaseSync(DB_PATH);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    temperature REAL,
    humidity REAL,
    voc REAL,
    co2 REAL,
    pm25 REAL,
    radon REAL,
    hvac_status TEXT,
    fan_running INTEGER,
    mode TEXT,
    setpoint_heat REAL,
    setpoint_cool REAL
  );

  CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    avg_temp REAL,
    target_temp REAL
  );

  CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp);
  CREATE INDEX IF NOT EXISTS idx_readings_source ON readings(source);
  CREATE INDEX IF NOT EXISTS idx_actions_timestamp ON actions(timestamp);
`);

function now() {
  return new Date().toISOString();
}

export function saveReading(source, temperature, humidity = null, extras = {}) {
  const stmt = db.prepare(`
    INSERT INTO readings (timestamp, source, temperature, humidity, voc, co2, pm25, radon, hvac_status, fan_running, mode, setpoint_heat, setpoint_cool)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    now(),
    source,
    temperature,
    humidity,
    extras.voc ?? null,
    extras.co2 ?? null,
    extras.pm25 ?? null,
    extras.radon ?? null,
    extras.hvacStatus ?? null,
    extras.fanRunning ? 1 : null,
    extras.mode ?? null,
    extras.setpointHeat ?? null,
    extras.setpointCool ?? null
  );
}

export function saveAction(action, reason, avgTemp, targetTemp) {
  const stmt = db.prepare(`
    INSERT INTO actions (timestamp, action, reason, avg_temp, target_temp)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(now(), action, reason, avgTemp, targetTemp);
}

export function setState(key, value) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO state (key, value, updated_at)
    VALUES (?, ?, ?)
  `);

  stmt.run(key, JSON.stringify(value), now());
}

export function getStateValue(key) {
  const stmt = db.prepare(`SELECT value FROM state WHERE key = ?`);
  const row = stmt.get(key);
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }
  return null;
}

export function getReadings(limit = 50) {
  const stmt = db.prepare(`SELECT * FROM readings ORDER BY id DESC LIMIT ?`);
  const rows = stmt.all(limit);
  return rows.map(rowToReading);
}

export function getReadingsSince(since) {
  const stmt = db.prepare(`SELECT * FROM readings WHERE timestamp >= ? ORDER BY id DESC`);
  const rows = stmt.all(since);
  return rows.map(rowToReading);
}

export function getActionsSince(since) {
  const stmt = db.prepare(`SELECT * FROM actions WHERE timestamp >= ? ORDER BY id DESC`);
  const rows = stmt.all(since);
  return rows.map(rowToAction);
}

export function getActions(limit = 20) {
  const stmt = db.prepare(`SELECT * FROM actions ORDER BY id DESC LIMIT ?`);
  const rows = stmt.all(limit);
  return rows.map(rowToAction);
}

export function getCurrentState() {
  const stmt = db.prepare(`SELECT * FROM state`);
  const rows = stmt.all();
  const state = {};
  for (const row of rows) {
    let value;
    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }
    state[row.key] = {
      value,
      updated_at: row.updated_at
    };
  }
  return state;
}

// Convert database row to reading object format
function rowToReading(row) {
  const reading = {
    id: row.id,
    timestamp: row.timestamp,
    source: row.source,
    temperature: row.temperature,
    humidity: row.humidity
  };

  // Add optional fields if present
  if (row.voc !== null) reading.voc = row.voc;
  if (row.co2 !== null) reading.co2 = row.co2;
  if (row.pm25 !== null) reading.pm25 = row.pm25;
  if (row.radon !== null) reading.radon = row.radon;
  if (row.hvac_status !== null) reading.hvacStatus = row.hvac_status;
  if (row.fan_running !== null) reading.fanRunning = row.fan_running === 1;
  if (row.mode !== null) reading.mode = row.mode;
  if (row.setpoint_heat !== null) reading.setpointHeat = row.setpoint_heat;
  if (row.setpoint_cool !== null) reading.setpointCool = row.setpoint_cool;

  return reading;
}

// Convert database row to action object format
function rowToAction(row) {
  return {
    id: row.id,
    timestamp: row.timestamp,
    action: row.action,
    reason: row.reason,
    avg_temp: row.avg_temp,
    target_temp: row.target_temp
  };
}
