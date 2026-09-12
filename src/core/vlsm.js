import { ValidationError } from './errors.js';
import { IPV4_BITS, IPV4_ADDRESS_COUNT, formatIPv4, parseIPv4Cidr, prefixToMask } from './ipv4.js';

/**
 * Variable Length Subnet Masking (VLSM) planner.
 *
 * Algorithm
 * ---------
 * 1. Every requirement is converted into the smallest power-of-two block that
 *    fits its hosts plus the network and broadcast addresses.
 * 2. Blocks are sorted from largest to smallest (ties keep input order).
 * 3. Blocks are assigned contiguously from the start of the base network.
 *
 * Because every block size is a power of two and blocks are placed in
 * descending order, the running offset is always a multiple of the next
 * block's size. Every subnet therefore starts on a valid boundary and no
 * alignment gaps appear. The only unavoidable waste is the rounding up to a
 * power of two in step 1, which makes the plan optimal: it succeeds whenever
 * the sum of the block sizes fits inside the base network.
 */

/** Smallest subnet the planner creates (/30 = 2 usable hosts). */
const MIN_HOST_BITS = 2;
const MAX_USABLE_HOSTS = IPV4_ADDRESS_COUNT - 2;
const HOST_COUNT_PATTERN = /^\d+$/;

/**
 * @param {number} hostCount Required usable hosts (>= 1).
 * @returns {number} Longest prefix whose subnet can hold `hostCount` hosts.
 */
export function prefixForHosts(hostCount) {
  let hostBits = MIN_HOST_BITS;
  while (2 ** hostBits - 2 < hostCount) hostBits += 1;
  return IPV4_BITS - hostBits;
}

/**
 * Splits the address range [start, end) into the minimum number of CIDR blocks.
 *
 * @param {number} start Inclusive start address.
 * @param {number} end   Exclusive end address (may be 2^32).
 * @returns {{ network: number, prefix: number, size: number }[]}
 */
export function rangeToCidrBlocks(start, end) {
  const blocks = [];
  let cursor = start;

  while (cursor < end) {
    // Largest block aligned at `cursor`...
    let size = 1;
    while (size < IPV4_ADDRESS_COUNT && cursor % (size * 2) === 0) size *= 2;
    // ...that does not run past the end of the range.
    while (cursor + size > end) size /= 2;

    blocks.push({ network: cursor, prefix: IPV4_BITS - Math.log2(size), size });
    cursor += size;
  }
  return blocks;
}

/**
 * @param {{ name?: string, hosts?: string | number }} requirement
 * @param {number} index
 */
function normalizeRequirement(requirement, index) {
  const position = index + 1;
  const name = String(requirement?.name ?? '').trim();
  if (!name) throw new ValidationError('vlsm.missingName', { position });

  const rawHosts = String(requirement?.hosts ?? '').trim();
  if (!HOST_COUNT_PATTERN.test(rawHosts) || Number(rawHosts) < 1) {
    throw new ValidationError('vlsm.invalidHostCount', { name, value: rawHosts, position });
  }

  const hosts = Number(rawHosts);
  if (hosts > MAX_USABLE_HOSTS) throw new ValidationError('vlsm.hostCountTooLarge', { name, position });

  const prefix = prefixForHosts(hosts);
  return { index, name, requestedHosts: hosts, prefix, blockSize: 2 ** (IPV4_BITS - prefix) };
}

/**
 * Builds a VLSM allocation plan.
 *
 * @param {string} baseCidr Base network, e.g. "192.168.0.0/24".
 * @param {{ name: string, hosts: string | number }[]} requirements
 */
export function planVLSM(baseCidr, requirements) {
  const { address, prefix: basePrefix } = parseIPv4Cidr(baseCidr);
  const baseNetwork = (address & prefixToMask(basePrefix)) >>> 0;
  const baseSize = 2 ** (IPV4_BITS - basePrefix);
  const baseLabel = `${formatIPv4(baseNetwork)}/${basePrefix}`;

  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new ValidationError('vlsm.noSubnets');
  }

  const subnets = requirements
    .map(normalizeRequirement)
    .sort((a, b) => b.blockSize - a.blockSize || a.index - b.index);

  const tooLarge = subnets.find((subnet) => subnet.blockSize > baseSize);
  if (tooLarge) {
    throw new ValidationError('vlsm.subnetTooLarge', {
      name: tooLarge.name,
      position: tooLarge.index + 1,
      hosts: tooLarge.requestedHosts,
      prefix: tooLarge.prefix,
      base: baseLabel,
    });
  }

  const requiredAddresses = subnets.reduce((sum, subnet) => sum + subnet.blockSize, 0);
  if (requiredAddresses > baseSize) {
    let offset = 0;
    const unplaced = subnets.filter((subnet) => {
      offset += subnet.blockSize;
      return offset > baseSize;
    });
    throw new ValidationError('vlsm.insufficientSpace', {
      base: baseLabel,
      required: requiredAddresses,
      available: baseSize,
      unplaced: unplaced.map((subnet) => subnet.name).join(', '),
    });
  }

  let cursor = baseNetwork;
  const allocations = subnets.map((subnet) => {
    const network = cursor;
    const broadcast = network + subnet.blockSize - 1;
    cursor += subnet.blockSize;

    return {
      name: subnet.name,
      inputIndex: subnet.index,
      requestedHosts: subnet.requestedHosts,
      prefix: subnet.prefix,
      mask: prefixToMask(subnet.prefix),
      network,
      firstHost: network + 1,
      lastHost: broadcast - 1,
      broadcast,
      blockSize: subnet.blockSize,
      usableHosts: subnet.blockSize - 2,
      unusedHosts: subnet.blockSize - 2 - subnet.requestedHosts,
    };
  });

  return {
    baseNetwork,
    basePrefix,
    baseSize,
    // True when the user typed a host address (e.g. 10.0.0.7/24) instead of the network address.
    baseWasNormalized: address !== baseNetwork,
    allocations,
    requiredAddresses,
    freeAddresses: baseSize - requiredAddresses,
    utilization: requiredAddresses / baseSize,
    freeBlocks: rangeToCidrBlocks(cursor, baseNetwork + baseSize),
  };
}
