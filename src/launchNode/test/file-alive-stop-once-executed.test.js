import { pluginOptionMapToPluginMap } from "@dmail/project-structure-compile-babel"
import { localRoot } from "../../localRoot.js"
import { launchNode } from "../launchNode.js"
import { executeFile } from "../../executeFile.js"

const file = `src/launchNode/test/fixtures/alive.js`
const compileInto = "build"
const pluginMap = pluginOptionMapToPluginMap({
  "transform-modules-systemjs": {},
})

executeFile(file, {
  localRoot,
  compileInto,
  pluginMap,
  launchPlatform: launchNode,
  platformTypeForLog: "node process",
  verbose: true,
  stopOnceExecuted: true,
})
