import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateIPv4Subnet,
  formatIPv4,
  getIPv4Class,
  getIPv4Scope,
  maskToPrefix,
  parseIPv4,
  parseIPv4Cidr,
  prefixToMask,
  toBinaryOctets,
} from '../src/core/ipv4.js';

const assertValidationError = (fn, code) =>
  assert.throws(fn, (error) => error.name === 'ValidationError' && error.code === code);

describe('parseIPv4 / formatIPv4', () => {
  it('round-trips valid addresses', () => {
    for (const address of ['0.0.0.0', '10.1.2.3', '192.168.1.254', '255.255.255.255']) {
      assert.equal(formatIPv4(parseIPv4(address)), address);
    }
  });

  it('parses the upper bound as an unsigned integer', () => {
    assert.equal(parseIPv4('255.255.255.255'), 0xffffffff);
  });

  it('rejects malformed input', () => {
    assertValidationError(() => parseIPv4(''), 'ipv4.empty');
    assertValidationError(() => parseIPv4('192.168.1'), 'ipv4.invalidFormat');
    assertValidationError(() => parseIPv4('192.168.1.1.1'), 'ipv4.invalidFormat');
    assertValidationError(() => parseIPv4('192.168.1.256'), 'ipv4.octetOutOfRange');
    assertValidationError(() => parseIPv4('192.168.01.1'), 'ipv4.invalidOctet');
    assertValidationError(() => parseIPv4('192.168.a.1'), 'ipv4.invalidOctet');
    assertValidationError(() => parseIPv4('192.168..1'), 'ipv4.invalidOctet');
  });
});

describe('masks and prefixes', () => {
  it('converts prefixes to masks and back', () => {
    for (let prefix = 0; prefix <= 32; prefix += 1) {
      assert.equal(maskToPrefix(prefixToMask(prefix)), prefix);
    }
    assert.equal(formatIPv4(prefixToMask(0)), '0.0.0.0');
    assert.equal(formatIPv4(prefixToMask(20)), '255.255.240.0');
    assert.equal(formatIPv4(prefixToMask(32)), '255.255.255.255');
  });

  it('rejects non-contiguous masks', () => {
    assertValidationError(() => maskToPrefix(parseIPv4('255.0.255.0')), 'ipv4.nonContiguousMask');
  });

  it('renders binary octets', () => {
    assert.deepEqual(toBinaryOctets(parseIPv4('192.168.1.5')), ['11000000', '10101000', '00000001', '00000101']);
  });
});

describe('parseIPv4Cidr', () => {
  it('accepts CIDR, dotted-mask and space-separated formats', () => {
    const expected = { address: parseIPv4('192.168.1.10'), prefix: 24 };
    assert.deepEqual(parseIPv4Cidr('192.168.1.10/24'), expected);
    assert.deepEqual(parseIPv4Cidr(' 192.168.1.10 / 24 '), expected);
    assert.deepEqual(parseIPv4Cidr('192.168.1.10/255.255.255.0'), expected);
    assert.deepEqual(parseIPv4Cidr('192.168.1.10 255.255.255.0'), expected);
  });

  it('reports missing or invalid masks', () => {
    assertValidationError(() => parseIPv4Cidr('192.168.1.10'), 'ipv4.missingPrefix');
    assertValidationError(() => parseIPv4Cidr('192.168.1.10/33'), 'ipv4.invalidPrefix');
    assertValidationError(() => parseIPv4Cidr('192.168.1.10/abc'), 'ipv4.invalidPrefix');
    assertValidationError(() => parseIPv4Cidr('192.168.1.10/255.255.0.255'), 'ipv4.nonContiguousMask');
    assertValidationError(() => parseIPv4Cidr('192.168.1.10/255.255.300.0'), 'ipv4.invalidMask');
    assertValidationError(() => parseIPv4Cidr('192.168.1.10 / 24 / 8'), 'ipv4.invalidFormat');
  });
});

