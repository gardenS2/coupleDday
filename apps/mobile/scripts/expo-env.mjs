import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, childEnvironment } from "./environment.mjs";
const root = new URL("../", import.meta.url);
const [mode, command, ...extra] = process.argv.slice(2);
try {
  if (!["start", "android", "ios", "export"].includes(command))
    throw new Error("Command must be start, android, ios, or export.");
  const config = loadConfig(root, mode, {
    required: command === "export",
    platform: command,
  });
  const port = mode === "dev" ? "8082" : "8083";
  const args =
    command === "start"
      ? ["start", "--clear", "--port", port]
      : command === "export"
        ? ["export", "--platform", "all", "--clear"]
        : [
            `run:${command}`,
            ...(mode === "prod"
              ? command === "android"
                ? ["--variant", "release"]
                : ["--configuration", "Release"]
              : ["--port", port]),
          ];
  // Use this project's installed Expo CLI, never a shell or downloaded npx fallback.
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("node_modules/expo/bin/cli", root)),
      ...args,
      ...extra,
    ],
    {
      cwd: fileURLToPath(root),
      stdio: "inherit",
      env: childEnvironment(process.env, config),
    },
  );
  child.on("error", () => {
    console.error("Could not start Expo. Run npm ci first.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
