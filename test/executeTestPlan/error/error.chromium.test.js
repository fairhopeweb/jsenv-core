import { assert } from "@jsenv/assert"
import { launchChromium } from "@jsenv/chromium-launcher"
import { fileHrefToFolderRelativePath } from "../../file-href-to-folder-relative-path.js"
import { test } from "../../../index.js"
import { TESTING_TEST_PARAM } from "../testing-test-param.js"

const folderRelativePath = fileHrefToFolderRelativePath(import.meta.url)
const compileIntoRelativePath = `${folderRelativePath}/.dist`
const fileRelativeUrl = `${folderRelativePath}/file.spec.js`
const executeDescription = {
  [fileRelativeUrl]: {
    chromium: {
      launch: launchChromium,
    },
  },
}

const actual = await test({
  ...TESTING_TEST_PARAM,
  compileIntoRelativePath,
  executeDescription,
  captureConsole: true,
})
const expected = {
  summary: {
    executionCount: 1,
    disconnectedCount: 0,
    timedoutCount: 0,
    erroredCount: 1,
    completedCount: 0,
  },
  report: {
    [fileRelativeUrl]: {
      chromium: {
        status: "errored",
        error: new Error(`ask() should return 42, got 40`),
        platformLog: "",
        platformName: "chromium",
        platformVersion: actual.report[fileRelativeUrl].chromium.platformVersion,
      },
    },
  },
}
assert({ actual, expected })
