import { executeTestPlan, nodeProcess } from "@jsenv/core"

await executeTestPlan({
  rootDirectoryUrl: new URL("../../", import.meta.url),
  testPlan: {
    "test/**/*.test.mjs": {
      node: {
        runtime: nodeProcess,
      },
    },
    "test/**/react_build.test.mjs": {
      node: {
        runtime: nodeProcess,
        allocatedMs: 90_000,
      },
    },
  },
  completedExecutionLogMerging: true,
  coverage: process.argv.includes("--coverage"),
})
