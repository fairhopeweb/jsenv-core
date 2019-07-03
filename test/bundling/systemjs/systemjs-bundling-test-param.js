import { JSENV_PATH } from "../../../src/JSENV_PATH.js"
import { testBabelPluginMap } from "../../testBabelPluginMap.js"

export const SYSTEMJS_BUNDLING_TEST_GENERATE_PARAM = {
  projectPath: JSENV_PATH,
  babelPluginMap: testBabelPluginMap,
  test: "/src/bundling/systemjs/systemjs-balancer-template.js",
  platformGroupResolverRelativePath: "/src/platform-group-resolver/index.js",
  logLevel: "off",
  throwUnhandled: false,
}

export const SYSTEMJS_BUNDLING_TEST_IMPORT_PARAM = {
  projectPath: JSENV_PATH,
  mainRelativePath: "/main.js",
}
