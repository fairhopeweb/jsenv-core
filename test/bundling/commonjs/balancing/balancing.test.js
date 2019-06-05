import { assert } from "@dmail/assert"
import { importMetaURLToFolderJsenvRelativePath } from "../../../../src/import-meta-url-to-folder-jsenv-relative-path.js"
import { generateCommonJsBundle } from "../../../../src/bundling/commonjs/generate-commonjs-bundle.js"
import { requireCommonJsBundle } from "../require-commonjs-bundle.js"
import {
  COMMONJS_BUNDLING_TEST_GENERATE_PARAM,
  COMMONJS_BUNDLING_TEST_REQUIRE_PARAM,
} from "../commonjs-bundling-test-param.js"

const folderJsenvRelativePath = importMetaURLToFolderJsenvRelativePath(import.meta.url)
const bundleIntoRelativePath = `${folderJsenvRelativePath}/dist/commonjs`
const fileRelativePath = `${folderJsenvRelativePath}/balancing.js`

await generateCommonJsBundle({
  ...COMMONJS_BUNDLING_TEST_GENERATE_PARAM,
  bundleIntoRelativePath,
  entryPointMap: {
    main: fileRelativePath,
  },
  compileGroupCount: 2,
})

const { namespace: actual } = await requireCommonJsBundle({
  ...COMMONJS_BUNDLING_TEST_REQUIRE_PARAM,
  bundleIntoRelativePath,
})
const expected = {
  answer: 42,
}
assert({ actual, expected })
