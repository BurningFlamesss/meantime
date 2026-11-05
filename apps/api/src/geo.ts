import { createHash } from "node:crypto";

/**
 * Privacy-preserving geo resolution. The raw client IP is used only in
 * memory, mapped to a coarse geo cluster (e.g. "NA-EAST"), and then
 * discarded. The IP is never stored in plaintext and never sent to the
 * client — impressions and analytics carry only the cluster label.
 *
 * The lookup table is intentionally coarse: first-octet ranges are a
 * placeholder for a real MaxMind/DB-IP dataset loaded at deploy time. What
 * matters architecturally is the boundary: IP in → cluster out, IP gone.
 */

export interface GeoResolution {
  cluster: string; // e.g. "NA-EAST", "EU-WEST", "APAC-SE"
  asn: number | null;
  ipHash: string; // SHA-256 with a per-deploy salt, for equality checks only
}

/**
 * Coarse region bands by first octet — replace with a real GeoIP dataset.
 */
const REGION_BY_FIRST_OCTET: Array<[min: number, max: number, cluster: string]> = [
  [3, 15, "NA-EAST"],
  [16, 34, "NA-WEST"],
  [35, 50, "NA-EAST"],
  [51, 52, "EU-WEST"],
  [52, 54, "NA-WEST"],
  [54, 76, "EU-WEST"],
  [77, 88, "EU-CENTRAL"],
  [89, 95, "EU-EAST"],
  [101, 106, "APAC-SE"],
  [110, 126, "APAC-EAST"],
  [128, 143, "NA-EAST"],
  [144, 172, "NA-WEST"],
  [176, 188, "EU-WEST"],
  [196, 197, "AF-NORTH"],
  [200, 201, "LATAM"],
  [202, 203, "APAC-SE"],
];

/**
 * The salt comes from the validated environment, threaded through by callers.
 * It must not be read at module scope: ES-module top-level code runs before
 * `loadEnv()` populates process.env, which would silently bake in a
 * placeholder for every deployment.
 */
export function resolveGeo(ip: string | undefined, salt: string): GeoResolution {
  const ipHash = createHash("sha256").update(`${salt}:${ip ?? ""}`).digest("hex");
  if (!ip) return { cluster: "XX-UNKNOWN", asn: null, ipHash };

  // Private / loopback / CGNAT ranges get a local cluster.
  if (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("127.") ||
    ip.startsWith("169.254.") ||
    ip.startsWith("100.64.") ||
    ip === "::1"
  ) {
    return { cluster: "XX-LOCAL", asn: null, ipHash };
  }

  const first = Number(ip.split(".")[0]);
  if (Number.isNaN(first)) return { cluster: "XX-UNKNOWN", asn: null, ipHash };
  for (const [min, max, cluster] of REGION_BY_FIRST_OCTET) {
    if (first >= min && first <= max) return { cluster, asn: null, ipHash };
  }
  return { cluster: "XX-UNKNOWN", asn: null, ipHash };
}

/**
 * Map an IP to a geo cluster for campaign-target matching. Returns the same
 * coarse label used everywhere else so the raw IP never crosses this module.
 */
export function clusterForIp(ip: string | undefined, salt: string): string {
  return resolveGeo(ip, salt).cluster;
}
