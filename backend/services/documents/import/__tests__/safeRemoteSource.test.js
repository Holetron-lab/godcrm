// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertPublicAddress } from '../safeRemoteSource.js';

describe('remote document SSRF guard', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '198.18.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1',
  ])('denies non-public address %s', (address) => {
    expect(() => assertPublicAddress(address)).toThrow('DOCUMENT_URL_ADDRESS_DENIED');
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public address %s', (address) => {
    expect(assertPublicAddress(address)).toBe(address);
  });
});
