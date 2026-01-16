// Thermostat control logic
import * as db from './db.js';
import * as nest from './nest.js';

const DEFAULT_TARGET_TEMP = parseFloat(process.env.TARGET_TEMP) || 70;
const THRESHOLD = parseFloat(process.env.THRESHOLD) || 1.5;
const FAN_ALWAYS_ON = process.env.FAN_ALWAYS_ON === 'true';
const FAN_TIMER_DURATION = 43200; // 12 hours in seconds

export function getTargetTemp() {
  return db.getStateValue('target_temp') ?? DEFAULT_TARGET_TEMP;
}

export function setTargetTemp(temp) {
  db.setState('target_temp', temp);
}

export function getFanAlwaysOn() {
  return db.getStateValue('fan_always_on') ?? FAN_ALWAYS_ON;
}

export function setFanAlwaysOn(enabled) {
  db.setState('fan_always_on', enabled);
}

export async function evaluateAndControl(readings) {
  const TARGET_TEMP = getTargetTemp();
  // Filter out null readings
  const validReadings = readings.filter(r => r && r.temperature !== null);

  if (validReadings.length === 0) {
    console.log('[Controller] No valid sensor readings, skipping');
    db.setState('last_error', 'No valid sensor readings');
    return null;
  }

  // Calculate average temperature
  const avgTemp = validReadings.reduce((sum, r) => sum + r.temperature, 0) / validReadings.length;

  // Save readings to DB (including air quality data)
  for (const reading of validReadings) {
    const extras = {};
    if (reading.voc !== undefined) extras.voc = reading.voc;
    if (reading.co2 !== undefined) extras.co2 = reading.co2;
    if (reading.pm25 !== undefined) extras.pm25 = reading.pm25;
    if (reading.radon !== undefined) extras.radon = reading.radon;
    db.saveReading(reading.source, reading.temperature, reading.humidity, extras);
  }

  // Update state
  db.setState('avg_temp', avgTemp);
  db.setState('target_temp', TARGET_TEMP);
  db.setState('threshold', THRESHOLD);
  db.setState('sensor_count', validReadings.length);
  db.setState('last_check', new Date().toISOString());

  console.log(`[Controller] Avg: ${avgTemp.toFixed(1)}°F, Target: ${TARGET_TEMP}°F ±${THRESHOLD}°F`);

  // Determine action needed
  let action = null;
  let reason = null;

  const diff = avgTemp - TARGET_TEMP;

  if (diff < -THRESHOLD) {
    // Too cold, need heating
    action = 'HEAT';
    reason = `Avg temp ${avgTemp.toFixed(1)}°F is ${Math.abs(diff).toFixed(1)}° below target`;
  } else if (diff > THRESHOLD) {
    // Too hot, need cooling
    action = 'COOL';
    reason = `Avg temp ${avgTemp.toFixed(1)}°F is ${diff.toFixed(1)}° above target`;
  } else {
    // Within range
    action = 'MAINTAIN';
    reason = `Avg temp ${avgTemp.toFixed(1)}°F is within ${THRESHOLD}° of target`;
  }

  console.log(`[Controller] Action: ${action} - ${reason}`);

  // Get current Nest state
  const nestState = await nest.getThermostatState();
  db.setState('nest_state', nestState);

  // Save Nest reading to DB (like sensor readings)
  if (nestState) {
    const nestExtras = {
      hvacStatus: nestState.hvacStatus,
      fanRunning: nestState.fanRunning,
      mode: nestState.mode,
      setpointHeat: nestState.setpointHeat,
      setpointCool: nestState.setpointCool
    };
    db.saveReading('nest', nestState.temperature, nestState.humidity, nestExtras);

    // Keep fan running 24/7 if enabled
    if (getFanAlwaysOn() && !nestState.fanRunning) {
      console.log('[Controller] Fan not running, renewing timer for 24/7 operation');
      await nest.setFanTimer(FAN_TIMER_DURATION);
    }
  }

  // Execute action if Nest is configured
  if (nest.isConfigured() && nestState) {
    const currentMode = nestState.mode;

    if (action === 'HEAT') {
      if (currentMode !== 'HEAT') {
        console.log('[Controller] Switching Nest to HEAT mode');
        await nest.setMode('HEAT');
      }
      // Always update setpoint to match target
      const currentSetpoint = nestState.setpointHeat;
      if (Math.abs(currentSetpoint - TARGET_TEMP) > 0.5) {
        console.log(`[Controller] Updating heat setpoint from ${currentSetpoint?.toFixed(1)}°F to ${TARGET_TEMP}°F`);
        await nest.setHeatTemp(TARGET_TEMP);
      }
      if (currentMode !== 'HEAT') {
        db.saveAction('SET_HEAT', reason, avgTemp, TARGET_TEMP);
      }
    } else if (action === 'COOL') {
      if (currentMode !== 'COOL') {
        console.log('[Controller] Switching Nest to COOL mode');
        await nest.setMode('COOL');
      }
      // Always update setpoint to match target
      const currentSetpoint = nestState.setpointCool;
      if (Math.abs(currentSetpoint - TARGET_TEMP) > 0.5) {
        console.log(`[Controller] Updating cool setpoint from ${currentSetpoint?.toFixed(1)}°F to ${TARGET_TEMP}°F`);
        await nest.setCoolTemp(TARGET_TEMP);
      }
      if (currentMode !== 'COOL') {
        db.saveAction('SET_COOL', reason, avgTemp, TARGET_TEMP);
      }
    } else if (action === 'MAINTAIN') {
      // Optionally turn off if within range
      // Uncomment to enable auto-off behavior:
      // if (currentMode !== 'OFF') {
      //   await nest.setMode('OFF');
      //   db.saveAction('SET_OFF', reason, avgTemp, TARGET_TEMP);
      // }
      db.saveAction('MAINTAIN', reason, avgTemp, TARGET_TEMP);
    }
  } else {
    // Log action even if Nest not configured
    db.saveAction(action, reason, avgTemp, TARGET_TEMP);
  }

  db.setState('last_action', action);
  db.setState('last_reason', reason);

  return { action, reason, avgTemp, readings: validReadings };
}
