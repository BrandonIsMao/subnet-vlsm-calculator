import { ValidationError } from './errors.js';
import { calculateIPv4Subnet, formatIPv4, getIPv4Scope, parseIPv4, parseIPv4Cidr, prefixToMask } from './ipv4.js';
import { parseIPv6Cidr, prefixToIPv6Mask } from './ipv6.js';

/**
 * IPv4 → IPv6 migration helpers.
 *
 * 1. `translateIPv4` builds the IPv6 representations of an IPv4 address used
 *    by the common transition mechanisms (IPv4-mapped, NAT64, 6to4, ISATAP…).
 * 2. `planDualStack` assigns a /64 from an IPv6 site prefix to every IPv4
 *    subnet, producing an addressing plan for running both protocols side by side.
 */

export const NAT64_WELL_KNOWN_PREFIX = '64:ff9b::/96';

/** Prefix lengths allowed for IPv4-embedded IPv6 addresses (RFC 6052 §2.2). */
export const RFC6052_PREFIX_LENGTHS = [32, 40, 48, 56, 64, 96];

/** RFC 6052 reserves bits 64–71 (the "u" octet); they are skipped when embedding. */
const U_OCTET_START = 64;
const U_OCTET_END = 72;
const U_OCTET_MASK = 0xffn << 56n;

const IPV4_MAPPED_PREFIX = 0xffffn << 32n;
const SIX_TO_FOUR_PREFIX = 0x2002n << 112n;
const LINK_LOCAL_PREFIX = 0xfe80n << 112n;
const ISATAP_MARKER = 0x5efen << 32n;
/** ISATAP sets the universal/local bit when the IPv4 address is globally unique (RFC 5214). */
const ISATAP_UNIVERSAL = 0x0200n << 48n;

const SUBNET_BITS = 64;

/**
 * Accepts an IPv4 address with an optional mask ("192.0.2.1" or "192.0.2.0/24").
 *
 * @param {string} input
 * @returns {{ address: number, prefix: number }}
 */
export function parseIPv4AddressOrCidr(input) {
  const value = String(input ?? '').trim();
  if (/[\s/]/.test(value)) return parseIPv4Cidr(value);
  return { address: parseIPv4(value), prefix: 32 };
}

/**
 * Walks the bit positions used by RFC 6052 to embed `ipv4Bits` bits after a
 * prefix, skipping the reserved u-octet.
 *
 * @param {number} prefixLength
 * @param {number} ipv4Bits
 * @returns {number[]} Bit positions (0 = most significant bit of the address).
 */
function embeddingPositions(prefixLength, ipv4Bits) {
  const positions = [];
  let position = prefixLength;
  for (let i = 0; i < ipv4Bits; i += 1) {
    if (position === U_OCTET_START) position = U_OCTET_END;
    positions.push(position);
    position += 1;
  }
  return positions;
}

/**
 * Embeds an IPv4 address into an IPv6 prefix following RFC 6052 §2.2.
 *
 * @param {bigint} prefix       IPv6 prefix (host bits are ignored).
 * @param {number} prefixLength One of RFC6052_PREFIX_LENGTHS.
 * @param {number} ipv4         IPv4 address as an unsigned integer.
 * @returns {bigint}
 */
export function embedIPv4(prefix, prefixLength, ipv4) {
  let result = prefix & prefixToIPv6Mask(prefixLength);
  embeddingPositions(prefixLength, 32).forEach((position, index) => {
    if ((ipv4 >>> (31 - index)) & 1) result |= 1n << BigInt(127 - position);
  });
  return result;
}

/**
 * Length of the IPv6 prefix that represents an IPv4 network of `ipv4Prefix`
 * bits embedded after a prefix of `prefixLength` bits.
 *
 * @param {number} prefixLength
 * @param {number} ipv4Prefix
 */
export function embeddedPrefixLength(prefixLength, ipv4Prefix) {
  if (ipv4Prefix === 0) return prefixLength;
  return embeddingPositions(prefixLength, ipv4Prefix).at(-1) + 1;
}

