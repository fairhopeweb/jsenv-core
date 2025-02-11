import { pathToFileURL } from "node:url"
import { injectJsImport } from "@jsenv/ast"

export const babelPluginGlobalThisAsJsenvImport = (
  babel,
  { getImportSpecifier },
) => {
  const globalThisClientFileUrl = new URL(
    "./client/global_this.js",
    import.meta.url,
  ).href

  return {
    name: "global-this-as-jsenv-import",
    visitor: {
      Identifier(path, opts) {
        const { filename } = opts
        const fileUrl = pathToFileURL(filename).href
        if (fileUrl === globalThisClientFileUrl) {
          return
        }
        const { node } = path
        // we should do this once, tree shaking will remote it but still
        if (node.name === "globalThis") {
          injectJsImport({
            programPath: path.scope.getProgramParent().path,
            from: getImportSpecifier(globalThisClientFileUrl),
            sideEffect: true,
          })
        }
      },
    },
  }
}
