import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],

  // Tests get their own throwaway Postgres so runs are deterministic and the
  // dev database is never touched. `npm test` deletes .data-test first.
  webServer: {
    command: `npx next dev --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      SQLITE_PATH: ".data-test/family.sqlite",
      PARENT_PIN: "246810",
      SESSION_SECRET: "test-secret-0000000000000000000000000000",
      // Deliberately different from the runtime zone the suite forces
      // (TZ=America/Los_Angeles in the test script). A household at +8 against a
      // runtime at -7 is the hard case: any date maths that leaks into local
      // time comes out a day wrong. Running both at +8 is why the shiftDay bug
      // shipped, so the suite refuses to.
      NEXT_PUBLIC_FAMILY_TZ: "Asia/Singapore",
      CRON_SECRET: "test-cron-secret",
      // Explicitly empty: .env.local sets this for the real deployment, and the
      // suite asserts the unconfigured default.
      ROOT_REDIRECT_URL: "",
      // A throwaway VAPID pair generated solely for this suite, so the send path runs
      // for real against a dead endpoint. It has never signed a live notification and
      // is not the deployment's key — those live in `wrangler secret`.
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "BN--0nmGxD7hqZRLCoW_F2_BTynnkymNjUMY2YoIeWtre0YR841R5Auun1OoMDq1qbUNJ39ns4RRRfs38OMrmUc",
      VAPID_PRIVATE_KEY: "OBSQPNLyaJp14dXmVSwcEdPtsoPrID4pwRwafxAfUxA", // gitleaks:allow test fixture, never used live
      VAPID_SUBJECT: "mailto:test@example.test",
    },
  },
});
