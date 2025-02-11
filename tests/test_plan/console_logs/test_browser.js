import { startDevServer, executeTestPlan, chromium } from "@jsenv/core"

const devServer = await startDevServer({
  logLevel: "warn",
  rootDirectoryUrl: new URL("./", import.meta.url),
  keepProcessAlive: false,
  port: 0,
})
await executeTestPlan({
  logLevel: "info",
  logRuntime: false,
  logEachDuration: false,
  logSummary: false,
  rootDirectoryUrl: new URL("./", import.meta.url),
  devServerOrigin: devServer.origin,
  testPlan: {
    "./client/main.html": {
      chrome: {
        runtime: chromium,
        collectConsole: true,
      },
    },
  },
})