/**
 * Validates a NAT64 prefix (well-known or network-specific).
 *
 * @param {string} input
 * @returns {{ address: bigint, prefix: number }}
 */
export function parseNat64Prefix(input) {
  const { address, prefix } = parseIPv6Cidr(input);
  if (!RFC6052_PREFIX_LENGTHS.includes(prefix)) {
    throw new ValidationError('migration.invalidNat64Length', {
      prefix,
      lengths: RFC6052_PREFIX_LENGTHS.map((length) => `/${length}`).join(', '),
    });
  }
  // Only a /96 prefix covers the reserved u-octet, which must be zero.
  if (prefix > U_OCTET_START && (address & U_OCTET_MASK) !== 0n) {
    throw new ValidationError('migration.nonZeroUOctet');
  }
  return { address: address & prefixToIPv6Mask(prefix), prefix };
}

/**
 * @typedef {object} Translation
 * @property {string} id              Mechanism identifier (translation key).
 * @property {string} standard        Defining RFC.
 * @property {'current' | 'deprecated' | 'legacy'} status
 * @property {bigint | null} address  IPv6 address representing the IPv4 address.
 * @property {boolean} mixedNotation  Whether the dotted-quad form is conventional.
 * @property {{ address: bigint, prefix: number } | null} network  IPv6 prefix for the IPv4 network.
 * @property {string | null} warning  Translation key of a caveat, if any.
 */

/**
 * Builds every IPv6 representation of an IPv4 address or network.
 *
 * @param {string} ipv4Input  "192.0.2.33" or "192.0.2.0/24".
 * @param {{ nat64Prefix?: string }} [options]
 */
export function translateIPv4(ipv4Input, { nat64Prefix = NAT64_WELL_KNOWN_PREFIX } = {}) {
  const { address, prefix } = parseIPv4AddressOrCidr(ipv4Input);
  const network = (address & prefixToMask(prefix)) >>> 0;
  const isNetwork = prefix < 32;
  const scope = getIPv4Scope(address);
  const isPublic = scope === 'public';
  const ipv4 = BigInt(address);

  const nat64 = parseNat64Prefix(nat64Prefix);
  const isWellKnownNat64 = nat64.prefix === 96 && nat64.address === parseIPv6Cidr(NAT64_WELL_KNOWN_PREFIX).address;

  /** @type {(base: bigint, length: number) => { address: bigint, prefix: number } | null} */
  const embeddedNetwork = (base, length) =>
    isNetwork ? { address: embedIPv4(base, length, network), prefix: embeddedPrefixLength(length, prefix) } : null;

  /** @type {Translation[]} */
  const translations = [
    {
      id: 'ipv4Mapped',
      standard: 'RFC 4291',
      status: 'current',
      address: IPV4_MAPPED_PREFIX | ipv4,
      mixedNotation: true,
      network: embeddedNetwork(IPV4_MAPPED_PREFIX, 96),
      warning: null,
    },
    {
      id: 'nat64',
      standard: 'RFC 6052',
      status: 'current',
      address: embedIPv4(nat64.address, nat64.prefix, address),
      mixedNotation: nat64.prefix === 96,
      network: embeddedNetwork(nat64.address, nat64.prefix),
      // The well-known prefix must not be used to represent non-global IPv4 addresses (RFC 6052 §3.1).
      warning: isWellKnownNat64 && !isPublic ? 'migration.warning.wellKnownNonGlobal' : null,
    },
    {
      id: 'sixToFour',
      standard: 'RFC 3056',
      status: 'deprecated',
      address: null,
      mixedNotation: false,
      network: { address: SIX_TO_FOUR_PREFIX | (BigInt(network) << 80n), prefix: 16 + prefix },
      warning: isPublic ? null : 'migration.warning.requiresPublic',
    },
    {
      id: 'isatap',
      standard: 'RFC 5214',
      status: 'legacy',
      address: LINK_LOCAL_PREFIX | (isPublic ? ISATAP_UNIVERSAL : 0n) | ISATAP_MARKER | ipv4,
      mixedNotation: true,
      network: null,
      warning: null,
    },
    {
      id: 'ipv4Compatible',
      standard: 'RFC 4291',
      status: 'deprecated',
      address: ipv4,
      mixedNotation: true,
      network: embeddedNetwork(0n, 96),
      warning: null,
    },
  ];

  return { address, prefix, network, isNetwork, scope, nat64, isWellKnownNat64, translations };
}

