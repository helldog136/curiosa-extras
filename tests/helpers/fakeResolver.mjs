// A faithful stand-in for `lookup(host, { all: true, verbatim: true })` of node:dns/promises: never a real network.
// It answers a list of { address, family } like the real one, and an unknown name fails the same way (an Error with code ENOTFOUND).
import { isIP } from "node:net";

/** `table`: name -> one address, a list of addresses, or an Error to throw. The returned function keeps the names it was asked for in `.calls`. */
export function fakeResolver(table) {
  const calls = [];
  const resolve = async (host) => {
    calls.push(host);
    const found = Object.hasOwn(table, host) ? table[host] : undefined;
    if (found instanceof Error) throw found;
    if (found === undefined) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND", syscall: "getaddrinfo", hostname: host });
    return [].concat(found).map((address) => ({ address, family: isIP(address) }));
  };
  return Object.assign(resolve, { calls });
}

/** Public addresses used by tests for the invented servers (".example" names never resolve on the real network). */
export const PUBLIC_V4 = "93.184.215.14", PUBLIC_V6 = "2a01:4f8:c0c:1::1";
