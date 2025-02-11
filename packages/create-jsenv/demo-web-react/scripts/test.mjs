/*
 * Execute all test files
 * - npm test
 * - npm test:coverage
 */

import { pingServer, executeTestPlan, chromium, webkit } from "@jsenv/core"

import { rootDirectoryUrl, plugins } from "../jsenv.config.mjs"

const devServerOrigin = "http://localhost:3401"
const devServerStarted = await pingServer(devServerOrigin)
let devServerModule
if (!devServerStarted) {
  devServerModule = await import("./start_dev_server.mjs")
}
try {
  await executeTestPlan({
    rootDirectoryUrl,
    devServerOrigin,
    plugins,
    testPlan: {
      "./tests/**/*.test.html": {
        chromium: {
          runtime: chromium,
        },
        webkit: {
          runtime: webkit,
        },
      },
    },
    coverageEnabled: process.argv.includes("--coverage"),
    coverageMethodForBrowsers: "istanbul",
  })
} finally {
  if (devServerModule) {
    devServerModule.devServer.stop()
  }
}
