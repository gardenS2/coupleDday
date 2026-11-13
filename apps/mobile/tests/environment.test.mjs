import test from "node:test";
import assert from "node:assert/strict";
import {
  parseConfig,
  childEnvironment,
  files,
} from "../scripts/environment.mjs";
const settings = (url) =>
  `EXPO_PUBLIC_SUPABASE_URL=${url}\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_fixture`;
test("explicit file names and empty development preview", () => {
  assert.equal(files.dev, ".env.dev");
  assert.equal(files.prod, ".env.prod");
  assert.equal(parseConfig("", "dev").EXPO_PUBLIC_SUPABASE_URL, "");
  assert.throws(() => parseConfig("", "prod"));
  assert.throws(() => parseConfig("", "dev", { required: true }));
});
test("production accepts only remote HTTPS and public keys", () => {
  assert.equal(
    parseConfig(settings("https://test.supabase.co"), "prod")
      .EXPO_PUBLIC_SUPABASE_URL,
    "https://test.supabase.co",
  );
  for (const url of [
    "http://test.supabase.co",
    "https://localhost",
    "https://user:password@test.supabase.co",
    "https://test.supabase.co/path",
    "https://test.supabase.co?key=secret",
  ])
    assert.throws(() => parseConfig(settings(url), "prod"));
  assert.throws(() =>
    parseConfig(
      settings("https://test.supabase.co").replace(
        "sb_publishable_test_fixture",
        "sb_secret_private",
      ),
      "prod",
    ),
  );
});
test("reject unexpected keys and malformed config without echoing values", () => {
  assert.throws(
    () =>
      parseConfig(
        settings("https://test.supabase.co") +
          "\nSERVICE_ROLE_KEY=private-value",
        "prod",
      ),
    (error) => !error.message.includes("private-value"),
  );
  assert.throws(() => parseConfig(settings("not-a-url"), "dev"));
  assert.throws(() => parseConfig("", "staging"));
});
test("Android local address mapping does not affect iOS or cloud", () => {
  assert.equal(
    parseConfig(settings("http://127.0.0.1:55431"), "dev", {
      platform: "android",
    }).EXPO_PUBLIC_SUPABASE_URL,
    "http://10.0.2.2:55431",
  );
  assert.equal(
    parseConfig(settings("http://127.0.0.1:55431"), "dev", { platform: "ios" })
      .EXPO_PUBLIC_SUPABASE_URL,
    "http://127.0.0.1:55431",
  );
  assert.equal(
    parseConfig(settings("https://test.supabase.co"), "dev", {
      platform: "android",
    }).EXPO_PUBLIC_SUPABASE_URL,
    "https://test.supabase.co",
  );
});
test("selected file replaces stale public variables and disables automatic dotenv loading", () => {
  const env = childEnvironment(
    {
      PATH: "/bin",
      EXPO_PUBLIC_SUPABASE_URL: "old",
      EXPO_PUBLIC_SECRET: "bad",
      EXPO_NO_DOTENV: "0",
    },
    parseConfig("", "dev"),
  );
  assert.equal(env.EXPO_PUBLIC_SUPABASE_URL, "");
  assert.equal(env.EXPO_PUBLIC_SECRET, undefined);
  assert.equal(env.EXPO_NO_DOTENV, "1");
  assert.equal(env.PATH, "/bin");
});

import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
function fixture(t) {
  const repoRoot = mkdtempSync(join(tmpdir(), "couple-env-test-"));
  const appRoot = join(repoRoot, "apps/mobile");
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(appRoot, "scripts"), { recursive: true });
  mkdirSync(join(appRoot, "node_modules/expo/bin"), { recursive: true });
  mkdirSync(join(repoRoot, "config/env"), { recursive: true });
  for (const name of ["environment.mjs", "expo-env.mjs", "ci-env.mjs"])
    copyFileSync(
      new URL(`../scripts/${name}`, import.meta.url),
      join(appRoot, "scripts", name),
    );
  return { appRoot, repoRoot };
}
test("runner selects exact file and prevents old dotenv values reaching Expo", (t) => {
  const { appRoot, repoRoot } = fixture(t);
  writeFileSync(
    join(repoRoot, "config/env/.env.dev"),
    settings("http://127.0.0.1:55431"),
  );
  writeFileSync(
    join(appRoot, ".env.local"),
    settings("https://wrong.supabase.co"),
  );
  writeFileSync(
    join(appRoot, "node_modules/expo/bin/cli"),
    `require('node:fs').writeFileSync('observed.json', JSON.stringify({url:process.env.EXPO_PUBLIC_SUPABASE_URL,disable:process.env.EXPO_NO_DOTENV,args:process.argv.slice(2)}));`,
  );
  const result = spawnSync(
    process.execPath,
    [join(appRoot, "scripts/expo-env.mjs"), "dev", "android"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        EXPO_PUBLIC_SUPABASE_URL: "https://stale.supabase.co",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(readFileSync(join(appRoot, "observed.json")));
  assert.equal(observed.url, "http://10.0.2.2:55431");
  assert.equal(observed.disable, "1");
  assert.deepEqual(observed.args, ["run:android", "--port", "8082"]);
});
test("CI secret materialization refuses overwrite, does not log key, and cleans file", (t) => {
  const { appRoot, repoRoot } = fixture(t);
  const path = join(appRoot, "scripts/ci-env.mjs");
  const run = (action) =>
    spawnSync(process.execPath, [path, action, "prod"], {
      encoding: "utf8",
      env: {
        ...process.env,
        MOBILE_ENV_FILE: settings("https://test.supabase.co"),
      },
    });
  const result = run("write");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes("sb_publishable_test_fixture"));
  assert.ok(existsSync(join(repoRoot, "config/env/.env.prod")));
  assert.notEqual(run("write").status, 0);
  assert.equal(run("clean").status, 0);
  assert.ok(!existsSync(join(repoRoot, "config/env/.env.prod")));
});
