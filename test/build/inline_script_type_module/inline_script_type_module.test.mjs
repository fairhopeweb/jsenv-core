import { assert } from "@jsenv/assert"

import { build } from "@jsenv/core"
import { executeInChromium } from "@jsenv/core/test/execute_in_chromium.js"

await build({
  logLevel: "warn",
  rootDirectoryUrl: new URL("./client/", import.meta.url),
  buildDirectoryUrl: new URL("./dist/", import.meta.url),
  entryPoints: {
    "./main.html": "main.html",
  },
  sourcemaps: "file",
  bundling: false,
  minification: false,
})
const { returnValue } = await executeInChromium({
  rootDirectoryUrl: new URL("./dist/", import.meta.url),
  htmlFileRelativeUrl: "./main.html",
  /* eslint-disable no-undef */
  pageFunction: async () => {
    return window.namespacePromise
  },
  /* eslint-enable no-undef */
})
const actual = returnValue
const expected = {
  answer: 42,
}
assert({ actual, expected })
