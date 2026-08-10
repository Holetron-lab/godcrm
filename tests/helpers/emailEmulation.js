/**
 * 📧 Email Emulation Helper
 * 
 * Для тестирования email без реальной отправки.
 * Использует локальный Postfix (/var/mail/).
 * 
 * Сервер использует 127.0.0.1:25 (local postfix) для отправки.
 * Письма попадают в /var/mail/root если получатель локальный.
 * 
 * Для тестовых emails (@test.godcrm.local) — они не доставляются реально,
 * поэтому можно либо:
 *   1. Мокать SMTPService в тестах
 *   2. Читать /var/mail/root для писем на локальные адреса
 *   3. Использовать MailHog/MailCatcher для перехвата
 */

import fs from 'fs';
import path from 'path';

const MAIL_FILE = '/var/mail/root';
const MAIL_LOG = '/var/log/mail.log';

/**
 * Читает последние N писем из локального mail spool
 */
export function readLocalMail(limit = 10) {
  try {
    if (!fs.existsSync(MAIL_FILE)) {
      return { success: false, error: 'Mail file not found' };
    }

    const content = fs.readFileSync(MAIL_FILE, 'utf8');
    const emails = content.split(/^From /m).filter(Boolean);
    
    const parsed = emails.slice(-limit).map(raw => {
      const lines = raw.split('\n');
      const headers = {};
      let body = '';
      let inBody = false;
      
      for (const line of lines) {
        if (inBody) {
          body += line + '\n';
        } else if (line === '') {
          inBody = true;
        } else {
          const match = line.match(/^([^:]+):\s*(.*)$/);
          if (match) {
            headers[match[1].toLowerCase()] = match[2];
          }
        }
      }
      
      return {
        from: headers['from'] || '',
        to: headers['to'] || '',
        subject: headers['subject'] || '',
        date: headers['date'] || '',
        body: body.slice(0, 500) // First 500 chars
      };
    });
    
    return { success: true, emails: parsed };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Ищет письмо по email или теме
 */
export function findEmail(searchTerm) {
  const result = readLocalMail(50);
  if (!result.success) return result;
  
  const found = result.emails.filter(e => 
    e.to.includes(searchTerm) ||
    e.subject.includes(searchTerm) ||
    e.from.includes(searchTerm)
  );
  
  return { success: true, found };
}

/**
 * Извлекает verification code из письма
 */
export function extractVerificationCode(emailBody) {
  // Типичные паттерны для verification codes
  const patterns = [
    /код[:\s]+(\d{6})/i,
    /code[:\s]+(\d{6})/i,
    /verification[:\s]+(\d{6})/i,
    /\b(\d{6})\b/  // Fallback: любые 6 цифр
  ];
  
  for (const pattern of patterns) {
    const match = emailBody.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}

/**
 * Мок для SMTPService.sendTestEmail
 * Используется в unit тестах
 */
export function createEmailMock() {
  const sentEmails = [];
  
  return {
    sendTestEmail: async (config, toEmail, code) => {
      sentEmails.push({
        timestamp: new Date().toISOString(),
        to: toEmail,
        code,
        config
      });
      return { success: true, messageId: `mock-${Date.now()}` };
    },
    
    getSentEmails: () => [...sentEmails],
    
    getLastEmail: () => sentEmails[sentEmails.length - 1],
    
    findByRecipient: (email) => sentEmails.filter(e => e.to === email),
    
    clear: () => sentEmails.length = 0
  };
}

/**
 * Проверяет, настроен ли локальный mail transport
 */
export async function checkEmailSetup() {
  const checks = {
    mailFile: fs.existsSync(MAIL_FILE),
    mailLog: fs.existsSync(MAIL_LOG),
    smtpConfig: false
  };
  
  try {
    const configPath = path.join(process.cwd(), 'backend', 'smtp-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      checks.smtpConfig = config.accounts?.length > 0;
      checks.smtpAccounts = config.accounts?.map(a => ({
        name: a.name,
        host: a.host,
        isLocal: a.isLocal || a.host === '127.0.0.1'
      }));
    }
  } catch (e) {
    checks.smtpConfig = false;
  }
  
  return checks;
}

export default {
  readLocalMail,
  findEmail,
  extractVerificationCode,
  createEmailMock,
  checkEmailSetup
};
