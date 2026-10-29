#!/usr/bin/env python3
"""Named administrator publishes reviewed evidence; never run by review-only agent."""
import os
import time
from acceptance import CHECKS, create_record, signed, verified, writer
from core import ETC, STATE, SUITES, artifact, canonical, digest, exact, match, read_json, trusted
from runtime import actual_pins

SUITE_KINDS = {'computed-contrast-v1': 'contrast', 'axe-v1': 'axe',
               'trace-metrics-v1': 'metrics', 'clipboard-v1': 'clipboard'}


def suite_evidence(value, observed):
    exact(value, {'kind', 'writer', 'pins', 'candidate_sha', 'kernel', 'qualification_id',
                  'started_at', 'finished_at', 'service', 'suites'})
    now = time.time()
    if (value['pins'] != observed or value['kernel'] != os.uname().release
            or not now - 3600 <= value['started_at'] <= value['finished_at'] <= now
            or value['finished_at'] - value['started_at'] > 310):
        raise ValueError('qualification_stale')
    match(value['candidate_sha'], '[a-f0-9]{40}')
    if len(value['suites']) != 4 or {r['suite_id'] for r in value['suites']} != set(SUITES):
        raise ValueError('suite_coverage')
    for run in value['suites']:
        exact(run, {'suite_id', 'result', 'artifacts', 'attestation', 'cleaned'})
        report = run['result']['report']
        if any(c['passed'] is not True for c in report['checks']):
            raise ValueError('failed_report')
        if run['cleaned'] is not True or report['passed'] is not True or not report['checks']:
            raise ValueError('suite_failed')
        if not run['artifacts'] or len(run['artifacts']) != len(report['artifacts']):
            raise ValueError('artifact_missing')
        for result, descriptor in zip(run['artifacts'], report['artifacts']):
            artifact(result)
            if result['kind'] != SUITE_KINDS[run['suite_id']]:
                raise ValueError('suite_kind')
            if (any(c['passed'] is not True for c in result['checks'])
                    or digest(canonical(result)) != descriptor['sha256']
                    or len(canonical(result)) != descriptor['bytes']):
                raise ValueError('artifact_changed')
        if (run['attestation']['candidate_sha'] != value['candidate_sha']
                or run['attestation']['database'] != 'godcrm_test'):
            raise ValueError('attestation_binding')
    return value


def publish():
    if os.geteuid() != 0:
        raise ValueError('administrator_identity')
    if os.path.lexists(ETC / 'qualification-request.json'):
        raise ValueError('archive_qualification_request_first')
    observed = actual_pins()
    evidence_path = STATE / 'qualification-evidence.json'
    evidence = suite_evidence(verified(read_json(evidence_path, 1048576, private=True), 'qualification-v1'), observed)
    review_path = ETC / 'acceptance-review.json'
    review = read_json(review_path, private=True)
    exact(review, {'writer', 'review_ref', 'qualification_sha256', 'expires_at', 'checks'})
    match(review['review_ref'], '[A-Za-z0-9][A-Za-z0-9._:/@-]{2,159}')
    if review['writer'] != writer() or review['qualification_sha256'] != digest(trusted(evidence_path, True).read_bytes()):
        raise ValueError('review_binding')
    now = time.time()
    if type(review['expires_at']) not in (int, float) or not now < review['expires_at'] <= now + 3600:
        raise ValueError('review_expired')
    exact(review['checks'], CHECKS)
    for capability, decision in review['checks'].items():
        exact(decision, {'status', 'evidence_sha256'})
        if decision['status'] != 'PASS':
            raise ValueError('review_incomplete')
        match(decision['evidence_sha256'], '[a-f0-9]{64}')
        # Installed check receipts are produced by the authorized test operator,
        # independently reviewed. This publisher never manufactures test results.
        proof_path = STATE / ('capability-' + capability + '.json')
        proof = read_json(proof_path, private=True)
        exact(proof, {'capability', 'pins', 'candidate_sha', 'kernel', 'performed_at',
                      'passed', 'method', 'observations'})
        if (digest(trusted(proof_path, True).read_bytes()) != decision['evidence_sha256']
                or proof['capability'] != capability or proof['passed'] is not True
                or proof['pins'] != observed or proof['candidate_sha'] != evidence['candidate_sha']
                or proof['kernel'] != evidence['kernel'] or not now - 3600 <= proof['performed_at'] <= now
                or not isinstance(proof['method'], str) or not proof['method'].strip()
                or not isinstance(proof['observations'], dict) or not proof['observations']):
            raise ValueError('capability_evidence')
    value = {'kind': 'acceptance-v1', 'writer': writer(), 'pins': observed,
             'candidate_sha': evidence['candidate_sha'], 'kernel': evidence['kernel'],
             'issued_at': now, 'expires_at': review['expires_at'],
             'checks': {name: review['checks'][name]['status'] == 'PASS' for name in CHECKS},
             'qualification_sha256': review['qualification_sha256'],
             'review_sha256': digest(trusted(review_path, True).read_bytes())}
    return create_record(ETC / 'acceptance.json', signed(value))


if __name__ == '__main__':
    import sys
    if len(sys.argv) != 1:
        raise SystemExit(2)
    print(publish())  # Digest only, never key/session/evidence contents.
