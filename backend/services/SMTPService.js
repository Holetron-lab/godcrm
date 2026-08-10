import nodemailer from 'nodemailer';
import { apiLogger } from '../utils/logger.js';

class SMTPService {
  /**
   * Validate SMTP configuration
   * @param {Object} config - SMTP configuration
   * @throws {Error} if validation fails
   */
  static validate(config) {
    if (!config.host) {
      throw new Error('Host is required');
    }
    
    if (config.port === undefined || config.port === null) {
      throw new Error('Port is required');
    }
    
    if (typeof config.port !== 'number') {
      throw new Error('Port must be a number');
    }
    
    if (config.port < 1 || config.port > 65535) {
      throw new Error('Port must be between 1 and 65535');
    }
    
    if (!config.user) {
      throw new Error('User is required');
    }
    
    if (!config.password) {
      throw new Error('Password is required');
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(config.user)) {
      throw new Error('Invalid email format');
    }
    
    if (config.from && !emailRegex.test(config.from)) {
      throw new Error('Invalid from email format');
    }
  }
  
  /**
   * Generate 6-digit verification code
   * @returns {string} 6-digit code
   */
  static generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
  
  /**
   * Create nodemailer transport
   * @param {Object} config - SMTP configuration
   * @returns {Object} nodemailer transport
   */
  static createTransport(config) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465, // true for 465, false for other ports
      auth: {
        user: config.user,
        pass: config.password
      }
    });
  }
  
  /**
   * Send test email with verification code
   * @param {Object} config - SMTP configuration
   * @param {string} toEmail - Recipient email
   * @param {string} code - Verification code
   * @returns {Promise<Object>} Result with success flag
   */
  static async sendTestEmail(config, toEmail, code) {
    try {
      const transport = this.createTransport(config);
      
      const mailOptions = {
        from: config.from || config.user,
        to: toEmail,
        subject: 'GOD CRM - SMTP Verification Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">SMTP Configuration Verification</h2>
            <p>Your verification code is:</p>
            <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2196F3;">
              ${code}
            </div>
            <p style="color: #666; margin-top: 20px;">This code will expire in 10 minutes.</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              If you didn't request this verification, please ignore this email.
            </p>
          </div>
        `
      };
      
      const info = await transport.sendMail(mailOptions);
      
      return {
        success: true,
        messageId: info.messageId
      };
    } catch (error) {
      apiLogger.error({ err: error }, 'SMTP send error');
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Send password reset email
   * @param {Object} config - SMTP configuration
   * @param {string} toEmail - Recipient email
   * @param {string} resetLink - Password reset link
   * @returns {Promise<Object>} Result with success flag
   */
  static async sendPasswordResetEmail(config, toEmail, resetLink) {
    try {
      const transport = this.createTransport(config);
      
      const mailOptions = {
        from: config.from || config.user,
        to: toEmail,
        subject: 'GOD CRM - Password Reset Request',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>You requested to reset your password. Click the button below to proceed:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background-color: #2196F3; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p style="color: #666;">Or copy and paste this link into your browser:</p>
            <p style="color: #2196F3; word-break: break-all;">${resetLink}</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              This link will expire in 1 hour. If you didn't request this, please ignore this email.
            </p>
          </div>
        `
      };
      
      const info = await transport.sendMail(mailOptions);
      
      return {
        success: true,
        messageId: info.messageId
      };
    } catch (error) {
      apiLogger.error({ err: error }, 'SMTP send error');
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default SMTPService;
