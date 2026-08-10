import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SMTP_CONFIG_FILE = path.join(__dirname, '../smtp-config.json');

/**
 * Send email with SMTP fallback logic
 */
export async function sendEmailWithFallback(to, subject, html) {
  // Load SMTP accounts from config
  let smtpAccounts = [];
  try {
    if (fs.existsSync(SMTP_CONFIG_FILE)) {
      const data = fs.readFileSync(SMTP_CONFIG_FILE, 'utf8');
      const config = JSON.parse(data);
      smtpAccounts = config.accounts || [];
    }
  } catch (error) {
    logger.error({ err: error }, 'Error loading SMTP config');
    return { success: false, error: 'Failed to load SMTP configuration' };
  }

  if (smtpAccounts.length === 0) {
    logger.error('❌ No SMTP accounts configured');
    return { success: false, error: 'No SMTP accounts configured' };
  }

  // Try each SMTP account in order (PRIMARY first, then FALLBACKs)
  for (let i = 0; i < smtpAccounts.length; i++) {
    const account = smtpAccounts[i];
    const accountLabel = i === 0 ? 'PRIMARY' : `FALLBACK #${i}`;
    
    logger.info(`📧 Attempting to send email via ${accountLabel}: ${account.name} (${account.user})`);

    try {
      // Create transporter configuration
      const transportConfig = {
        host: account.host,
        port: parseInt(account.port) || 587,
        secure: parseInt(account.port) === 465,
        tls: {
          rejectUnauthorized: false
        }
      };

      // Only add auth if user/password are provided
      if (account.user && account.password) {
        transportConfig.auth = {
          user: account.user,
          pass: account.password
        };
      }

      const transporter = nodemailer.createTransport(transportConfig);

      // Determine FROM address
      let fromAddress;
      if (account.fromEmail) {
        fromAddress = account.fromEmail;
      } else if (account.user) {
        fromAddress = account.user;
      } else if (account.host === '127.0.0.1' || account.host === 'localhost') {
        fromAddress = 'noreply@hltrn.cc';
      } else {
        fromAddress = `noreply@${account.host.replace(/^(smtp\.|mail\.)/, '')}`;
      }
      const fromName = account.fromName || 'GOD CRM';

      // Send email
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to: to,
        subject: subject,
        html: html
      });

      logger.info(`✅ Email sent successfully via ${accountLabel}: ${account.name}`);
      logger.info(`   Message ID: ${info.messageId}`);

      return { 
        success: true, 
        messageId: info.messageId,
        usedAccount: account.name,
        accountType: accountLabel
      };

    } catch (error) {
      logger.error({ err: error }, `❌ Failed to send via ${accountLabel} (${account.name})`);
      
      // If this is not the last account, try next one
      if (i < smtpAccounts.length - 1) {
        logger.warn(`   ⚠️  Trying next SMTP account...`);
        continue;
      } else {
        // All accounts failed
        return { 
          success: false, 
          error: `All SMTP accounts failed. Last error: ${error.message}` 
        };
      }
    }
  }

  return { success: false, error: 'No SMTP accounts available' };
}

/**
 * Load SMTP configuration
 */
export function loadSMTPConfig() {
  try {
    if (fs.existsSync(SMTP_CONFIG_FILE)) {
      const data = fs.readFileSync(SMTP_CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
    return { accounts: [] };
  } catch (error) {
    logger.error({ err: error }, 'Error loading SMTP config');
    return { accounts: [] };
  }
}

/**
 * Save SMTP configuration
 */
export function saveSMTPConfig(config) {
  try {
    fs.writeFileSync(SMTP_CONFIG_FILE, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (error) {
    logger.error({ err: error }, 'Error saving SMTP config');
    return { success: false, error: error.message };
  }
}
