import { ValidationError } from './errors.js';

/**
 * IPv4 addresses are handled as unsigned 32-bit integers stored in regular
 * JavaScript numbers. Bitwise operators work on signed 32-bit integers, so
 * results are normalised back to unsigned with `>>> 0`.
 */

export const IPV4_BITS = 32;
export const IPV4_ADDRESS_COUNT = 2 ** IPV4_BITS;

const ALL_ONES = 0xffffffff;
const OCTET_PATTERN = /^(0|[1-9]\d{0,2})$/;
const PREFIX_PATTERN = /^\d{1,2}$/;

/**
 * Parses a dotted-decimal IPv4 address ("192.168.1.10") into an integer.
 * Leading zeros are rejected because many systems interpret them as octal.
 *
 * @param {string} input
 * @returns {number}
 */
export function parseIPv4(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new ValidationError('ipv4.empty');

  const octets = value.split('.');
  if (octets.length !== 4) throw new ValidationError('ipv4.invalidFormat', { value });

  return octets.reduce((result, octet) => {
    if (!OCTET_PATTERN.test(octet)) {
      throw new ValidationError('ipv4.invalidOctet', { value, octet });
    }
    if (Number(octet) > 255) {
      throw new ValidationError('ipv4.octetOutOfRange', { value, octet });
    }
    return result * 256 + Number(octet);
  }, 0);
}

/**
 * @param {number} address Unsigned 32-bit integer.
 * @returns {string} Dotted-decimal representation.
 */
export function formatIPv4(address) {
  return [24, 16, 8, 0].map((shift) => (address >>> shift) & 0xff).join('.');
}

/**
 * @param {number} address
 * @returns {string[]} Four 8-character binary strings, one per octet.
 */
export function toBinaryOctets(address) {
  return [24, 16, 8, 0].map((shift) => ((address >>> shift) & 0xff).toString(2).padStart(8, '0'));
}

/**
 * @param {number} prefix Prefix length between 0 and 32.
 * @returns {number} Subnet mask as an integer (e.g. 24 -> 0xffffff00).
 */
export function prefixToMask(prefix) {
  // A shift count of 32 is taken modulo 32 in JavaScript, so /0 needs a special case.
  return prefix === 0 ? 0 : (ALL_ONES << (IPV4_BITS - prefix)) >>> 0;
}

/**
 * Converts a subnet mask into its prefix length, rejecting non-contiguous
 * masks such as 255.0.255.0.
 *
 * @param {number} mask
 * @returns {number}
 */
export function maskToPrefix(mask) {
  const hostBits = ~mask >>> 0;
  // A valid wildcard is of the form 2^n - 1 (all host bits set, nothing else).
  if ((hostBits & (hostBits + 1)) !== 0) {
    throw new ValidationError('ipv4.nonContiguousMask', { mask: formatIPv4(mask) });
  }
  return IPV4_BITS - Math.log2(hostBits + 1);
}

/**
 * Accepts a prefix ("24" or "/24") or a dotted mask ("255.255.255.0").
 *
 * @param {string} input
 * @returns {number} Prefix length.
 */
export function parseMask(input) {
  const value = String(input ?? '').trim();

  if (value.includes('.')) {
    let mask;
    try {
      mask = parseIPv4(value);
    } catch {
      throw new ValidationError('ipv4.invalidMask', { value });
    }
    return maskToPrefix(mask);
  }

  const digits = value.replace(/^\//, '');
  if (!PREFIX_PATTERN.test(digits) || Number(digits) > IPV4_BITS) {
    throw new ValidationError('ipv4.invalidPrefix', { value });
  }
  return Number(digits);
}

/**
 * Parses an address together with its mask. Supported formats:
 *   192.168.1.10/24
 *   192.168.1.10/255.255.255.0
 *   192.168.1.10 255.255.255.0
 *
 * @param {string} input
 * @returns {{ address: number, prefix: number }}
 */
export function parseIPv4Cidr(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new ValidationError('ipv4.empty');

  const parts = value.split(/\s*\/\s*|\s+/);
  if (parts.length > 2) throw new ValidationError('ipv4.invalidFormat', { value });

  const [addressPart, maskPart] = parts;
  const address = parseIPv4(addressPart);
  if (maskPart === undefined || maskPart === '') {
    throw new ValidationError('ipv4.missingPrefix', { value });
  }

  return { address, prefix: parseMask(maskPart) };
}

/**
 * Returns the classful network class of an address (historical, but still
 * widely taught and used as a reference).
 *
 * @param {number} address
 * @returns {{ name: 'A' | 'B' | 'C' | 'D' | 'E', defaultPrefix: number | null }}
 */
export function getIPv4Class(address) {
  const firstOctet = address >>> 24;
  if (firstOctet < 128) return { name: 'A', defaultPrefix: 8 };
  if (firstOctet < 192) return { name: 'B', defaultPrefix: 16 };
  if (firstOctet < 224) return { name: 'C', defaultPrefix: 24 };
  if (firstOctet < 240) return { name: 'D', defaultPrefix: null };
  return { name: 'E', defaultPrefix: null };
}

/** Special-purpose ranges (RFC 6890), ordered from most to least specific. */
const SPECIAL_RANGES = [
  ['255.255.255.255/32', 'broadcast'],
  ['192.0.2.0/24', 'documentation'],
  ['198.51.100.0/24', 'documentation'],
  ['203.0.113.0/24', 'documentation'],
  ['169.254.0.0/16', 'linkLocal'],
  ['192.168.0.0/16', 'private'],
  ['198.18.0.0/15', 'benchmarking'],
  ['172.16.0.0/12', 'private'],
  ['100.64.0.0/10', 'sharedAddressSpace'],
  ['0.0.0.0/8', 'thisNetwork'],
  ['10.0.0.0/8', 'private'],
  ['127.0.0.0/8', 'loopback'],
  ['224.0.0.0/4', 'multicast'],
  ['240.0.0.0/4', 'reserved'],
].map(([cidr, scope]) => {
  const { address, prefix } = parseIPv4Cidr(cidr);
  return { network: address, mask: prefixToMask(prefix), scope };
});

/**
 * @param {number} address
 * @returns {string} Scope identifier, e.g. "private", "loopback" or "public".
 */
export function getIPv4Scope(address) {
  const match = SPECIAL_RANGES.find(({ network, mask }) => ((address & mask) >>> 0) === network);
  return match ? match.scope : 'public';
}

/**
 * Computes every property of the subnet that contains `address`.
 *
 * /31 networks follow RFC 3021 (point-to-point links: both addresses are
 * usable, no broadcast) and /32 represents a single host.
 *
 * @param {number} address
 * @param {number} prefix
 */
export function calculateIPv4Subnet(address, prefix) {
  const mask = prefixToMask(prefix);
  const wildcard = ~mask >>> 0;
  const network = (address & mask) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const totalAddresses = 2 ** (IPV4_BITS - prefix);

  let firstHost = network + 1;
  let lastHost = broadcast - 1;
  let usableHosts = totalAddresses - 2;

  if (prefix === 32) {
    firstHost = network;
    lastHost = network;
    usableHosts = 1;
  } else if (prefix === 31) {
    firstHost = network;
    lastHost = broadcast;
    usableHosts = 2;
  }

  return {
    address,
    prefix,
    mask,
    wildcard,
    network,
    broadcast,
    hasBroadcast: prefix < 31,
    firstHost,
    lastHost,
    totalAddresses,
    usableHosts,
    ipClass: getIPv4Class(address),
    scope: getIPv4Scope(address),
  };
}
