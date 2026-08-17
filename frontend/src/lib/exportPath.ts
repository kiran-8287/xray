/**
 * exportPath.ts — utilities for validating and normalizing the user-configurable
 * export destination (the folder where generated images / annotations are saved).
 *
 * Which path convention is valid depends on the operating system of the BACKEND
 * server (returned as `platform` by GET /api/user-config/exports-path), not the
 * browser the user happens to be running. That mismatch is the most common cause
 * of "wrong path" mistakes, so every hint below is derived from that value.
 */

export type ServerPlatform = "win32" | "linux" | "darwin" | "freebsd" | "openbsd" | "sunos" | "aix" | string;

/** Strip one or more trailing `/` or `\` separators. */
export function stripTrailingSeparators(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

/** Trim, drop a surrounding pair of quotes, and remove a dangling separator. */
export function normalizePathInput(raw: string): string {
  let v = (raw || "").trim();
  if (!v) return "";
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return stripTrailingSeparators(v);
}

export interface PathValidation {
  ok: boolean;
  normalized?: string;
  error?: string;
}

/**
 * Validate that the typed path is usable as the export destination.
 *  - Must be an absolute path in the server platform's convention.
 *  - No `..` traversal, no illegal Windows characters.
 */
export function validateExportPath(raw: string, platform: ServerPlatform | "", dataMountPath?: string): PathValidation {
  const v = normalizePathInput(raw);
  if (!v) {
    return { ok: false, error: 'Enter an absolute folder path, or choose "Use Default".' };
  }
  if (v.split(/[\\/]+/).includes("..")) {
    return { ok: false, error: 'The path must not contain ".." — directory traversal is not allowed.' };
  }
  if (/[<>"|?*]/.test(v)) {
    return { ok: false, error: 'The path contains invalid characters: < > " | ? *' };
  }

  const isWindowsDrive = /^[a-zA-Z]:[\\/]/.test(v);
  const isUnixAbsolute = v.startsWith("/");
  const isUnc = v.startsWith("\\\\");

  if (platform === "win32") {
    if (!isWindowsDrive && !isUnc) {
      return {
        ok: false,
        error:
          'The server runs on Windows, so use an absolute Windows path, e.g. C:\\XrayExports or C:/XrayExports (the drive letter is required).',
      };
    }
  } else if (platform === "linux" || platform === "darwin" || platform === "freebsd" || platform === "openbsd" || platform === "sunos" || platform === "aix") {
    if (!isUnixAbsolute) {
      return {
        ok: false,
        error:
          platform === "darwin"
            ? "The server runs on macOS, so use an absolute path, e.g. /Users/you/XrayExports (must start with /)."
            : "The server runs on Linux, so use an absolute path, e.g. /home/you/XrayExports (must start with /).",
      };
    }
  } else {
    // Platform not disclosed — accept either convention.
    if (!isWindowsDrive && !isUnixAbsolute && !isUnc) {
      return {
        ok: false,
        error:
          "Use an absolute path — on Windows e.g. C:\\XrayExports, on Linux/macOS e.g. /home/you/XrayExports.",
      };
    }
  }

  if (dataMountPath) {
    const mountPath = dataMountPath.replace(/[\\/]+$/, "");
    if (v !== mountPath && !v.startsWith(mountPath + "/")) {
      return {
        ok: false,
        error: `When running in Docker, custom export paths must be under ${dataMountPath}/… (the only folder bind-mounted to the host). For example: ${dataMountPath}/exports2`,
      };
    }
  }

  return { ok: true, normalized: v };
}

/** Human-readable name of the backend platform for UI hints. */
export function platformDisplayName(platform: ServerPlatform | ""): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  if (platform === "freebsd" || platform === "openbsd" || platform === "sunos" || platform === "aix") return "Linux/Unix";
  return "server";
}