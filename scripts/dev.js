import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function waitForServer(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      http.get(url, (res) => {
        resolve();
      }).on("error", () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout waiting for ${url}`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

async function main() {
  // Start backend
  const backend = spawn("npm", ["run", "dev:backend"], {
    stdio: "inherit",
    shell: true,
    cwd: root,
  });

  // Start frontend
  const frontend = spawn("npm", ["run", "dev:frontend"], {
    stdio: "inherit",
    shell: true,
    cwd: root,
  });

  const shutdown = (code) => {
    backend.kill("SIGTERM");
    frontend.kill("SIGTERM");
    process.exit(code || 0);
  };

  backend.on("exit", (code) => shutdown(code));
  frontend.on("exit", (code) => shutdown(code));

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  // Give backend a moment to initialize before starting frontend
  await new Promise((r) => setTimeout(r, 500));

  // Wait for Vite to actually respond to HTTP requests
  try {
    await waitForServer("http://127.0.0.1:5174");
    // Auto-open browser on Windows
    spawn("cmd", ["/c", "start", "http://127.0.0.1:5174"], {
      stdio: "ignore",
      detached: true,
    }).unref();
  } catch (e) {
    console.error("Warning: Could not verify frontend is ready:", e.message);
  }
}

main();