/**
 * Parses a subnet list with one "name, network" pair per line. The name is
 * optional; blank lines and lines starting with "#" are ignored.
 *
 * @param {string} text
 * @returns {{ name: string, network: number, prefix: number }[]}
 */
export function parseSubnetList(text) {
  const subnets = [];

  String(text ?? '')
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;

      const parts = line.split(/\s*[,;\t]\s*/);
      const cidr = parts.length > 1 ? parts[1] : parts[0];
      const name = parts.length > 1 ? parts[0] : '';

      let parsed;
      try {
        parsed = parseIPv4Cidr(cidr);
      } catch {
        throw new ValidationError('migration.invalidSubnetLine', { line: index + 1, value: line });
      }

      const network = (parsed.address & prefixToMask(parsed.prefix)) >>> 0;
      subnets.push({ name: name || `${formatIPv4(network)}/${parsed.prefix}`, network, prefix: parsed.prefix });
    });

  if (subnets.length === 0) throw new ValidationError('migration.noSubnets');
  return subnets;
}

/**
 * Assigns one /64 per IPv4 subnet from an IPv6 site prefix.
 *
 * Strategies:
 *   - "sequential":   subnet IDs 0, 1, 2… in input order (densest packing).
 *   - "ipv4Embedded": the subnet ID is taken from the low bits of the IPv4
 *                     network address, so 172.16.1.128/26 becomes :180::/64
 *                     under a /48. Easy to correlate, but may collide.
 *
 * @param {string} sitePrefixInput e.g. "2001:db8:acad::/48"
 * @param {{ name: string, network: number, prefix: number }[]} subnets
 * @param {{ strategy?: 'sequential' | 'ipv4Embedded' }} [options]
 */
export function planDualStack(sitePrefixInput, subnets, { strategy = 'sequential' } = {}) {
  const parsed = parseIPv6Cidr(sitePrefixInput);
  if (parsed.prefix > SUBNET_BITS) {
    throw new ValidationError('migration.sitePrefixTooLong', { prefix: parsed.prefix });
  }
  if (!Array.isArray(subnets) || subnets.length === 0) throw new ValidationError('migration.noSubnets');

  const sitePrefix = parsed.address & prefixToIPv6Mask(parsed.prefix);
  const subnetIdBits = SUBNET_BITS - parsed.prefix;
  const capacity = 1n << BigInt(subnetIdBits);

  if (BigInt(subnets.length) > capacity) {
    throw new ValidationError('migration.notEnoughSubnets', {
      count: subnets.length,
      available: capacity.toString(),
      prefix: parsed.prefix,
    });
  }

  const usedIds = new Map();
  const allocations = subnets.map((subnet, index) => {
    const subnetId = strategy === 'ipv4Embedded' ? BigInt(subnet.network) & (capacity - 1n) : BigInt(index);

    if (usedIds.has(subnetId)) {
      throw new ValidationError('migration.subnetIdCollision', { first: usedIds.get(subnetId), second: subnet.name });
    }
    usedIds.set(subnetId, subnet.name);

    const ipv6Network = sitePrefix | (subnetId << 64n);
    return {
      name: subnet.name,
      ipv4Network: subnet.network,
      ipv4Prefix: subnet.prefix,
      ipv4Gateway: calculateIPv4Subnet(subnet.network, subnet.prefix).firstHost,
      subnetId,
      ipv6Network,
      ipv6Prefix: SUBNET_BITS,
      ipv6Gateway: ipv6Network | 1n,
    };
  });

  return { sitePrefix, prefix: parsed.prefix, subnetIdBits, capacity, strategy, allocations };
}
