import { basename } from "path"
import { assert } from "@jsenv/assert"
import { resolveDirectoryUrl, urlToRelativeUrl } from "@jsenv/util"
import { jsenvCoreDirectoryUrl } from "@jsenv/core/src/internal/jsenvCoreDirectoryUrl.js"
import { buildProject } from "@jsenv/core/index.js"
import { browserImportSystemJsBundle } from "../browserImportSystemJsBundle.js"
import {
  GENERATE_SYSTEMJS_BUNDLE_TEST_PARAMS,
  IMPORT_SYSTEM_JS_BUNDLE_TEST_PARAMS,
} from "../TEST_PARAMS.js"

const testDirectoryUrl = resolveDirectoryUrl("./", import.meta.url)
const testDirectoryRelativeUrl = urlToRelativeUrl(testDirectoryUrl, jsenvCoreDirectoryUrl)
const testDirectoryname = basename(testDirectoryRelativeUrl)
const jsenvDirectoryRelativeUrl = `${testDirectoryRelativeUrl}.jsenv/`
const buildDirectoryRelativeUrl = `${testDirectoryRelativeUrl}dist/systemjs/`
const mainFilename = `${testDirectoryname}.js`

await buildProject({
  ...GENERATE_SYSTEMJS_BUNDLE_TEST_PARAMS,
  jsenvDirectoryRelativeUrl,
  buildDirectoryRelativeUrl,
  entryPointMap: {
    [`./${testDirectoryRelativeUrl}${mainFilename}`]: "./main.js",
  },
})
const { namespace: actual, serverOrigin } = await browserImportSystemJsBundle({
  ...IMPORT_SYSTEM_JS_BUNDLE_TEST_PARAMS,
  testDirectoryRelativeUrl,
  htmlFileRelativeUrl: "./index.html",
})
const expected = {
  default: `${serverOrigin}/dist/systemjs/main.js`,
}
assert({ actual, expected })
