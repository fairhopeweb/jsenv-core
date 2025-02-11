/*
 * - Ensure cache for node modules do not hit the server
 * - Ensure cache is invalidated when package version changes
 */

import { writeFileSync, readFileSync } from "node:fs"
import { chromium } from "playwright"
import { assert } from "@jsenv/assert"

import { startDevServer } from "@jsenv/core"
import { launchBrowserPage } from "@jsenv/core/tests/launch_browser_page.js"

const debug = false // true to have browser UI + keep it open after test
const fooPackageFileUrl = new URL(
  "./client/node_modules/foo/package.json",
  import.meta.url,
)
const fooPackageFileContent = {
  beforeTest: readFileSync(fooPackageFileUrl),
  update: (content) => writeFileSync(fooPackageFileUrl, content),
  restore: () =>
    writeFileSync(fooPackageFileUrl, fooPackageFileContent.beforeTest),
}
const asnwerFileUrl = new URL(
  "./client/node_modules/foo/answer.js",
  import.meta.url,
)
const answerFileContent = {
  beforeTest: readFileSync(asnwerFileUrl),
  update: (content) => writeFileSync(asnwerFileUrl, content),
  restore: () => writeFileSync(asnwerFileUrl, answerFileContent.beforeTest),
}
const serverRequests = []
const devServer = await startDevServer({
  logLevel: "warn",
  rootDirectoryUrl: new URL("./client/", import.meta.url),
  keepProcessAlive: false,
  services: [
    {
      name: "spy_request",
      handleRequest: (request) => {
        serverRequests.push(request)
      },
    },
  ],
  clientAutoreload: false,
  supervisor: false,
})
const browser = await chromium.launch({ headless: !debug })
try {
  const page = await launchBrowserPage(browser)
  await page.goto(`${devServer.origin}/main.html`)
  const getResult = async () => {
    const result = await page.evaluate(
      /* eslint-disable no-undef */
      () => {
        return window.resultPromise
      },
      /* eslint-enable no-undef */
    )
    return result
  }
  const getServerRequestedForFoo = () => {
    return serverRequests.some((request) => {
      return request.pathname.startsWith("/node_modules/foo/")
    })
  }

  {
    const actual = {
      result: await getResult(),
      serverRequestedForFoo: getServerRequestedForFoo(),
    }
    const expected = {
      result: 42,
      serverRequestedForFoo: true,
    }
    assert({ actual, expected })
  }

  // reload page and expect node_modules/foo/index.js to be cached
  // without server request
  {
    serverRequests.length = 0
    await page.reload()
    const actual = {
      result: await getResult(),
      serverRequestedForFoo: getServerRequestedForFoo(),
    }
    const expected = {
      result: 42,
      serverRequestedForFoo: false,
    }
    assert({ actual, expected })
  }

  // now update the package content + version and see if reloading the page updates the result
  {
    serverRequests.length = 0
    answerFileContent.update(`export const answer = 43`)
    fooPackageFileContent.update(
      JSON.stringify(
        {
          name: "foo",
          private: true,
          version: "1.0.1",
        },
        null,
        "  ",
      ),
    )
    // await new Promise((resolve) => setTimeout(resolve, 500))
    await page.reload()

    const actual = {
      result: await getResult(),
      serverRequestedForFoo: getServerRequestedForFoo(),
    }
    const expected = {
      result: 43,
      serverRequestedForFoo: true,
    }
    assert({ actual, expected })
  }
} finally {
  fooPackageFileContent.restore()
  answerFileContent.restore()
  if (!debug) {
    browser.close()
  }
}
