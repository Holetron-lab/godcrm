/**
 * OIDC Provider Configuration for GOD CRM
 * ADR-063: WorkAdventure Integration
 * 
 * Enables WorkAdventure and other apps to authenticate via CRM
 */

// OIDC Issuer URL
export const ISSUER = process.env.OIDC_ISSUER || 'https://crm.hltrn.cc';

// JWT Secret for signing tokens
export const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';

// Token TTL settings
export const TOKEN_TTL = {
  ACCESS_TOKEN: 3600,        // 1 hour in seconds
  AUTHORIZATION_CODE: 600,   // 10 minutes
  ID_TOKEN: 3600,            // 1 hour
  REFRESH_TOKEN: 86400 * 30, // 30 days
};

// Supported scopes
export const SUPPORTED_SCOPES = ['openid', 'profile', 'email'];

// Supported response types
export const SUPPORTED_RESPONSE_TYPES = ['code'];

// Supported grant types
export const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];

/**
 * Get OIDC Discovery Document
 * @param {string} baseUrl - Base URL of the OIDC provider
 * @returns {Object} - OpenID Configuration
 */
export function getDiscoveryDocument(baseUrl = ISSUER) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
    jwks_uri: `${baseUrl}/oauth/jwks`,
    registration_endpoint: null,
    scopes_supported: SUPPORTED_SCOPES,
    response_types_supported: SUPPORTED_RESPONSE_TYPES,
    response_modes_supported: ['query'],
    grant_types_supported: SUPPORTED_GRANT_TYPES,
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'HS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'name', 'preferred_username', 'email', 'picture', 'email_verified'],
    code_challenge_methods_supported: ['S256', 'plain'],
  };
}
