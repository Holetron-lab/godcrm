#!/usr/bin/env python3
"""Isolated self-host regression. Usage: script IMAGE LEGACY_SCHEMA EVIDENCE_DIR.

IMAGE supplies dependencies; backend/bootstrap/probe are copied from this checkout.
Each scenario gets a new tmpfs godcrm_test on an internal network, without mounts
or published ports. This is backend QA, not a release-image certification.
"""
import pathlib
import secrets
import subprocess
import sys
import time

image, legacy_schema, evidence = sys.argv[1:]
root = pathlib.Path(evidence).resolve()
root.mkdir(parents=True, exist_ok=True)
source = pathlib.Path(__file__).resolve().parents[2]
prefix = 'selfhost-qa-' + secrets.token_hex(4)
network, db, app = prefix, prefix + '-db', prefix + '-app'


def run(*args, check=True, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=180)
    if check and result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result


def sql(query):
    return run('docker', 'exec', db, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
               '-U', 'godcrm', '-d', 'godcrm_test', '-tAc', query).stdout.strip()


for scenario in ['fresh', 'legacy', 'duplicate-handles', 'mixed-ledger']:
    created = []
    password = secrets.token_hex(20)
    env = {
        'POSTGRES_DB': 'godcrm_test', 'POSTGRES_USER': 'godcrm', 'POSTGRES_PASSWORD': password,
        'POSTGRES_HOST': 'db', 'POSTGRES_PORT': '5432', 'POSTGRES_SSL': 'false',
        'POSTGRES_URL': f'postgresql://godcrm:{password}@db:5432/godcrm_test',
        'NODE_ENV': 'test', 'LOG_LEVEL': 'error', 'CRM_CREDENTIAL_KEY': secrets.token_hex(32),
        'JWT_SECRET': secrets.token_hex(32), 'MASTER_ENCRYPTION_KEY': secrets.token_hex(16),
        'MAILBOX_VMAIL_ROOT': '/tmp/qa-vmail', 'MAILBOX_DOMAIN_HUMAN': 'example.test',
        'MAILBOX_DOMAIN_AGENT': 'agents.example.test', 'MAILBOX_HOST': 'mail.example.test',
        'SKIP_DEV_USER': 'true',
    }
    envfile = root / 'qa.env'
    envfile.touch(mode=0o600)
    envfile.write_text(''.join(f'{key}={value}\n' for key, value in env.items()))
    try:
        run('docker', 'network', 'create', '--internal', network)
        created.append(('network', network))
        run('docker', 'run', '-d', '--name', db, '--network', network, '--network-alias', 'db',
            '--tmpfs', '/var/lib/postgresql/data', '--env-file', str(envfile), 'pgvector/pgvector:pg16')
        created.append(('container', db))
        for _ in range(60):
            try:
                if sql('SELECT current_database()') == 'godcrm_test':
                    break
            except RuntimeError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('test DB unavailable')
        run('docker', 'run', '-d', '--name', app, '--network', network, '--env-file', str(envfile),
            '--entrypoint', 'sleep', image, 'infinity')
        created.append(('container', app))
        for rel in ['backend', 'run-migrations.mjs', 'deploy/selfhost', 'scripts/qa/selfhost-upgrade-probe.mjs']:
            # Trailing /. copies contents into an existing image directory.
            local = source / rel
            run('docker', 'cp', str(local) + ('/.' if local.is_dir() else ''), f'{app}:/app/{rel}')
        if scenario != 'fresh':
            run('docker', 'exec', '-i', db, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
                '-U', 'godcrm', '-d', 'godcrm_test', input=pathlib.Path(legacy_schema).read_text())
            # Existing customer data, including an encrypted payload we must not rewrite.
            sql("""
                INSERT INTO users(email,password_hash,name,encryption_key_encrypted)
                VALUES ('legacy@example.test','disabled','Legacy','opaque');
                INSERT INTO spaces(name,owner_id,type)
                SELECT 'Legacy',id,'personal' FROM users WHERE email='legacy@example.test';
                INSERT INTO space_connectors(space_id,type_slug,kind,display_name,account_label,encrypted_payload,created_by)
                SELECT id,'imap','api_key','Legacy','legacy@example.test','{"sentinel":"unchanged"}',owner_id FROM spaces;
            """)
        if scenario == 'duplicate-handles':
            sql("""
                ALTER TABLE users ADD COLUMN handle TEXT;
                UPDATE users SET handle='collision';
                INSERT INTO users(email,password_hash,name,encryption_key_encrypted,handle)
                VALUES ('duplicate@example.test','disabled','Duplicate','opaque','COLLISION');
            """)
        if scenario == 'mixed-ledger':
            sql("INSERT INTO knex_migrations(name,batch,migration_time) VALUES ('001_create_users.js',1,now())")
        result = run('docker', 'exec', app, 'bash', 'deploy/selfhost/docker-entrypoint.sh',
                     'node', 'scripts/qa/selfhost-upgrade-probe.mjs', check=False)
        log = (result.stdout + result.stderr).replace(password, '<redacted>')
        (root / f'{scenario}.log').write_text(log)
        if scenario in ['duplicate-handles', 'mixed-ledger']:
            assert result.returncode != 0
            assert '[entrypoint] starting:' not in log
            expected = 'duplicate handle(s)' if scenario == 'duplicate-handles' else 'non-empty core migration ledger'
            assert expected in log, log
            assert sql("SELECT to_regclass('public.mail_outbox') IS NULL") == 't'
            assert sql("SELECT count(*) FROM information_schema.columns WHERE table_name='space_connectors' AND column_name='account_sub'") == '0'
            if scenario == 'duplicate-handles':
                assert sql('SELECT count(*) FROM selfhost_migrations') == '0'
                assert sql('SELECT count(*) FROM knex_migrations') == '0'
            else:
                assert sql("SELECT to_regclass('public.selfhost_migrations') IS NULL") == 't'
                assert sql('SELECT count(*) FROM knex_migrations') == '1'
        elif result.returncode:
            raise RuntimeError(log[-5000:])
        if scenario != 'fresh':
            assert sql("SELECT encrypted_payload->>'sentinel' FROM space_connectors WHERE display_name='Legacy'") == 'unchanged'
            assert sql("SELECT name FROM users WHERE email='legacy@example.test'") == 'Legacy'
        print(scenario, 'PASS', flush=True)
    finally:
        for kind, name in reversed(created):
            if kind == 'container':
                run('docker', 'rm', '-f', name, check=False)
            else:
                run('docker', 'network', 'rm', name, check=False)
        envfile.unlink(missing_ok=True)