describe('calculateIPv4Subnet', () => {
  const calculate = (cidr) => {
    const { address, prefix } = parseIPv4Cidr(cidr);
    const result = calculateIPv4Subnet(address, prefix);
    return {
      ...result,
      network: formatIPv4(result.network),
      broadcast: formatIPv4(result.broadcast),
      firstHost: formatIPv4(result.firstHost),
      lastHost: formatIPv4(result.lastHost),
      mask: formatIPv4(result.mask),
      wildcard: formatIPv4(result.wildcard),
    };
  };

  it('calculates a typical /24', () => {
    const result = calculate('192.168.1.130/24');
    assert.equal(result.network, '192.168.1.0');
    assert.equal(result.broadcast, '192.168.1.255');
    assert.equal(result.firstHost, '192.168.1.1');
    assert.equal(result.lastHost, '192.168.1.254');
    assert.equal(result.usableHosts, 254);
    assert.equal(result.totalAddresses, 256);
    assert.equal(result.mask, '255.255.255.0');
    assert.equal(result.wildcard, '0.0.0.255');
    assert.equal(result.ipClass.name, 'C');
    assert.equal(result.scope, 'private');
  });

  it('calculates a non-octet boundary (/27)', () => {
    const result = calculate('10.20.30.77/27');
    assert.equal(result.network, '10.20.30.64');
    assert.equal(result.broadcast, '10.20.30.95');
    assert.equal(result.firstHost, '10.20.30.65');
    assert.equal(result.lastHost, '10.20.30.94');
    assert.equal(result.usableHosts, 30);
    assert.equal(result.wildcard, '0.0.0.31');
  });

  it('handles /31 point-to-point links (RFC 3021)', () => {
    const result = calculate('172.16.0.1/31');
    assert.equal(result.usableHosts, 2);
    assert.equal(result.firstHost, '172.16.0.0');
    assert.equal(result.lastHost, '172.16.0.1');
    assert.equal(result.hasBroadcast, false);
  });

  it('handles /32 single hosts', () => {
    const result = calculate('8.8.8.8/32');
    assert.equal(result.usableHosts, 1);
    assert.equal(result.firstHost, '8.8.8.8');
    assert.equal(result.lastHost, '8.8.8.8');
  });

  it('handles /0 without overflowing', () => {
    const result = calculate('123.45.67.89/0');
    assert.equal(result.network, '0.0.0.0');
    assert.equal(result.broadcast, '255.255.255.255');
    assert.equal(result.totalAddresses, 2 ** 32);
    assert.equal(result.usableHosts, 2 ** 32 - 2);
  });

  it('handles addresses at the top of the space', () => {
    const result = calculate('255.255.255.200/25');
    assert.equal(result.network, '255.255.255.128');
    assert.equal(result.broadcast, '255.255.255.255');
  });
});

describe('classification', () => {
  it('identifies classful ranges', () => {
    assert.equal(getIPv4Class(parseIPv4('10.0.0.1')).name, 'A');
    assert.equal(getIPv4Class(parseIPv4('172.16.0.1')).name, 'B');
    assert.equal(getIPv4Class(parseIPv4('192.168.0.1')).name, 'C');
    assert.equal(getIPv4Class(parseIPv4('224.0.0.5')).name, 'D');
    assert.equal(getIPv4Class(parseIPv4('250.0.0.1')).name, 'E');
  });

  it('identifies special-purpose scopes', () => {
    assert.equal(getIPv4Scope(parseIPv4('172.31.255.255')), 'private');
    assert.equal(getIPv4Scope(parseIPv4('172.32.0.0')), 'public');
    assert.equal(getIPv4Scope(parseIPv4('127.0.0.1')), 'loopback');
    assert.equal(getIPv4Scope(parseIPv4('169.254.10.1')), 'linkLocal');
    assert.equal(getIPv4Scope(parseIPv4('100.100.0.1')), 'sharedAddressSpace');
    assert.equal(getIPv4Scope(parseIPv4('198.51.100.7')), 'documentation');
    assert.equal(getIPv4Scope(parseIPv4('239.1.1.1')), 'multicast');
    assert.equal(getIPv4Scope(parseIPv4('255.255.255.255')), 'broadcast');
    assert.equal(getIPv4Scope(parseIPv4('8.8.8.8')), 'public');
  });
});
