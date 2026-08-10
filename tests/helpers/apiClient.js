/**
 * API Client для интеграционных тестов
 * Используется в сценариях для вызова API
 */

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5001';

class TestApiClient {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
    this.token = null;
  }

  /**
   * Устанавливает токен авторизации
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * Выполняет HTTP запрос
   */
  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const options = {
      method,
      headers
    };

    if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json();
      
      return {
        status: response.status,
        ok: response.ok,
        data: data.data || data,
        error: data.error,
        success: data.success
      };
    } catch (error) {
      return {
        status: 0,
        ok: false,
        error: error.message,
        success: false
      };
    }
  }

  // Convenience methods
  get(path) {
    return this.request('GET', path);
  }

  post(path, body) {
    return this.request('POST', path, body);
  }

  patch(path, body) {
    return this.request('PATCH', path, body);
  }

  put(path, body) {
    return this.request('PUT', path, body);
  }

  delete(path) {
    return this.request('DELETE', path);
  }

  // Auth shortcuts
  async register(userData) {
    const result = await this.post('/api/v3/auth/register', userData);
    if (result.ok && result.data?.token) {
      this.setToken(result.data.token);
    }
    return result;
  }

  async login(email, password) {
    const result = await this.post('/api/v3/auth/login', { email, password });
    if (result.ok && result.data?.token) {
      this.setToken(result.data.token);
    }
    return result;
  }

  async me() {
    return this.get('/api/v3/auth/me');
  }

  // Health check
  async health() {
    return this.get('/api/v3/system/health');
  }
}

export function createApiClient(baseUrl) {
  return new TestApiClient(baseUrl);
}

export default TestApiClient;
