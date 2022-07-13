import { Script } from "node:vm"
import { assert } from "@jsenv/assert"

import { startDevServer } from "@jsenv/core"
import { executeInChromium } from "@jsenv/core/tests/execute_in_chromium.js"

let warnCalls = []
const warn = console.warn
console.warn = (...args) => {
  warnCalls.push(args.join(""))
}
try {
  const devServer = await startDevServer({
    logLevel: "warn",
    omegaServerLogLevel: "warn",
    rootDirectoryUrl: new URL("./client/", import.meta.url),
    keepProcessAlive: false,
    htmlSupervisor: true,
    devServerAutoreload: false,
  })
  const { returnValue, pageLogs, pageErrors } = await executeInChromium({
    url: `${devServer.origin}/main.html`,
    collectConsole: true,
    collectErrors: true,
    /* eslint-disable no-undef */
    pageFunction: async () => {
      return window.__html_supervisor__.getScriptExecutionResults()
    },
    /* eslint-enable no-undef */
  })

  const error = new Script(returnValue.exceptionSource, {
    filename: "",
  }).runInThisContext()
  const actual = {
    serverWarnOutput: warnCalls.join("\n"),
    pageLogs,
    pageErrors,
    error,
  }
  const expected = {
    serverWarnOutput: `GET ${devServer.origin}/foo.js
  [33m404[0m Failed to fetch url content
  --- reason ---
  no entry on filesystem
  --- url ---
  ${new URL("./client/foo.js", import.meta.url).href}
  --- url reference trace ---
  ${new URL("./client/intermediate.js", import.meta.url)}:2:7
    1 | // eslint-disable-next-line import/no-unresolved
  > 2 | import "./foo.js"
              ^
    3 | 
  --- plugin name ---
  "jsenv:file_url_fetching"`,
    pageLogs: [
      {
        type: "error",
        text: `Failed to load resource: the server responded with a status of 404 (no entry on filesystem)`,
      },
    ],
    pageErrors: [
      Object.assign(
        new Error(
          `Failed to fetch dynamically imported module: ${devServer.origin}/main.js`,
        ),
        {
          name: "TypeError",
        },
      ),
    ],
    error: new TypeError(
      `Failed to fetch dynamically imported module: ${devServer.origin}/main.js`,
    ),
  }
  assert({ actual, expected })
} finally {
  console.warn = warn
}
