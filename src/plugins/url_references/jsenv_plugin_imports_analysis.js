import { parseJsModuleImports } from "@jsenv/utils/js_ast/parse_js_module_imports.js"
import { createMagicSource } from "@jsenv/utils/sourcemap/magic_source.js"

export const jsenvPluginImportsAnalysis = () => {
  return {
    name: "jsenv:imports_analysis",
    appliesDuring: "*",
    transformUrlContent: {
      js_module: async (urlInfo, context) => {
        const [imports, exports] = await parseJsModuleImports({
          js: urlInfo.content,
          url: (urlInfo.data && urlInfo.data.rawUrl) || urlInfo.url,
        })
        const actions = []
        const magicSource = createMagicSource(urlInfo.content)
        urlInfo.data.usesImport = imports.length > 0
        urlInfo.data.usesExport = exports.length > 0
        urlInfo.data.usesImportAssertion = imports.some(
          (importInfo) => typeof importInfo.usesAssert,
        )
        imports.forEach((importInfo) => {
          const [reference] = context.referenceUtils.found({
            type: "js_import_export",
            subtype: importInfo.subtype,
            expectedType: importInfo.expectedType, // can be json for import assertions
            expectedSubtype: urlInfo.subtype,
            line: importInfo.specifierLine,
            column: importInfo.specifierColumn,
            specifier: importInfo.specifier,
          })
          actions.push(async () => {
            magicSource.replace({
              start: importInfo.specifierStart,
              end: importInfo.specifierEnd,
              replacement: await context.referenceUtils.readGeneratedSpecifier(
                reference,
              ),
            })
          })
        })
        await Promise.all(actions.map((action) => action()))
        return magicSource.toContentAndSourcemap()
      },
    },
  }
}
