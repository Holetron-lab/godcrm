const EXACT_SECRETS = [
  'JWT_SECRET',
  'SESSION_SECRET',
  'SECRETS_MASTER_KEY',
  'MASTER_ENCRYPTION_KEY',
];

const ASSERTION_NAMES = [
  'POSTGRES_PASSWORD',
  'JWT_SECRET',
  'SECRETS_MASTER_KEY',
];

export function scrubCodemodeEnv() {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('POSTGRES_') || name.endsWith('_API_KEY') || name.endsWith('_TOKEN') || EXACT_SECRETS.includes(name)) {
      delete process.env[name];
    }
  }
}

export function codemodeEnvScrubbed() {
  return ASSERTION_NAMES.every((name) => process.env[name] === undefined);
}
