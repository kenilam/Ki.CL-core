/**
 * The access token lasts 15 minutes. The refresh token lasts until midnight on
 * the 8th day, or the 9th when it's issued at 23:45 or later.
 */

const ACCESS_TOKEN_MS = 15 * 60 * 1000;

const GRACE_MINUTES = 15;

function getNextMidnight(fromDate: Date = new Date()): Date {
  const midnight = new Date(fromDate);
  midnight.setHours(0, 0, 0, 0);
  midnight.setDate(midnight.getDate() + 1);
  return midnight;
}

function isAfterGracePeriod(date: Date): boolean {
  return date.getHours() === 23 && date.getMinutes() >= 60 - GRACE_MINUTES;
}

export function getAccessTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + ACCESS_TOKEN_MS);
}

export function getRefreshTokenExpiry(now: Date = new Date()): Date {
  const midnight = getNextMidnight(now);

  midnight.setDate(midnight.getDate() + 7);

  if (isAfterGracePeriod(now)) {
    midnight.setDate(midnight.getDate() + 1);
  }

  return midnight;
}
