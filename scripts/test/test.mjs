import { executeTestPlan, nodeWorkerThread } from "@jsenv/core"
import { rootDirectoryUrl, runtimeCompat } from "@jsenv/core/jsenv.config.mjs"

await executeTestPlan({
  rootDirectoryUrl,
  runtimeCompat,
  logLevel: "info",
  testPlan: {
    "tests/**/*.test.mjs": {
      node: {
        runtime: nodeWorkerThread,
        allocatedMs: 30_000,
      },
    },
    "tests/**/coverage_universal.test.mjs": {
      node: {
        runtime: nodeWorkerThread,
        allocatedMs: 60_000,
      },
    },
    "tests/**/*_browsers.test.mjs": {
      node: {
        runtime: nodeWorkerThread,
        allocatedMs: 60_000,
      },
    },
  },
  // completedExecutionLogMerging: true,
  logMemoryHeapUsage: true,
  // completedExecutionLogMerging: true,
  // completedExecutionLogAbbreviation: false,
  coverageEnabled: process.argv.includes("--coverage"),
  coverageConfig: {
    "./src/**/*.js": true,
    "./src/**/*.mjs": true,
    "./packages/*/src/*.js": true,
    "./packages/*/src/*.mjs": true,
    "./**/*.test.*": false,
    "./**/test/": false,
  },
})
