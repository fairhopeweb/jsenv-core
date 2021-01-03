import { basename } from "path"
import { assert } from "@jsenv/assert"
import { resolveDirectoryUrl, urlToRelativeUrl, resolveUrl } from "@jsenv/util"
import { jsenvCoreDirectoryUrl } from "@jsenv/core/src/internal/jsenvCoreDirectoryUrl.js"
import { EXECUTE_TEST_PARAMS } from "@jsenv/core/test/TEST_PARAMS_LAUNCH_NODE.js"
import { launchNode, execute } from "@jsenv/core"

const testDirectoryUrl = resolveDirectoryUrl("./", import.meta.url)
const testDirectoryRelativeUrl = urlToRelativeUrl(testDirectoryUrl, jsenvCoreDirectoryUrl)
const testDirectoryname = basename(testDirectoryRelativeUrl)
const jsenvDirectoryRelativeUrl = `${testDirectoryRelativeUrl}.jsenv/`
const filename = `${testDirectoryname}.js`
const fileRelativeUrl = `${testDirectoryRelativeUrl}${filename}`
const importMapFileRelativeUrl = `${testDirectoryRelativeUrl}import-map.importmap`
// const importedFileRelativeUrl = `${testDirectoryRelativeUrl}foo.js`

const executionResult = await execute({
  ...EXECUTE_TEST_PARAMS,
  ignoreError: true,
  importMapFileRelativeUrl,
  jsenvDirectoryRelativeUrl,
  fileRelativeUrl,
  launch: launchNode,
})
const actual = executionResult
const expected = {
  status: "errored",
  error: actual.error,
}
assert({ actual, expected })
{
  const actual = executionResult.error.message
  const expected = `Unmapped bare specifier.
--- specifier ---
foo
--- importer ---
${fileRelativeUrl}`
  assert({ actual, expected })
}
