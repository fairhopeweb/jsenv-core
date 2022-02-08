import { urlToRelativeUrl, resolveUrl, readFile } from "@jsenv/filesystem"
import { assert } from "@jsenv/assert"

import { jsenvCoreDirectoryUrl } from "@jsenv/core/src/jsenv_file_urls.js"
import { babelPluginInstrument } from "@jsenv/core/src/internal/coverage/babel_plugin_instrument.js"
import { asCompilationResult } from "@jsenv/core/src/internal/compile_server/jsenv_directory/compilation_result.js"
import { transformJs } from "@jsenv/core/src/internal/compile_server/js/js_transformer.js"
import {
  TRANSFORM_JS_TEST_PARAMS,
  TRANSFORM_RESULT_TEST_PARAMS,
} from "../TEST_PARAMS_TRANSFORM_JS.js"

const testDirectoryUrl = resolveUrl("./", import.meta.url)
const testDirectoryRelativeUrl = urlToRelativeUrl(
  testDirectoryUrl,
  jsenvCoreDirectoryUrl,
)
const originalFileUrl = resolveUrl(`./instrument.js`, testDirectoryUrl)
const compiledFileUrl = `${jsenvCoreDirectoryUrl}${testDirectoryRelativeUrl}.jsenv/out/instrument.js`
const sourcemapFileUrl = `${compiledFileUrl}.map`
const originalFileContent = await readFile(originalFileUrl)
const transformResult = await transformJs({
  ...TRANSFORM_JS_TEST_PARAMS,
  code: originalFileContent,
  url: originalFileUrl,
  babelPluginMap: {
    ...TRANSFORM_RESULT_TEST_PARAMS.babelPluginMap,
    "transform-instrument": [
      babelPluginInstrument,
      { projectDirectoryUrl: jsenvCoreDirectoryUrl },
    ],
  },
})

const actual = await asCompilationResult(
  {
    contentType: "application/javascript",
    ...transformResult,
  },
  {
    ...TRANSFORM_RESULT_TEST_PARAMS,
    originalFileContent,
    originalFileUrl,
    compiledFileUrl,
    sourcemapFileUrl,
  },
)
const expected = {
  contentType: "application/javascript",
  content: actual.content,
  sourcemap: assert.any(Object),
  sources: [originalFileUrl],
  sourcesContent: [originalFileContent],
  assets: [sourcemapFileUrl, `${compiledFileUrl}__asset__coverage.json`],
  assetsContent: [actual.assetsContent[0], actual.assetsContent[1]],
  dependencies: [],
}
assert({ actual, expected })
