// ============================================================
// PES Brain — LLM Adapter
// ============================================================
// Wraps OpenAI-compatible API (GPT-4o-mini) for generating
// unique, personality-driven responses.
//
// Fallback: returns null → caller uses template responses.
// Dependencies: 0 (uses built-in fetch)
// ============================================================

const DEFAULT_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT = 5000; // 5s max
const DEFAULT_MAX_TOKENS = 200;

export class LLMAdapter {
  /**
   * @param {Object} config
   * @param {string} config.apiKey       — OpenAI API key
   * @param {string} [config.model]      — model ID (default: gpt-4o-mini)
   * @param {string} [config.apiUrl]     — API endpoint URL
   * @param {number} [config.timeout]    — request timeout in ms
   * @param {number} [config.maxTokens]  — max tokens in response
   */
  constructor(config = {}) {
    if (!config.apiKey) throw new Error('LLMAdapter: apiKey required');

    this.apiKey = config.apiKey;
    this.model = config.model || DEFAULT_MODEL;
    this.apiUrl = config.apiUrl || DEFAULT_API_URL;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.maxTokens = config.maxTokens || DEFAULT_MAX_TOKENS;

    this._requestCount = 0;
    this._errorCount = 0;
  }

  /**
   * Generate a response from LLM.
   * @param {string} systemPrompt — character & context
   * @param {Array<{role: string, content: string}>} messages — conversation history
   * @returns {Promise<string|null>} — generated text or null on failure
   */
  async generate(systemPrompt, messages) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      this._requestCount++;

      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          max_tokens: this.maxTokens,
          temperature: 0.9,
          top_p: 0.95,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        this._errorCount++;
        return null;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      return text || null;

    } catch (err) {
      clearTimeout(timer);
      this._errorCount++;
      return null; // fallback to templates
    }
  }

  /**
   * Classify intent from text. Low temperature, JSON response.
   * @param {string} systemPrompt — classification instructions
   * @param {string} userText — owner's message
   * @returns {Promise<Object|null>} — parsed JSON or null
   */
  async classify(systemPrompt, userText) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000); // 4s max for classify

    try {
      this._requestCount++;

      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
          ],
          max_tokens: 150,
          temperature: 0.1,
          top_p: 0.9,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        this._errorCount++;
        return null;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) return null;

      // Parse JSON from response (handle markdown code blocks)
      const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '');
      return JSON.parse(jsonStr);

    } catch (err) {
      clearTimeout(timer);
      this._errorCount++;
      return null;
    }
  }

  /** Stats for monitoring */
  get stats() {
    return {
      requests: this._requestCount,
      errors: this._errorCount,
      errorRate: this._requestCount > 0
        ? (this._errorCount / this._requestCount * 100).toFixed(1) + '%'
        : '0%',
    };
  }
}
