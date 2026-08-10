/**
 * PES Soul — Traces ("Написала где-то")
 *
 * ПЕС оставляет ФИЗИЧЕСКИЕ следы в системе.
 * Не просто сообщения — реальные пометки в неожиданных местах:
 *   - Комментарий в коде
 *   - Запись в логе
 *   - Пометка на файле
 *   - Символ в неожиданном месте
 */

const TRACE_TYPES = {
  code_comment:     { format: '// 🐾 {message}',             where: 'source_file',   visibility: 'dev_only' },
  log_entry:        { format: '[PES] {message}',              where: 'system_log',    visibility: 'log_readers' },
  file_mark:        { format: '.pes_{hash}',                  where: 'project_root',  visibility: 'filesystem' },
  hidden_note:      { format: '<!-- 🐾 {message} -->',        where: 'html_file',     visibility: 'source_only' },
  metadata:         { format: '{ "pes_note": "{message}" }',  where: 'json_file',     visibility: 'data_layer' },
  console_message:  { format: '🐾 {message}',                 where: 'console',       visibility: 'runtime' },
  db_note:          { format: 'PES:{hash}:{message}',         where: 'database',      visibility: 'db_admin' },
};

class PesTrace {
  constructor(type, message, location, pesLevel) {
    this.type = type;
    this.message = message;
    this.location = location;
    this.pesLevel = pesLevel;
    this.timestamp = Date.now();
    this.id = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.discovered = false;
  }

  /** Рендер следа в формате для целевого места */
  render() {
    const template = TRACE_TYPES[this.type];
    if (!template) return `🐾 ${this.message}`;
    return template.format.replace('{message}', this.message)
      .replace('{hash}', this.id.slice(-6));
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      message: this.message,
      location: this.location,
      rendered: this.render(),
      pesLevel: this.pesLevel,
      timestamp: this.timestamp,
      discovered: this.discovered,
    };
  }
}

export { TRACE_TYPES, PesTrace };
