// Healthchecks.io - external dead man's switch monitoring
const HEALTHCHECKS_URL = process.env.HEALTHCHECKS_URL;

// Track API failures
const apiStatus = {
  airthings: { healthy: true, lastError: null, consecutiveFailures: 0 },
  awair: { healthy: true, lastError: null, consecutiveFailures: 0 },
  nest: { healthy: true, lastError: null, consecutiveFailures: 0 }
};

const FAILURE_THRESHOLD = 3; // Alert after 3 consecutive failures

export function reportApiError(api, error) {
  const status = apiStatus[api];
  if (!status) return;

  status.consecutiveFailures++;
  status.lastError = error;

  if (status.consecutiveFailures >= FAILURE_THRESHOLD && status.healthy) {
    status.healthy = false;
    console.error(`[Notify] ${api.toUpperCase()} API marked unhealthy after ${FAILURE_THRESHOLD} failures`);
  }
}

export function reportApiSuccess(api) {
  const status = apiStatus[api];
  if (!status) return;

  if (!status.healthy) {
    console.log(`[Notify] ${api.toUpperCase()} API recovered`);
  }

  status.healthy = true;
  status.lastError = null;
  status.consecutiveFailures = 0;
}

export function getApiStatus() {
  return apiStatus;
}

export function getUnhealthyApis() {
  return Object.entries(apiStatus)
    .filter(([_, status]) => !status.healthy)
    .map(([api, status]) => ({ api, error: status.lastError }));
}

export async function pingHealthcheck() {
  if (!HEALTHCHECKS_URL) {
    return false;
  }

  try {
    const unhealthy = getUnhealthyApis();
    let url = HEALTHCHECKS_URL;
    let body = '';

    if (unhealthy.length > 0) {
      // Send failure ping with details
      url = `${HEALTHCHECKS_URL}/fail`;
      body = unhealthy.map(u => `${u.api}: ${u.error}`).join('\n');
    }

    const response = await fetch(url, {
      method: 'POST',
      body
    });

    if (!response.ok) {
      throw new Error(`Healthchecks ping failed: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error(`[Notify] Healthchecks ping failed: ${error.message}`);
    return false;
  }
}
