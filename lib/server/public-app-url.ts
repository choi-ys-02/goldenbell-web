import "server-only";

import { networkInterfaces } from "node:os";

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isPrivateIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;

  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function getLanIpv4Address() {
  const interfaces = networkInterfaces();
  const names = Object.keys(interfaces).sort((left, right) => {
    const priority = (name: string) => name === "en0" ? 0 : name === "en1" ? 1 : 2;
    return priority(left) - priority(right);
  });

  for (const name of names) {
    for (const address of interfaces[name] ?? []) {
      if (address.family === "IPv4" && !address.internal && isPrivateIpv4(address.address)) {
        return address.address;
      }
    }
  }

  return null;
}

function configuredBaseUrl() {
  const value = process.env.APP_BASE_URL?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicAppBaseUrl(requestOrigin: string) {
  const configured = configuredBaseUrl();
  if (configured) return configured;

  const origin = new URL(requestOrigin);
  if (isLoopbackHost(origin.hostname) && process.env.NODE_ENV !== "production") {
    const lanAddress = getLanIpv4Address();
    if (lanAddress) {
      origin.hostname = lanAddress;
    }
  }

  return origin.origin;
}

export function getPublicJoinUrl(requestOrigin: string) {
  return new URL("/join", `${getPublicAppBaseUrl(requestOrigin)}/`).toString();
}
