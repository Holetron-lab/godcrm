import express from 'express';
import { dbRun, dbGet, dbAll } from '../database/init.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sendEmailWithFallback, loadSMTPConfig, saveSMTPConfig } from '../utils/email.js';
import crypto from 'crypto';
import { success, created, error, badRequest, notFound, forbidden, unauthorized } from '../utils/response.js';

const router = express.Router();

// Get SMTP configuration (admin only)
router.get('/smtp', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const config = loadSMTPConfig();
    // Hide passwords in response
    if (config.accounts) {
      config.accounts = config.accounts.map(acc => ({
        ...acc,
        password: acc.password ? '********' : ''
      }));
    }
    success(res, config);
  } catch (err) {
    error(res, err.message);
  }
});

// Save SMTP configuration (admin only)
router.post('/smtp', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { accounts } = req.body;
    const result = saveSMTPConfig({ accounts });
    
    if (result.success) {
      success(res, { message: 'SMTP configuration saved' });
    } else {
      error(res, result.error);
    }
  } catch (err) {
    error(res, err.message);
  }
});

// Test SMTP connection (admin only)
router.post('/smtp/test', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { email } = req.body;
    
    const result = await sendEmailWithFallback(
      email,
      'Test Email from Business CRM',
      '<h1>Test Email</h1><p>If you received this email, your SMTP configuration is working correctly!</p>'
    );

    success(res, result);
  } catch (err) {
    error(res, err.message);
  }
});

// Create employee invitation (admin only)
router.post('/invite-employee', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { email, name, businessIds } = req.body;
    
    // Generate invitation token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create pending employee
    const result = await dbRun(`
      INSERT INTO employee_invitations (email, name, token, expires_at, invited_by)
      VALUES (?, ?, ?, ?, ?)
    `, [email, name, token, expiresAt, req.user.id]);

    // Store business assignments
    if (businessIds && businessIds.length > 0) {
      const invitationId = result.lastInsertRowid;
      for (const businessId of businessIds) {
        await dbRun(`
          INSERT INTO invitation_businesses (invitation_id, business_id)
          VALUES (?, ?)
        `, [invitationId, businessId]);
      }
    }

    // Send invitation email
    const inviteLink = `${process.env.APP_URL || 'http://localhost:3001'}/accept-invite/${token}`;
    
    const emailResult = await sendEmailWithFallback(
      email,
      'Invitation to Business CRM',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1>You've been invited to Business CRM</h1>
          <p>Hello ${name},</p>
          <p>You have been invited to join the Business CRM system.</p>
          <p>Click the button below to accept the invitation and create your account:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${inviteLink}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Accept Invitation
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">This link will expire in 7 days.</p>
          <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link: ${inviteLink}</p>
        </div>
      `
    );

    if (emailResult.success) {
      success(res, { message: 'Invitation sent successfully' });
    } else {
      error(res, 'Failed to send invitation email: ' + emailResult.error);
    }
  } catch (err) {
    error(res, err.message);
  }
});

// Get all invitations (admin only)
router.get('/invitations', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const invitations = await dbAll('SELECT * FROM employee_invitations ORDER BY created_at DESC');
    success(res, invitations);
  } catch (err) {
    error(res, err.message);
  }
});

// Delete invitation (admin only)
router.delete('/invitations/:token', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { token } = req.params;
    
    // Delete invitation businesses first
    await dbRun('DELETE FROM invitation_businesses WHERE invitation_token = ?', [token]);
    
    // Delete invitation
    await dbRun('DELETE FROM employee_invitations WHERE token = ?', [token]);
    
    success(res, { deleted: true });
  } catch (err) {
    error(res, err.message);
  }
});

// Get invitation details (public endpoint)
router.get('/accept-invite/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Find invitation
    const invitation = await dbGet(`
      SELECT ei.*, u.name as invited_by_name
      FROM employee_invitations ei
      LEFT JOIN users u ON ei.invited_by = u.id
      WHERE ei.token = ? AND ei.accepted = 0 AND ei.expires_at > datetime('now')
    `, [token]);

    if (!invitation) {
      return badRequest(res, 'Invalid or expired invitation');
    }

    success(res, { invitation });
  } catch (err) {
    error(res, err.message);
  }
});

// Accept invitation (public endpoint)
router.post('/accept-invite/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    // Find invitation
    const invitation = await dbGet(`
      SELECT * FROM employee_invitations 
      WHERE token = ? AND accepted = 0 AND expires_at > datetime('now')
    `, [token]);

    if (!invitation) {
      return badRequest(res, 'Invalid or expired invitation');
    }

    // Create user account
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(password, 10);
    
    const userResult = await dbRun(
      'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)',
      [invitation.email, passwordHash, invitation.name, 'user']
    );

    // Create employee record
    const employeeResult = await dbRun(
      'INSERT INTO employees (user_id, name, email) VALUES (?, ?, ?)',
      [userResult.lastID, invitation.name, invitation.email]
    );

    // Link to businesses
    const businesses = await dbAll(`
      SELECT business_id FROM invitation_businesses WHERE invitation_id = ?
    `, [invitation.id]);

    for (const business of businesses) {
      await dbRun(
        'INSERT INTO employee_businesses (employee_id, business_id) VALUES (?, ?)',
        [employeeResult.lastID, business.business_id]
      );
    }

    // Mark invitation as accepted
    await dbRun('UPDATE employee_invitations SET accepted = 1 WHERE id = ?', [invitation.id]);

    success(res, { message: 'Account created successfully' });
  } catch (err) {
    error(res, err.message);
  }
});

export default router;
