import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateIPv6Subnet,
  expandIPv6,
  formatIPv6,
  getIPv6Scope,
  parseIPv6,
  parseIPv6Cidr,
  toScientificParts,
} from '../src/core/ipv6.js';

const assertValidationError = (fn, code) =>
  assert.throws(fn, (error) => error.name === 'ValidationError' && error.code === code);

describe('parseIPv6', () => {
  it('parses full and compressed notations to the same value', () => {
    const full = parseIPv6('2001:0db8:0000:0000:0000:ff00:0042:8329');
    assert.equal(parseIPv6('2001:db8::ff00:42:8329'), full);
    assert.equal(parseIPv6('2001:DB8:0:0:0:FF00:42:8329'), full);
  });

  it('parses edge-case compressions', () => {
    assert.equal(parseIPv6('::'), 0n);
    assert.equal(parseIPv6('::1'), 1n);
    assert.equal(parseIPv6('fe80::'), 0xfe80n << 112n);
    assert.equal(parseIPv6('1:2:3:4:5:6:7::'), parseIPv6('1:2:3:4:5:6:7:0'));
  });

  it('parses embedded IPv4 suffixes', () => {
    assert.equal(parseIPv6('::ffff:192.0.2.128'), parseIPv6('::ffff:c000:280'));
  });

  it('rejects invalid input', () => {
    assertValidationError(() => parseIPv6(''), 'ipv6.empty');
    assertValidationError(() => parseIPv6('2001:db8::1::1'), 'ipv6.multipleCompressions');
    assertValidationError(() => parseIPv6('2001:db8:1:2:3:4:5'), 'ipv6.invalidGroupCount');
    assertValidationError(() => parseIPv6('1:2:3:4:5:6:7:8::'), 'ipv6.invalidGroupCount');
    assertValidationError(() => parseIPv6('2001:db8::g1'), 'ipv6.invalidGroup');
    assertValidationError(() => parseIPv6('2001:db8::12345'), 'ipv6.invalidGroup');
    assertValidationError(() => parseIPv6(':2001:db8::1'), 'ipv6.invalidGroup');
    assertValidationError(() => parseIPv6('::ffff:300.1.1.1'), 'ipv6.invalidEmbeddedIPv4');
    assertValidationError(() => parseIPv6('fe80::1%eth0'), 'ipv6.zoneNotSupported');
  });
});

describe('formatIPv6 (RFC 5952)', () => {
  const format = (value) => formatIPv6(parseIPv6(value));

  it('compresses the longest run of zero groups', () => {
    assert.equal(format('2001:0db8:0000:0000:0000:ff00:0042:8329'), '2001:db8::ff00:42:8329');
    assert.equal(format('2001:db8:0:0:1:0:0:1'), '2001:db8::1:0:0:1');
    assert.equal(format('2001:0:0:1:0:0:0:1'), '2001:0:0:1::1');
  });

  it('does not compress a single zero group', () => {
    assert.equal(format('2001:db8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');
  });

  it('formats all-zero and trailing-zero addresses', () => {
    assert.equal(format('0:0:0:0:0:0:0:0'), '::');
    assert.equal(format('2001:db8:0:0:0:0:0:0'), '2001:db8::');
  });

  it('expands addresses', () => {
    assert.equal(expandIPv6(parseIPv6('2001:db8::1')), '2001:0db8:0000:0000:0000:0000:0000:0001');
  });
});

describe('parseIPv6Cidr', () => {
  it('parses a prefix', () => {
    assert.deepEqual(parseIPv6Cidr('2001:db8::/32'), { address: parseIPv6('2001:db8::'), prefix: 32 });
  });

  it('rejects invalid prefixes', () => {
    assertValidationError(() => parseIPv6Cidr('2001:db8::'), 'ipv6.missingPrefix');
    assertValidationError(() => parseIPv6Cidr('2001:db8::/129'), 'ipv6.invalidPrefix');
    assertValidationError(() => parseIPv6Cidr('2001:db8::/x'), 'ipv6.invalidPrefix');
    assertValidationError(() => parseIPv6Cidr('2001:db8::/32/64'), 'ipv6.invalidFormat');
  });
});

describe('calculateIPv6Subnet', () => {
  it('calculates a /32 allocation', () => {
    const { address, prefix } = parseIPv6Cidr('2001:db8:abcd:12::1/32');
    const result = calculateIPv6Subnet(address, prefix);
    assert.equal(formatIPv6(result.network), '2001:db8::');
    assert.equal(formatIPv6(result.lastAddress), '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff');
    assert.equal(result.totalAddresses, 2n ** 96n);
    assert.equal(result.subnets64, 2n ** 32n);
    assert.equal(result.scope, 'documentation');
  });

  it('calculates /0 and /128 boundaries', () => {
    const all = calculateIPv6Subnet(parseIPv6('abcd::1'), 0);
    assert.equal(all.network, 0n);
    assert.equal(all.totalAddresses, 2n ** 128n);

    const single = calculateIPv6Subnet(parseIPv6('2001:db8::5'), 128);
    assert.equal(single.network, single.lastAddress);
    assert.equal(single.totalAddresses, 1n);
    assert.equal(single.subnets64, null);
  });

  it('identifies scopes', () => {
    assert.equal(getIPv6Scope(parseIPv6('::1')), 'loopback');
    assert.equal(getIPv6Scope(parseIPv6('fe80::1')), 'linkLocal');
    assert.equal(getIPv6Scope(parseIPv6('fd12:3456::1')), 'uniqueLocal');
    assert.equal(getIPv6Scope(parseIPv6('ff02::1')), 'multicast');
    assert.equal(getIPv6Scope(parseIPv6('2606:4700::1111')), 'globalUnicast');
    assert.equal(getIPv6Scope(parseIPv6('::ffff:10.0.0.1')), 'ipv4Mapped');
  });
});

describe('toScientificParts', () => {
  it('formats huge values', () => {
    assert.deepEqual(toScientificParts(2n ** 96n), { mantissa: '7.92', exponent: 28 });
    assert.deepEqual(toScientificParts(2n ** 128n), { mantissa: '3.40', exponent: 38 });
  });

  it('formats small values and rounding overflow', () => {
    assert.deepEqual(toScientificParts(1n), { mantissa: '1.00', exponent: 0 });
    assert.deepEqual(toScientificParts(9999n), { mantissa: '1.00', exponent: 4 });
  });
});
