import { writeFileSync, unlinkSync } from "node:fs";
import { configFile, files, parseConfig } from "./environment.mjs";
const [action, mode] = process.argv.slice(2);
try {
  if (!files[mode]) throw new Error("Environment must be dev or prod.");
  const target = configFile(new URL("../", import.meta.url), mode);
  if (action === "clean") {
    try {
      unlinkSync(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } else if (action === "write") {
    const config = parseConfig(process.env.MOBILE_ENV_FILE || "", mode, {
      required: true,
    });
    writeFileSync(
      target,
      Object.entries(config)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") + "\n",
      { mode: 0o600, flag: "wx" },
    );
    console.log("Environment file created. Values are not logged.");
  } else throw new Error("Action must be write or clean.");
} catch (error) {
  console.error(
    error.code
      ? "Could not write or clean the CI environment file."
      : error.message,
  );
  process.exitCode = 1;
}
