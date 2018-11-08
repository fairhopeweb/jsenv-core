import { executeOnNode } from "./executeOnNode.js"
import path from "path"
import { createJsCompileService } from "../createJsCompileService.js"
import { createCancel } from "../cancel/index.js"

const localRoot = path.resolve(__dirname, "../../../")
const compileInto = "build"
const watch = true
const file = `src/__test__/file.js`

const exec = async ({ cancellation }) => {
  const jsCompileService = await createJsCompileService({
    cancellation,
    localRoot,
    compileInto,
  })

  return executeOnNode({
    cancellation,
    localRoot,
    compileInto,
    compileService: jsCompileService,

    watch,

    file,
    verbose: true,
  })
}

const { cancellation, cancel } = createCancel()
exec({ cancellation })

process.on("SIGINT", () => {
  cancel("process interrupt").then(() => {
    process.exit(0)
  })
})
