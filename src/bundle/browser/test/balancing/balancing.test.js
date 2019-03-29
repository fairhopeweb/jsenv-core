import blockScoping from "@babel/plugin-transform-block-scoping"
import { projectFolder } from "../../../../../projectFolder.js"
import { bundleBrowser } from "../../bundleBrowser.js"

const testFolder = `${projectFolder}/src/bundle/browser/test/balancing`

bundleBrowser({
  projectFolder: testFolder,
  into: "dist/browser",
  globalName: "balancing",
  babelPluginDescription: {
    "transform-block-scoping": [blockScoping],
  },
  entryPointsDescription: {
    main: "balancing.js",
  },
  compileGroupCount: 2,
  verbose: true,
  minify: false,
})
