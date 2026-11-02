import { testDatabaseUrl } from "./db";
import { runYarn } from "./run-yarn";

/** Creates the test database if needed and applies all migrations, once per test run. */
export default function setup() {
  runYarn(["prisma", "migrate", "deploy"], { ...process.env, DATABASE_URL: testDatabaseUrl() });
}
