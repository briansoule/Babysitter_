# Thermostat Babysitter

Monitors temperature from Airthings View Plus and Awair Element sensors, then controls your Nest thermostat to maintain your target temperature.

**Zero dependencies** - uses only Node.js built-in modules.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your credentials
npm start
```

Dashboard: http://localhost:3000

## Setup

### 1. Awair Element (Local API - easiest)

1. Open Awair Home app
2. Go to Device Settings → Developer Option → Enable Local Sensors
3. Find your device IP in your router, or use mDNS: `http://awair-elem-XXXXXX.local`
4. Set `AWAIR_HOST` in `.env`

### 2. Airthings View Plus (Cloud API)

1. Go to https://dashboard.airthings.com/integrations/api-integration
2. Create an API client
3. Copy Client ID and Client Secret to `.env`
4. Find your device serial number in the dashboard URL or via API
5. Set `AIRTHINGS_DEVICE_ID` in `.env`

### 3. Google Nest (Smart Device Management API)

This requires more setup but gives full thermostat control:

1. Pay the one-time $5 fee at https://console.nest.google.com/device-access
2. Create a project in the Device Access Console
3. Create OAuth credentials in Google Cloud Console
4. Get a refresh token by completing the OAuth flow
5. Fill in the NEST_* variables in `.env`

Detailed guide: https://developers.google.com/nest/device-access/get-started

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| TARGET_TEMP | 70 | Target temperature in °F |
| THRESHOLD | 1.5 | Degrees from target before acting |
| POLL_INTERVAL | 60 | Seconds between sensor checks |
| PORT | 3000 | Dashboard port |

## How It Works

1. Polls both sensors every POLL_INTERVAL seconds
2. Averages the temperature readings
3. If average is THRESHOLD degrees below target → Heat
4. If average is THRESHOLD degrees above target → Cool
5. Logs everything to SQLite database (thermostat.db)
6. Dashboard shows current state and history

**Note:** The Nest's internal temperature sensor is assumed to be inaccurate. This app overrides the Nest by setting extreme setpoints to force HVAC on/off based on your external sensor readings.

## Running as a System Service (macOS)

To run the app at boot (even before login), install it as a LaunchDaemon:

### Install

```bash
# Copy app to system location
sudo mkdir -p /usr/local/babysitter
sudo cp -R ./* /usr/local/babysitter/

# Secure the .env file
sudo chmod 600 /usr/local/babysitter/.env
sudo chown root:wheel /usr/local/babysitter/.env

# Install the daemon
sudo cp com.babysitter.thermostat.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/com.babysitter.thermostat.plist
sudo chmod 644 /Library/LaunchDaemons/com.babysitter.thermostat.plist

# Start the daemon
sudo launchctl load /Library/LaunchDaemons/com.babysitter.thermostat.plist
```

### Manage

```bash
# Check status
sudo launchctl list | grep babysitter

# View logs
tail -f /var/log/babysitter.log
tail -f /var/log/babysitter.error.log

# Stop
sudo launchctl unload /Library/LaunchDaemons/com.babysitter.thermostat.plist

# Start
sudo launchctl load /Library/LaunchDaemons/com.babysitter.thermostat.plist

# Restart (after code changes)
sudo launchctl unload /Library/LaunchDaemons/com.babysitter.thermostat.plist
sudo launchctl load /Library/LaunchDaemons/com.babysitter.thermostat.plist
```

### Uninstall

```bash
sudo launchctl unload /Library/LaunchDaemons/com.babysitter.thermostat.plist
sudo rm /Library/LaunchDaemons/com.babysitter.thermostat.plist
sudo rm -rf /usr/local/babysitter
```

## Monitoring

The app pings Healthchecks.io after each polling cycle. If the process stops or any API fails repeatedly, you'll be notified.

Set `HEALTHCHECKS_URL` in `.env` to your Healthchecks.io ping URL.

## API

- `GET /` - HTML dashboard
- `GET /api/state` - JSON state and history

## Files

- `data.json` - Stores readings, actions, and state
- `.env` - Your configuration (copy from .env.example)
