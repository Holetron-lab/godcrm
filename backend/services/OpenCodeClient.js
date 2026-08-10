/**
 * OpenCode Client Service (ADR-024)
 * Backend service for communicating with OpenCode terminal agent server
 * 
 * OpenCode: https://github.com/sst/opencode
 * Headless server via `opencode serve --port 4096`
 * 
 * @module services/OpenCodeClient
 */

import { logger } from '../utils/logger.js';
import { getSecret } from './secrets/getSecret.js';

/**
 * OpenCode API Client
 * Connects to opencode serve HTTP API with Basic Auth
 */
class OpenCodeClient {
  /**
   * @param {Object} options
   * @param {string} options.baseUrl - OpenCode server URL (default: http://localhost:4096)
   * @param {string} options.username - HTTP Basic Auth username
   * @param {string} options.password - HTTP Basic Auth password
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.OPENCODE_SERVER_URL || 'http://localhost:4096';
    this.username = options.username || process.env.OPENCODE_SERVER_USERNAME || 'opencode';
    // ADR-0040: password resolved lazily via vault (with env fallback) at first request.
    this._explicitPassword = options.password || null;
    this._password = null;
    this._passwordResolved = false;

    // Test mode flag - when true, mock responses instead of real API calls
    this.testMode = process.env.TEST_MODE === 'true' || process.env.NODE_ENV === 'test';

    // Mock data storage for test mode
    this._mockSessions = new Map();
    this._mockMessages = new Map();
  }

  async _resolvePassword() {
    if (this._passwordResolved) return this._password;
    if (this._explicitPassword !== null) {
      this._password = this._explicitPassword;
    } else {
      this._password = (await getSecret('opencode_server_password', 'OPENCODE_SERVER_PASSWORD')) || '';
    }
    this._passwordResolved = true;
    return this._password;
  }

  /**
   * Get Basic Auth header value
   * @returns {Promise<string>} Base64 encoded credentials
   * @private
   */
  async _getAuthHeader() {
    const pwd = await this._resolvePassword();
    const credentials = Buffer.from(`${this.username}:${pwd}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Make HTTP request to OpenCode server
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {Object|null} data - Request body
   * @returns {Promise<Object>} Response data
   */
  async request(method, path, data = null) {
    // Test mode: return mock data
    if (this.testMode) {
      return this._handleMockRequest(method, path, data);
    }

    const url = `${this.baseUrl}${path}`;
    
    const options = {
      method,
      headers: {
        'Authorization': await this._getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      logger.debug({ method, url }, 'OpenCode API request');
      
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'OpenCode API error');
        throw new Error(`OpenCode API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      logger.debug({ path, status: response.status }, 'OpenCode API response');
      
      return result;
    } catch (error) {
      logger.error({ error: error.message, path }, 'OpenCode request failed');
      throw error;
    }
  }

  /**
   * Handle mock requests in test mode
   * @private
   */
  _handleMockRequest(method, path, data) {
    // Session endpoints
    if (path === '/session' && method === 'POST') {
      const id = `ses_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const session = {
        id,
        title: data?.title || 'Untitled Session',
        time: { created: Date.now(), updated: Date.now() }
      };
      this._mockSessions.set(id, session);
      this._mockMessages.set(id, []);
      return session;
    }

    if (path === '/session' && method === 'GET') {
      return Array.from(this._mockSessions.values());
    }

    // Session messages
    const sessionMessageMatch = path.match(/^\/session\/([^/]+)\/message$/);
    if (sessionMessageMatch && method === 'POST') {
      const sessionId = sessionMessageMatch[1];
      const messageId = `msg_${Date.now()}`;
      const message = {
        info: {
          id: messageId,
          role: 'user',
          time: { created: Date.now() }
        },
        parts: data?.parts || [{ type: 'text', text: data?.message || '' }]
      };
      
      const messages = this._mockMessages.get(sessionId) || [];
      messages.push(message);
      this._mockMessages.set(sessionId, messages);
      
      return { sent: true, messageId };
    }

    const getMessagesMatch = path.match(/^\/session\/([^/]+)\/message/);
    if (getMessagesMatch && method === 'GET') {
      const sessionId = getMessagesMatch[1];
      return this._mockMessages.get(sessionId) || [];
    }

    // Health check
    if (path === '/global/health' && method === 'GET') {
      return { status: 'ok', version: 'mock-1.0.0' };
    }

    // Default mock response
    return { mock: true, path, method };
  }

  // ============================================================
  // Session Management
  // ============================================================

  /**
   * Create a new session
   * @param {Object} options
   * @param {string} options.title - Session title
   * @param {string} options.parentId - Parent session ID for branching
   * @returns {Promise<Object>} Created session
   */
  async createSession({ title, parentId } = {}) {
    const payload = {};
    if (title) payload.title = title;
    if (parentId) payload.parentID = parentId;
    
    return this.request('POST', '/session', payload);
  }

  /**
   * List all sessions
   * @returns {Promise<Array>} List of sessions
   */
  async listSessions() {
    return this.request('GET', '/session');
  }

  /**
   * Get session by ID
   * @param {string} sessionId
   * @returns {Promise<Object>} Session details
   */
  async getSession(sessionId) {
    return this.request('GET', `/session/${sessionId}`);
  }

  /**
   * Delete a session
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  async deleteSession(sessionId) {
    return this.request('DELETE', `/session/${sessionId}`);
  }

  // ============================================================
  // Messages
  // ============================================================

  /**
   * Send message to session (synchronous - waits for response)
   * @param {string} sessionId
   * @param {Object} options
   * @param {Array} options.parts - Message parts [{type: 'text', text: '...'}]
   * @param {string} options.model - Model to use
   * @param {string} options.agent - Agent type (build, plan, general, explore)
   * @returns {Promise<Object>}
   */
  async sendMessage(sessionId, { parts, model, agent }) {
    return this.request('POST', `/session/${sessionId}/message`, {
      parts,
      model: model || 'opencode/big-pickle',
      agent: agent || 'build'
    });
  }

  /**
   * Send message asynchronously (doesn't wait for full response)
   * @param {string} sessionId
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async sendMessageAsync(sessionId, { parts, model, agent }) {
    return this.request('POST', `/session/${sessionId}/prompt_async`, {
      parts,
      model: model || 'opencode/big-pickle',
      agent: agent || 'build'
    });
  }

  /**
   * Get messages from session
   * @param {string} sessionId
   * @param {number} limit - Maximum messages to return
   * @returns {Promise<Array>}
   */
  async getMessages(sessionId, limit = 50) {
    return this.request('GET', `/session/${sessionId}/message?limit=${limit}`);
  }

  // ============================================================
  // Shell Execution
  // ============================================================

  /**
   * Run shell command in session
   * @param {string} sessionId
   * @param {string} command - Shell command to run
   * @param {string} agent - Agent context
   * @returns {Promise<Object>}
   */
  async runShell(sessionId, command, agent = 'build') {
    return this.request('POST', `/session/${sessionId}/shell`, {
      agent,
      command
    });
  }

  // ============================================================
  // Health & Status
  // ============================================================

  /**
   * Check server health
   * @returns {Promise<Object>}
   */
  async health() {
    return this.request('GET', '/global/health');
  }

  /**
   * Check if OpenCode server is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const opencodeClient = new OpenCodeClient();

// Export class for testing
export { OpenCodeClient };
