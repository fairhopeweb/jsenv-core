import { assert } from "@jsenv/assert"

import { startDevServer } from "@jsenv/core"
import { executeInChromium } from "@jsenv/core/tests/execute_in_chromium.js"

const devServer = await startDevServer({
  logLevel: "warn",
  rootDirectoryUrl: new URL("./client/", import.meta.url),
  keepProcessAlive: false,
  port: 0,
})
const { pageLogs, pageErrors } = await executeInChromium({
  url: `${devServer.origin}/main.html`,
  /* eslint-disable no-undef */
  pageFunction: async () => {
    return window.namespacePromise
  },
  /* eslint-enable no-undef */
})
const actual = {
  pageLogs,
  pageErrors,
}
const expected = {
  pageLogs: [], // ensure there is no warning about preload link not used
  pageErrors: [],
}
assert({ actual, expected })
