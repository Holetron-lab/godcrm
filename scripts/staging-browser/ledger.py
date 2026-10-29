"""Durable registrations precede allocation. Separate reaper uses the same WAL."""
import json
import sqlite3
import time
from core import canonical, digest, identifier, artifact


class Ledger:
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=1, isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS nonces (id TEXT PRIMARY KEY, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, worker TEXT UNIQUE NOT NULL,
          job TEXT NOT NULL, body TEXT NOT NULL, deadline REAL NOT NULL, heartbeat REAL NOT NULL,
          state TEXT NOT NULL, expires REAL NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS active_job ON runs(job) WHERE state != 'cleaned';
        CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, run TEXT NOT NULL, job TEXT NOT NULL,
          body BLOB NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS totals (job TEXT PRIMARY KEY, count INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS health (name TEXT PRIMARY KEY, at REAL NOT NULL);
        ''')

    def nonce(self, value, now=None):
        now = time.time() if now is None else now
        self.db.execute('DELETE FROM nonces WHERE expires < ?', (now,))
        self.db.execute('INSERT INTO nonces VALUES (?,?)', (value, now + 360))

    def register(self, body):
        now = time.time()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            count = self.db.execute('SELECT count FROM totals WHERE job=?', (body['job_id'],)).fetchone()
            if count and count[0] >= 20:
                raise ValueError('run_quota')
            self.db.execute('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?)', (
                body['run_id'], body['worker_id'], body['job_id'], canonical(body).decode(),
                body['deadline_at'] / 1000, now, 'registered', now + 3600))
            self.db.execute('INSERT INTO totals VALUES (?,1) ON CONFLICT(job) DO UPDATE SET count=count+1', (body['job_id'],))
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def get(self, run, worker):
        row = self.db.execute('SELECT body,state FROM runs WHERE id=? AND worker=?', (run, worker)).fetchone()
        if not row:
            raise ValueError('unknown_worker')
        return json.loads(row[0]), row[1]

    def beat(self, run):
        self.db.execute("UPDATE runs SET heartbeat=? WHERE id=? AND state='registered'", (time.time(), run))

    def pending(self):
        return [json.loads(r[0]) for r in self.db.execute("SELECT body FROM runs WHERE state != 'cleaned'")]

    def expired(self):
        now = time.time()
        return [json.loads(r[0]) for r in self.db.execute(
            "SELECT body FROM runs WHERE state != 'cleaned' AND (deadline<=? OR heartbeat<? OR state='cleaning')", (now, now - 2))]

    def mark(self, run, state):
        if state not in ('cleaning', 'cleaned', 'uncertain'):
            raise ValueError('state')
        self.db.execute('UPDATE runs SET state=? WHERE id=?', (state, run))

    def reaper_beat(self):
        self.db.execute("INSERT INTO health VALUES ('reaper',?) ON CONFLICT(name) DO UPDATE SET at=excluded.at", (time.time(),))

    def reaper_ready(self):
        row = self.db.execute("SELECT at FROM health WHERE name='reaper'").fetchone()
        return bool(row and 0 <= time.time() - row[0] < 2)

    def save_artifact(self, body, value):
        import uuid
        data = canonical(artifact(value))
        self.db.execute('BEGIN IMMEDIATE')
        try:
            for key, maximum in [('run', 2097152), ('job', 41943040)]:
                count = self.db.execute('SELECT coalesce(sum(length(body)),0) FROM artifacts WHERE ' + key + '=?',
                                        (body['run_id'] if key == 'run' else body['job_id'],)).fetchone()[0]
                if count + len(data) > maximum:
                    raise ValueError('artifact_quota')
            aid = str(uuid.uuid4())
            self.db.execute('INSERT INTO artifacts VALUES (?,?,?,?,?)', (aid, body['run_id'], body['job_id'], data, time.time() + 3600))
            self.db.execute('COMMIT')
            return {'id': aid, 'kind': value['kind'], 'sha256': digest(data), 'bytes': len(data), 'sanitized': True}
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def fetch(self, body):
        registered, state = self.get(body['run_id'], body['worker_id'])
        if state != 'cleaned' or registered['job_id'] != body['job_id'] or registered['pins'] != body['pins']:
            raise ValueError('artifact_owner')
        identifier(body['artifact_id'])
        row = self.db.execute('SELECT body FROM artifacts WHERE id=? AND run=? AND job=? AND expires>?',
                              (body['artifact_id'], body['run_id'], body['job_id'], time.time())).fetchone()
        if not row:
            raise ValueError('artifact_expired')
        return artifact(json.loads(row[0]))

    def purge(self):
        self.db.execute('DELETE FROM artifacts WHERE expires<=?', (time.time(),))
        # Tombstones/totals deliberately retained: deleting them reopens lifetime replay/quota.
