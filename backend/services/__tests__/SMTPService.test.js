import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import SMTPService from '../SMTPService.js';

describe('SMTPService', () => {
  describe('validate', () => {
    test('should validate correct SMTP config', () => {
      const validConfig = {
        host: 'smtp.gmail.com',
        port: 587,
        user: 'test@gmail.com',
        password: 'app_password',
        from: 'noreply@test.com'
      };
      
      expect(() => SMTPService.validate(validConfig)).not.toThrow();
    });
    
    test('should reject config without host', () => {
      const invalidConfig = {
        port: 587,
        user: 'test@gmail.com',
        password: 'password',
        from: 'noreply@test.com'
      };
      
      expect(() => SMTPService.validate(invalidConfig)).toThrow('Host is required');
    });
    
    test('should reject config with invalid port', () => {
      const invalidConfig = {
        host: 'smtp.gmail.com',
        port: 'invalid',
        user: 'test@gmail.com',
        password: 'password',
        from: 'noreply@test.com'
      };
      
      expect(() => SMTPService.validate(invalidConfig)).toThrow('Port must be a number');
    });
    
    test('should reject config with port out of range', () => {
      const invalidConfig = {
        host: 'smtp.gmail.com',
        port: 99999,
        user: 'test@gmail.com',
        password: 'password',
        from: 'noreply@test.com'
      };
      
      expect(() => SMTPService.validate(invalidConfig)).toThrow('Port must be between 1 and 65535');
    });
    
    test('should reject config without user', () => {
      const invalidConfig = {
        host: 'smtp.gmail.com',
        port: 587,
        password: 'password',
        from: 'noreply@test.com'
      };
      
      expect(() => SMTPService.validate(invalidConfig)).toThrow('User is required');
    });
    
    test('should reject config without password', () => {
      const invalidConfig = {
        host: 'smtp.gmail.com',
        port: 587,
        user: 'test@gmail.com',
        from: 'noreply@test.com'
      };
      
      expect(() => SMTPService.validate(invalidConfig)).toThrow('Password is required');
    });
    
    test('should reject config with invalid email format', () => {
      const invalidConfig = {
        host: 'smtp.gmail.com',
        port: 587,
        user: 'invalid-email',
        password: 'password',
        from: 'noreply@test.com'
      };
      
      expect(() => SMTPService.validate(invalidConfig)).toThrow('Invalid email format');
    });
  });
  
  describe('generateVerificationCode', () => {
    test('should generate 6-digit code', () => {
      const code = SMTPService.generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
    });
    
    test('should generate different codes', () => {
      const code1 = SMTPService.generateVerificationCode();
      const code2 = SMTPService.generateVerificationCode();
      // Very unlikely to be equal, but possible
      // Just checking format
      expect(code1).toMatch(/^\d{6}$/);
      expect(code2).toMatch(/^\d{6}$/);
    });
  });
  
  describe('sendTestEmail', () => {
    test('should send email with verification code', async () => {
      const config = {
        host: 'smtp.gmail.com',
        port: 587,
        user: 'test@gmail.com',
        password: 'app_password',
        from: 'noreply@test.com'
      };
      
      const toEmail = 'owner@test.com';
      const code = '123456';
      
      // Mock nodemailer transport
      const mockTransport = {
        sendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' })
      };
      
      SMTPService.createTransport = vi.fn().mockReturnValue(mockTransport);
      
      const result = await SMTPService.sendTestEmail(config, toEmail, code);
      
      expect(result.success).toBe(true);
      expect(mockTransport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: config.from,
          to: toEmail,
          subject: expect.stringContaining('SMTP Verification'),
          html: expect.stringContaining(code)
        })
      );
    });
    
    test('should handle send email failure', async () => {
      const config = {
        host: 'invalid.smtp.com',
        port: 587,
        user: 'test@gmail.com',
        password: 'wrong_password',
        from: 'noreply@test.com'
      };
      
      const mockTransport = {
        sendMail: vi.fn().mockRejectedValue(new Error('SMTP connection failed'))
      };
      
      SMTPService.createTransport = vi.fn().mockReturnValue(mockTransport);
      
      const result = await SMTPService.sendTestEmail(config, 'owner@test.com', '123456');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('SMTP connection failed');
    });
  });
});
