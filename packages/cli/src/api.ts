/**
 * The three server calls the CLI makes. SPEC §8.
 *
 * The server does not exist yet; the shapes below are the CLI's reading of
 * the §8 contract and are exercised against a mock in the test suite:
 *
 *   POST /api/device/start   { machineId, platform, cliVersion }
 *     → { deviceCode, userCode, verificationUrl, expiresIn, interval }
 *   POST /api/device/poll    { deviceCode }
 *     → { status: "pending" }
 *     | { status: "complete", token, handle?, buildings?: string[] }
 *     | { status: "expired" } | { status: "denied" }
 *   POST /api/snapshot       Snapshot, Bearer <token>
 *     → { url, floors, lightsOn, citizenNo }
 */

import type { Snapshot } from "@thetokentown/core/types";

import { VERSION } from "./version.ts";

export const DEFAULT_SITE = "https://thetokentown.dev";

/** `--site` beats the environment beats the default; trailing slash dropped. */
export function resolveSite(flag: string | undefined): string {
  const raw = flag ?? process.env["THETOKENTOWN_SITE_URL"] ?? DEFAULT_SITE;
  return raw.replace(/\/+$/, "");
}

export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function post<T>(
  url: string,
  body: unknown,
  options: { token?: string | undefined; timeoutMs: number },
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": `thetokentown/${VERSION} (${process.platform})`,
  };
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    // undici hides ECONNREFUSED and friends behind "fetch failed".
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (error as Error).message;
    throw new ApiError(`${(error as Error).name === "TimeoutError" ? "timed out" : detail} (${url})`, null);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(`${response.status} ${response.statusText} from ${url}: ${text.slice(0, 200)}`, response.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(`non-JSON reply from ${url}: ${text.slice(0, 200)}`, response.status);
  }
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUrl?: string;
  expiresIn?: number;
  interval?: number;
}

export type DevicePoll =
  | { status: "pending" }
  | { status: "complete"; token: string; handle?: string; buildings?: string[] }
  | { status: "expired" }
  | { status: "denied" };

export interface SnapshotReply {
  url?: string;
  floors?: number;
  lightsOn?: boolean;
  citizenNo?: number;
}

export function deviceStart(site: string, machineId: string): Promise<DeviceStart> {
  return post<DeviceStart>(
    `${site}/api/device/start`,
    { machineId, platform: process.platform, cliVersion: VERSION },
    { timeoutMs: 10_000 },
  );
}

export function devicePoll(site: string, deviceCode: string): Promise<DevicePoll> {
  return post<DevicePoll>(`${site}/api/device/poll`, { deviceCode }, { timeoutMs: 10_000 });
}

export function postSnapshot(
  site: string,
  token: string,
  snapshot: Snapshot,
  timeoutMs: number,
): Promise<SnapshotReply> {
  return post<SnapshotReply>(`${site}/api/snapshot`, snapshot, { token, timeoutMs });
}
