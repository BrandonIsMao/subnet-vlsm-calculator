import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatIPv4, parseIPv4 } from '../src/core/ipv4.js';
import { formatIPv6, formatIPv6Mixed, parseIPv6, parseIPv6Cidr } from '../src/core/ipv6.js';
import {
  embedIPv4,
  embeddedPrefixLength,
  parseIPv4AddressOrCidr,
  parseNat64Prefix,
  parseSubnetList,
  planDualStack,
  translateIPv4,
} from '../src/core/migration.js';

const assertValidationError = (fn, code) =>
  assert.throws(fn, (error) => error.name === 'ValidationError' && error.code === code);

const byId = (result, id) => result.translations.find((translation) => translation.id === id);
const cidr6 = ({ address, prefix }) => `${formatIPv6(address)}/${prefix}`;

describe('formatIPv6Mixed', () => {
  it('renders the last 32 bits as dotted decimal', () => {
    assert.equal(formatIPv6Mixed(parseIPv6('::ffff:c000:221')), '::ffff:192.0.2.33');
    assert.equal(formatIPv6Mixed(parseIPv6('64:ff9b::c000:221')), '64:ff9b::192.0.2.33');
    assert.equal(formatIPv6Mixed(parseIPv6('::c000:221')), '::192.0.2.33');
    assert.equal(formatIPv6Mixed(parseIPv6('fe80::5efe:a00:1')), 'fe80::5efe:10.0.0.1');
    assert.equal(formatIPv6Mixed(parseIPv6('2001:db8:122:344::c000:221')), '2001:db8:122:344::192.0.2.33');
    assert.equal(formatIPv6Mixed(parseIPv6('1:2:3:4:5:6:c000:221')), '1:2:3:4:5:6:192.0.2.33');
  });
});

describe('embedIPv4 (RFC 6052 §2.4 examples)', () => {
  const ipv4 = parseIPv4('192.0.2.33');
  const examples = [
    ['2001:db8::/32', '2001:db8:c000:221::'],
    ['2001:db8:100::/40', '2001:db8:1c0:2:21::'],
    ['2001:db8:122::/48', '2001:db8:122:c000:2:2100::'],
    ['2001:db8:122:300::/56', '2001:db8:122:3c0:0:221::'],
    ['2001:db8:122:344::/64', '2001:db8:122:344:c0:2:2100:0'],
    ['2001:db8:122:344::/96', '2001:db8:122:344::c000:221'],
    ['64:ff9b::/96', '64:ff9b::c000:221'],
  ];

  for (const [prefix, expected] of examples) {
    it(`embeds into ${prefix}`, () => {
      const { address, prefix: length } = parseIPv6Cidr(prefix);
      assert.equal(formatIPv6(embedIPv4(address, length, ipv4)), expected);
    });
  }

  it('computes the prefix length of embedded networks, skipping the u-octet', () => {
    assert.equal(embeddedPrefixLength(96, 24), 120);
    assert.equal(embeddedPrefixLength(64, 24), 96);
    assert.equal(embeddedPrefixLength(56, 24), 88);
    assert.equal(embeddedPrefixLength(56, 8), 64);
    assert.equal(embeddedPrefixLength(32, 32), 64);
    assert.equal(embeddedPrefixLength(40, 32), 80);
    assert.equal(embeddedPrefixLength(48, 0), 48);
  });
});

describe('parseNat64Prefix', () => {
  it('accepts RFC 6052 prefix lengths', () => {
    assert.equal(parseNat64Prefix('2001:db8:122::/48').prefix, 48);
  });

  it('rejects invalid lengths and a non-zero u-octet', () => {
    assertValidationError(() => parseNat64Prefix('2001:db8::/44'), 'migration.invalidNat64Length');
    assertValidationError(() => parseNat64Prefix('2001:db8:0:0:ff00::/96'), 'migration.nonZeroUOctet');
    assertValidationError(() => parseNat64Prefix('2001:db8::'), 'ipv6.missingPrefix');
  });
});

describe('parseIPv4AddressOrCidr', () => {
  it('defaults to a /32 when no mask is given', () => {
    assert.deepEqual(parseIPv4AddressOrCidr('10.1.2.3'), { address: parseIPv4('10.1.2.3'), prefix: 32 });
    assert.equal(parseIPv4AddressOrCidr('10.1.2.3/8').prefix, 8);
    assert.equal(parseIPv4AddressOrCidr('10.1.2.3 255.255.0.0').prefix, 16);
  });
});

