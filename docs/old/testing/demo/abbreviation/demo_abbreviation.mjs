import { executeTestPlan, nodeChildProcess } from "@jsenv/core"

await executeTestPlan({
  roottDirectoryUrl: new URL("./", import.meta.url),
  logLevel: "info",
  testPlan: {
    "*.spec.js": {
      node: {
        runtime: nodeChildProcess,
        captureConsole: true,
      },
    },
  },
  completedExecutionLogAbbreviation: true,
  completedExecutionLogMerging: false,
  defaultMsAllocatedPerExecution: 3000,
})
