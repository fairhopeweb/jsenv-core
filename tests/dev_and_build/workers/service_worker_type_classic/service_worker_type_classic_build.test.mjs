import { assert } from "@jsenv/assert"

import { build } from "@jsenv/core"
import { startFileServer } from "@jsenv/core/tests/start_file_server.js"
import { executeInChromium } from "@jsenv/core/tests/execute_in_chromium.js"

const test = async (params) => {
  await build({
    logLevel: "warn",
    rootDirectoryUrl: new URL("./client/", import.meta.url),
    buildDirectoryUrl: new URL("./dist/", import.meta.url),
    entryPoints: {
      "./main.html": "main.html",
    },
    ...params,
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
  const { order, serviceWorkerUrls } = returnValue.inspectResponse
  const actual = {
    order,
    serviceWorkerUrls,
  }
  const expected = {
    order: ["before-a", "before-b", "b", "after-b", "after-a"],
    serviceWorkerUrls: {
      "/main.html": { versioned: false, version: "3a9e4d88" },
      "/css/style.css?v=65c914e7": { versioned: true },
      "/js/a.js?v=07327beb": { versioned: true },
      "/js/b.js?v=2cc2d9e4": { versioned: true },
    },
  }
  assert({ actual, expected })
}

if (process.platform === "darwin") {
  await test()
}
