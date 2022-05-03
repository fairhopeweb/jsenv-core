import { assert } from "@jsenv/assert"

import { build } from "@jsenv/core"

import { startFileServer } from "@jsenv/core/test/start_file_server.js"
import { executeInChromium } from "@jsenv/core/test/execute_in_chromium.js"

await build({
  logLevel: "warn",
  rootDirectoryUrl: new URL("./client/", import.meta.url),
  buildDirectoryUrl: new URL("./dist/", import.meta.url),
  entryPoints: {
    "./main.html": "main.html",
  },
  minification: false,
  versioning: false,
  runtimeCompat: {
    chrome: "55",
    edge: "14",
    firefox: "52",
    safari: "11",
  },
})
const server = await startFileServer({
  rootDirectoryUrl: new URL("./dist/", import.meta.url),
})
const { returnValue } = await executeInChromium({
  url: `${server.origin}/main.html`,
  /* eslint-disable no-undef */
  pageFunction: async () => {
    return window.resultPromise
  },
  /* eslint-enable no-undef */
})
const actual = {
  returnValue,
}
const expected = {
  returnValue: {
    a: "a",
    b: "b",
  },
}
assert({ actual, expected })