describe('translateIPv4', () => {
  it('translates a single public address', () => {
    const result = translateIPv4('8.8.4.4');

    assert.equal(formatIPv6Mixed(byId(result, 'ipv4Mapped').address), '::ffff:8.8.4.4');
    assert.equal(formatIPv6(byId(result, 'ipv4Mapped').address), '::ffff:808:404');
    assert.equal(formatIPv6Mixed(byId(result, 'nat64').address), '64:ff9b::8.8.4.4');
    assert.equal(cidr6(byId(result, 'sixToFour').network), '2002:808:404::/48');
    assert.equal(formatIPv6(byId(result, 'isatap').address), 'fe80::200:5efe:808:404');
    assert.equal(formatIPv6Mixed(byId(result, 'ipv4Compatible').address), '::8.8.4.4');

    assert.equal(byId(result, 'ipv4Mapped').network, null);
    assert.ok(result.translations.every((translation) => translation.warning === null));
  });

  it('translates a network into IPv6 prefixes', () => {
    const result = translateIPv4('192.168.10.77/24');

    assert.equal(formatIPv4(result.network), '192.168.10.0');
    assert.equal(cidr6(byId(result, 'ipv4Mapped').network), '::ffff:c0a8:a00/120');
    assert.equal(cidr6(byId(result, 'nat64').network), '64:ff9b::c0a8:a00/120');
    assert.equal(cidr6(byId(result, 'sixToFour').network), '2002:c0a8:a00::/40');
  });

  it('flags mechanisms that need globally routable IPv4', () => {
    const result = translateIPv4('10.0.0.1');
    assert.equal(byId(result, 'sixToFour').warning, 'migration.warning.requiresPublic');
    assert.equal(byId(result, 'nat64').warning, 'migration.warning.wellKnownNonGlobal');
    // Private addresses keep the universal/local bit cleared in ISATAP identifiers.
    assert.equal(formatIPv6Mixed(byId(result, 'isatap').address), 'fe80::5efe:10.0.0.1');
  });

  it('uses a network-specific NAT64 prefix without the well-known warning', () => {
    const result = translateIPv4('10.0.0.1', { nat64Prefix: '2001:db8:122::/48' });
    const nat64 = byId(result, 'nat64');
    assert.equal(formatIPv6(nat64.address), '2001:db8:122:a00:0:100::');
    assert.equal(nat64.mixedNotation, false);
    assert.equal(nat64.warning, null);
  });

  it('validates input', () => {
    assertValidationError(() => translateIPv4(''), 'ipv4.empty');
    assertValidationError(() => translateIPv4('10.0.0.256'), 'ipv4.octetOutOfRange');
    assertValidationError(() => translateIPv4('10.0.0.1', { nat64Prefix: '64:ff9b::/100' }), 'migration.invalidNat64Length');
  });
});

describe('parseSubnetList', () => {
  it('parses names, networks and optional names', () => {
    const subnets = parseSubnetList('Sales, 192.168.10.0/25\n\n# comment\n192.168.10.130/26\nWAN;10.0.0.0/30');
    assert.deepEqual(
      subnets.map(({ name, network, prefix }) => [name, `${formatIPv4(network)}/${prefix}`]),
      [
        ['Sales', '192.168.10.0/25'],
        ['192.168.10.128/26', '192.168.10.128/26'],
        ['WAN', '10.0.0.0/30'],
      ],
    );
  });

  it('reports the offending line', () => {
    assert.throws(
      () => parseSubnetList('A, 10.0.0.0/24\nB, 10.0.1.0'),
      (error) => error.code === 'migration.invalidSubnetLine' && error.params.line === 2,
    );
    assertValidationError(() => parseSubnetList('  \n# nothing'), 'migration.noSubnets');
  });
});

describe('planDualStack', () => {
  const subnets = parseSubnetList('Engineering, 172.16.0.0/24\nSales, 172.16.1.0/25\nGuests, 172.16.1.128/26');

  it('assigns sequential /64 subnets', () => {
    const plan = planDualStack('2001:db8:acad::/48', subnets);
    assert.deepEqual(
      plan.allocations.map((subnet) => `${formatIPv6(subnet.ipv6Network)}/${subnet.ipv6Prefix}`),
      ['2001:db8:acad::/64', '2001:db8:acad:1::/64', '2001:db8:acad:2::/64'],
    );
    assert.equal(formatIPv6(plan.allocations[1].ipv6Gateway), '2001:db8:acad:1::1');
    assert.equal(formatIPv4(plan.allocations[1].ipv4Gateway), '172.16.1.1');
    assert.equal(plan.capacity, 65536n);
  });

  it('derives subnet IDs from the IPv4 network', () => {
    const plan = planDualStack('2001:db8:acad::/48', subnets, { strategy: 'ipv4Embedded' });
    assert.deepEqual(
      plan.allocations.map((subnet) => formatIPv6(subnet.ipv6Network)),
      ['2001:db8:acad::', '2001:db8:acad:100::', '2001:db8:acad:180::'],
    );
  });

  it('normalises the site prefix', () => {
    const plan = planDualStack('2001:db8:acad:ff::1/48', subnets);
    assert.equal(formatIPv6(plan.sitePrefix), '2001:db8:acad::');
  });

  it('detects subnet ID collisions', () => {
    const colliding = parseSubnetList('A, 10.0.1.0/24\nB, 10.1.1.0/24');
    assert.throws(
      () => planDualStack('2001:db8:acad::/48', colliding, { strategy: 'ipv4Embedded' }),
      (error) => error.code === 'migration.subnetIdCollision' && error.params.second === 'B',
    );
  });

  it('validates the site prefix and capacity', () => {
    assertValidationError(() => planDualStack('2001:db8::/80', subnets), 'migration.sitePrefixTooLong');
    assertValidationError(() => planDualStack('2001:db8::/63', subnets), 'migration.notEnoughSubnets');
    assertValidationError(() => planDualStack('2001:db8::/48', []), 'migration.noSubnets');
  });
});
