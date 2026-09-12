import { ValidationError } from './errors.js';
import { parseIPv4 } from './ipv4.js';

/**
 * IPv6 addresses are 128-bit values, far beyond the 53 bits a JavaScript
 * number can represent exactly, so all arithmetic here uses BigInt.
 */

export const IPV6_BITS = 128;

const GROUP_COUNT = 8;
const GROUP_BITS = 16n;
const MAX_ADDRESS = (1n << 128n) - 1n;
const HEXTET_PATTERN = /^[0-9a-f]{1,4}$/i;
const PREFIX_PATTERN = /^\d{1,3}$/;

/**
 * Converts an embedded dotted-quad suffix (e.g. "::ffff:192.0.2.1") into two
 * hexadecimal groups.
 *
 * @param {string[]} groups
 * @returns {string[]}
 */
function expandEmbeddedIPv4(groups) {
  const last = groups.at(-1);
  if (!last || !last.includes('.')) return groups;

  let ipv4;
  try {
    ipv4 = parseIPv4(last);
  } catch {
    throw new ValidationError('ipv6.invalidEmbeddedIPv4', { value: last });
  }
  return [...groups.slice(0, -1), (ipv4 >>> 16).toString(16), (ipv4 & 0xffff).toString(16)];
}

/**
 * Parses any valid textual IPv6 representation (RFC 4291) into a BigInt.
 *
 * @param {string} input
 * @returns {bigint}
 */
export function parseIPv6(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new ValidationError('ipv6.empty');
  if (value.includes('%')) throw new ValidationError('ipv6.zoneNotSupported', { value });

  const sections = value.split('::');
  if (sections.length > 2) throw new ValidationError('ipv6.multipleCompressions', { value });

  const toGroups = (section) => (section === '' ? [] : section.split(':'));
  const isCompressed = sections.length === 2;

  let groups;
  if (isCompressed) {
    const head = toGroups(sections[0]);
    const tail = expandEmbeddedIPv4(toGroups(sections[1]));
    const missing = GROUP_COUNT - head.length - tail.length;
    // "::" must stand for at least one group of zeros.
    if (missing < 1) throw new ValidationError('ipv6.invalidGroupCount', { value });
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = expandEmbeddedIPv4(toGroups(value));
    if (groups.length !== GROUP_COUNT) throw new ValidationError('ipv6.invalidGroupCount', { value });
  }

  return groups.reduce((result, group) => {
    if (!HEXTET_PATTERN.test(group)) {
      throw new ValidationError('ipv6.invalidGroup', { value, group: group || '(empty)' });
    }
    return (result << GROUP_BITS) | BigInt(`0x${group}`);
  }, 0n);
}

/**
 * @param {bigint} address
 * @returns {number[]} The eight 16-bit groups, most significant first.
 */
function toGroups(address) {
  return Array.from({ length: GROUP_COUNT }, (_, index) =>
    Number((address >> (BigInt(GROUP_COUNT - 1 - index) * GROUP_BITS)) & 0xffffn),
  );
}

/**
 * Formats an address following RFC 5952: lowercase, no leading zeros and the
 * longest run (2+ groups) of zeros compressed to "::".
 *
 * @param {bigint} address
 * @returns {string}
 */
export function formatIPv6(address) {
  const groups = toGroups(address);

  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  groups.forEach((group, index) => {
    if (group !== 0) {
      runStart = -1;
      return;
    }
    if (runStart === -1) runStart = index;
    const runLength = index - runStart + 1;
    if (runLength > bestLength) {
      bestStart = runStart;
      bestLength = runLength;
    }
  });

  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(':');

  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

/**
 * @param {bigint} address
 * @returns {string} Fully expanded form, e.g. "2001:0db8:0000:...".
 */
export function expandIPv6(address) {
  return toGroups(address)
    .map((group) => group.toString(16).padStart(4, '0'))
    .join(':');
}

/**
 * Parses "address/prefix" notation, e.g. "2001:db8::/32".
 *
 * @param {string} input
 * @returns {{ address: bigint, prefix: number }}
 */
export function parseIPv6Cidr(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new ValidationError('ipv6.empty');

  const parts = value.split('/');
  if (parts.length > 2) throw new ValidationError('ipv6.invalidFormat', { value });

  const [addressPart, prefixPart] = parts.map((part) => part.trim());
  const address = parseIPv6(addressPart);

  if (prefixPart === undefined || prefixPart === '') {
    throw new ValidationError('ipv6.missingPrefix', { value });
  }
  if (!PREFIX_PATTERN.test(prefixPart) || Number(prefixPart) > IPV6_BITS) {
    throw new ValidationError('ipv6.invalidPrefix', { value: prefixPart });
  }

  return { address, prefix: Number(prefixPart) };
}

/** Well-known ranges (RFC 6890 / IANA registry), most specific first. */
const SPECIAL_RANGES = [
  ['::/128', 'unspecified'],
  ['::1/128', 'loopback'],
  ['::ffff:0:0/96', 'ipv4Mapped'],
  ['64:ff9b::/96', 'nat64'],
  ['2001:db8::/32', 'documentation'],
  ['2001::/32', 'teredo'],
  ['2002::/16', 'sixToFour'],
  ['fe80::/10', 'linkLocal'],
  ['ff00::/8', 'multicast'],
  ['fc00::/7', 'uniqueLocal'],
  ['2000::/3', 'globalUnicast'],
].map(([cidr, scope]) => {
  const { address, prefix } = parseIPv6Cidr(cidr);
  return { network: address, mask: prefixToMask(prefix), scope };
});

/**
 * @param {number} prefix
 * @returns {bigint}
 */
function prefixToMask(prefix) {
  const hostBits = BigInt(IPV6_BITS - prefix);
  return MAX_ADDRESS ^ ((1n << hostBits) - 1n);
}

/**
 * @param {bigint} address
 * @returns {string} Scope identifier, e.g. "globalUnicast" or "linkLocal".
 */
export function getIPv6Scope(address) {
  const match = SPECIAL_RANGES.find(({ network, mask }) => (address & mask) === network);
  return match ? match.scope : 'reserved';
}

/**
 * @param {bigint} address
 * @param {number} prefix
 */
export function calculateIPv6Subnet(address, prefix) {
  const hostBits = IPV6_BITS - prefix;
  const totalAddresses = 1n << BigInt(hostBits);
  const network = address & prefixToMask(prefix);

  return {
    address,
    prefix,
    hostBits,
    network,
    lastAddress: network | (totalAddresses - 1n),
    totalAddresses,
    // Number of standard /64 LAN segments that fit in this prefix.
    subnets64: prefix <= 64 ? 1n << BigInt(64 - prefix) : null,
    scope: getIPv6Scope(address),
  };
}

/**
 * Splits a (possibly huge) BigInt into scientific-notation parts so the UI
 * can render e.g. 7.92 × 10^28.
 *
 * @param {bigint} value Non-negative integer.
 * @param {number} [fractionDigits=2]
 * @returns {{ mantissa: string, exponent: number }}
 */
export function toScientificParts(value, fractionDigits = 2) {
  const digits = value.toString();
  let exponent = digits.length - 1;
  // 17 significant digits are enough for Number to round the mantissa correctly.
  let mantissa = Number(`${digits[0]}.${digits.slice(1, 17) || '0'}`).toFixed(fractionDigits);

  if (Number(mantissa) >= 10) {
    // Rounding overflowed (e.g. 9.999 -> 10.00): renormalise.
    mantissa = (Number(mantissa) / 10).toFixed(fractionDigits);
    exponent += 1;
  }
  return { mantissa, exponent };
}
