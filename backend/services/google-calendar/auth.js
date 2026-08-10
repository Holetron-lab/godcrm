/**
 * Google Calendar — Authentication & Status
 *
 * getAuthUrl, handleCallback, getOAuth2Client, getConnectionStatus, disconnectCalendar
 */

import { google } from 'googleapis';
import axios from 'axios';
import { apiLogger } from '../../utils/logger.js';
import {
  loadConfig, encrypt, decrypt,
  getUserTokens, setUserTokens, removeUserTokens,
} from './helpers.js';

export function getAuthUrl(userId, redirectUri) {
  const config = loadConfig();
  if (!config) {
    throw new Error('Google OAuth config not available');
  }

  // Use the config redirectUri directly (should be the registered login OAuth redirect)
  // The /auth/google/callback handler will detect "calendar:" state prefix and route accordingly
  const calendarRedirect = redirectUri || config.redirectUri;

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    calendarRedirect
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    // Prefix state with "calendar:" so the shared callback can route to calendar handler
    state: `calendar:${userId}`,
  });

  return url;
}

export async function handleCallback(code, redirectUri, userId) {
  const config = loadConfig();
  if (!config) {
    throw new Error('Google OAuth config not available');
  }

  // Use the provided redirect_uri or fall back to config (the registered login OAuth redirect)
  // IMPORTANT: redirect_uri must match exactly what was used in getAuthUrl()
  const calendarRedirect = redirectUri || config.redirectUri;

  // Exchange authorization code for tokens
  const response = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: calendarRedirect,
    grant_type: 'authorization_code',
  });

  const { access_token, refresh_token, expires_in } = response.data;
  const tokenExpiry = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString();

  setUserTokens(userId, {
    refresh_token: refresh_token ? encrypt(refresh_token) : null,
    access_token,
    token_expiry: tokenExpiry,
    calendars: ['primary'], // Will be populated with all calendars on first sync
    syncAllCalendars: true, // Flag to sync ALL accessible calendars
  });

  apiLogger.info(`Google Calendar connected for user ${userId}`);

  // Fetch full calendar list and save IDs
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const res = await calendar.calendarList.list();
    const calIds = (res.data.items || []).map(c => c.id);
    if (calIds.length > 0) {
      setUserTokens(userId, {
        ...getUserTokens(userId),
        calendars: calIds,
      });
      apiLogger.info(`Saved ${calIds.length} calendar IDs for user ${userId}`);
    }
  } catch (err) {
    apiLogger.warn(`Could not fetch calendar list during connect for user ${userId}`, err);
  }

  return { connected: true };
}

export async function getOAuth2Client(userId) {
  const config = loadConfig();
  if (!config) {
    throw new Error('Google OAuth config not available');
  }

  const userTokens = getUserTokens(userId);
  if (!userTokens) {
    throw new Error(`No Google Calendar tokens found for user ${userId}`);
  }

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret
  );

  let accessToken = userTokens.access_token;
  const refreshToken = userTokens.refresh_token ? decrypt(userTokens.refresh_token) : null;

  // Check if access token is expired
  const isExpired = userTokens.token_expiry && new Date(userTokens.token_expiry) <= new Date();

  if (isExpired && refreshToken) {
    apiLogger.info(`Refreshing expired access token for user ${userId}`);
    try {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });

      accessToken = response.data.access_token;
      const newExpiry = new Date(Date.now() + (response.data.expires_in || 3600) * 1000).toISOString();

      // Update stored tokens with new access token
      setUserTokens(userId, {
        ...userTokens,
        access_token: accessToken,
        token_expiry: newExpiry,
      });
    } catch (err) {
      apiLogger.error(`Failed to refresh access token for user ${userId}`, err);
      throw new Error('Failed to refresh Google access token. Please reconnect.');
    }
  }

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  return oauth2Client;
}

export async function getConnectionStatus(userId) {
  const userTokens = getUserTokens(userId);
  if (!userTokens) {
    return { connected: false };
  }

  const hasRefreshToken = !!userTokens.refresh_token;
  const hasAccessToken = !!userTokens.access_token;
  const isExpired = userTokens.token_expiry && new Date(userTokens.token_expiry) <= new Date();

  return {
    connected: hasRefreshToken && hasAccessToken,
    hasRefreshToken,
    hasAccessToken,
    isExpired: !!isExpired,
    calendars: userTokens.calendars || [],
    tokenExpiry: userTokens.token_expiry || null,
  };
}

export function disconnectCalendar(userId) {
  removeUserTokens(userId);
  apiLogger.info(`Google Calendar disconnected for user ${userId}`);
  return { disconnected: true };
}
