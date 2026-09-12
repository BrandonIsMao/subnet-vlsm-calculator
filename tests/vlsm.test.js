import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatIPv4 } from '../src/core/ipv4.js';
import { planVLSM, prefixForHosts, rangeToCidrBlocks } from '../src/core/vlsm.js';

const assertValidationError = (fn, code) =>
  assert.throws(fn, (error) => error.name === 'ValidationError' && error.code === code);

const toCidr = ({ network, prefix }) => `${formatIPv4(network)}/${prefix}`;

describe('prefixForHosts', () => {
  it('returns the smallest subnet that fits the hosts', () => {
    assert.equal(prefixForHosts(1), 30);
    assert.equal(prefixForHosts(2), 30);
    assert.equal(prefixForHosts(3), 29);
    assert.equal(prefixForHosts(30), 27);
    assert.equal(prefixForHosts(31), 26);
    assert.equal(prefixForHosts(254), 24);
    assert.equal(prefixForHosts(255), 23);
    assert.equal(prefixForHosts(2 ** 32 - 2), 0);
  });
});

describe('rangeToCidrBlocks', () => {
  it('splits a range into maximal aligned blocks', () => {
    const start = 3232235712; // 192.168.0.192
    const blocks = rangeToCidrBlocks(start, start + 64).map(toCidr);
    assert.deepEqual(blocks, ['192.168.0.192/26']);

    const uneven = rangeToCidrBlocks(3232235720, 3232235776).map(toCidr); // .200 -> .255
    assert.deepEqual(uneven, ['192.168.0.200/29', '192.168.0.208/28', '192.168.0.224/27']);
  });

  it('returns nothing for an empty range', () => {
    assert.deepEqual(rangeToCidrBlocks(100, 100), []);
  });
});

describe('planVLSM', () => {
  it('sorts requirements by size and allocates contiguously', () => {
    const plan = planVLSM('192.168.10.0/24', [
      { name: 'Guests', hosts: 20 },
      { name: 'Sales', hosts: 100 },
      { name: 'WAN link', hosts: 2 },
      { name: 'Engineering', hosts: 50 },
    ]);

    assert.deepEqual(
      plan.allocations.map((subnet) => [subnet.name, toCidr(subnet)]),
      [
        ['Sales', '192.168.10.0/25'],
        ['Engineering', '192.168.10.128/26'],
        ['Guests', '192.168.10.192/27'],
        ['WAN link', '192.168.10.224/30'],
      ],
    );

    const sales = plan.allocations[0];
    assert.equal(formatIPv4(sales.firstHost), '192.168.10.1');
    assert.equal(formatIPv4(sales.lastHost), '192.168.10.126');
    assert.equal(formatIPv4(sales.broadcast), '192.168.10.127');
    assert.equal(formatIPv4(sales.mask), '255.255.255.128');
    assert.equal(sales.usableHosts, 126);
    assert.equal(sales.unusedHosts, 26);

    assert.equal(plan.requiredAddresses, 228);
    assert.equal(plan.freeAddresses, 28);
    assert.deepEqual(plan.freeBlocks.map(toCidr), ['192.168.10.228/30', '192.168.10.232/29', '192.168.10.240/28']);
  });

  it('keeps input order for subnets of equal size', () => {
    const plan = planVLSM('10.0.0.0/24', [
      { name: 'B', hosts: 10 },
      { name: 'A', hosts: 12 },
    ]);
    assert.deepEqual(plan.allocations.map((subnet) => subnet.name), ['B', 'A']);
  });

  it('fills the base network exactly when requirements match its size', () => {
    const plan = planVLSM('10.0.0.0/24', [
      { name: 'Half', hosts: 126 },
      { name: 'Quarter', hosts: 62 },
      { name: 'Eighth 1', hosts: 30 },
      { name: 'Eighth 2', hosts: 30 },
    ]);
    assert.equal(plan.utilization, 1);
    assert.deepEqual(plan.freeBlocks, []);
  });

  it('never produces overlapping or misaligned subnets', () => {
    const hosts = [500, 3, 60, 1000, 12, 2, 250, 120, 29, 7];
    const plan = planVLSM('172.16.0.0/20', hosts.map((count, i) => ({ name: `net-${i}`, hosts: count })));

    let previousEnd = plan.baseNetwork;
    for (const subnet of plan.allocations) {
      assert.equal(subnet.network, previousEnd, `${subnet.name} must start where the previous subnet ended`);
      assert.equal(subnet.network % subnet.blockSize, 0, `${subnet.name} must be aligned to its prefix`);
      assert.ok(subnet.usableHosts >= subnet.requestedHosts);
      previousEnd = subnet.broadcast + 1;
    }
  });

  it('normalises a host address used as the base network', () => {
    const plan = planVLSM('192.168.1.77/24', [{ name: 'LAN', hosts: 10 }]);
    assert.equal(formatIPv4(plan.baseNetwork), '192.168.1.0');
    assert.equal(plan.baseWasNormalized, true);
  });

  it('accepts host counts given as strings', () => {
    const plan = planVLSM('10.0.0.0/24', [{ name: 'LAN', hosts: ' 14 ' }]);
    assert.equal(plan.allocations[0].prefix, 28);
  });

  it('reports when the requirements do not fit', () => {
    assert.throws(
      () =>
        planVLSM('192.168.0.0/24', [
          { name: 'A', hosts: 120 },
          { name: 'B', hosts: 120 },
          { name: 'C', hosts: 10 },
        ]),
      (error) =>
        error.code === 'vlsm.insufficientSpace' &&
        error.params.required === 272 &&
        error.params.available === 256 &&
        error.params.unplaced === 'C',
    );
  });

  it('reports a single subnet larger than the base network', () => {
    assert.throws(
      () => planVLSM('192.168.0.0/24', [{ name: 'Huge', hosts: 300 }]),
      (error) => error.code === 'vlsm.subnetTooLarge' && error.params.prefix === 23,
    );
  });

  it('validates requirement fields', () => {
    assertValidationError(() => planVLSM('10.0.0.0/8', []), 'vlsm.noSubnets');
    assertValidationError(() => planVLSM('10.0.0.0/8', [{ name: ' ', hosts: 5 }]), 'vlsm.missingName');
    assertValidationError(() => planVLSM('10.0.0.0/8', [{ name: 'X', hosts: 0 }]), 'vlsm.invalidHostCount');
    assertValidationError(() => planVLSM('10.0.0.0/8', [{ name: 'X', hosts: '2.5' }]), 'vlsm.invalidHostCount');
    assertValidationError(() => planVLSM('10.0.0.0/8', [{ name: 'X', hosts: '' }]), 'vlsm.invalidHostCount');
    assertValidationError(() => planVLSM('10.0.0/8', [{ name: 'X', hosts: 5 }]), 'ipv4.invalidFormat');
  });
});
