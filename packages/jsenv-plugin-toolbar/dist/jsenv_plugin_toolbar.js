import { parseHtmlString, injectScriptNodeAsEarlyAsPossible, createHtmlNode, stringifyHtmlAst } from "@jsenv/ast";

const jsenvPluginToolbar = ({
  logs = false
} = {}) => {
  const toolbarInjectorClientFileUrl = new URL("./js/toolbar_injector.js", import.meta.url).href;
  const toolbarHtmlClientFileUrl = new URL("./html/toolbar.html", import.meta.url).href;
  return {
    name: "jsenv:toolbar",
    appliesDuring: "dev",
    transformUrlContent: {
      html: ({
        url,
        content
      }, {
        referenceUtils
      }) => {
        if (url === toolbarHtmlClientFileUrl) {
          return null;
        }
        const htmlAst = parseHtmlString(content);
        const [toolbarInjectorReference] = referenceUtils.inject({
          type: "js_import",
          expectedType: "js_module",
          specifier: toolbarInjectorClientFileUrl
        });
        const [toolbarClientFileReference] = referenceUtils.inject({
          type: "iframe_src",
          expectedType: "html",
          specifier: toolbarHtmlClientFileUrl
        });
        injectScriptNodeAsEarlyAsPossible(htmlAst, createHtmlNode({
          tagName: "script",
          type: "module",
          textContent: `
import { injectToolbar } from ${toolbarInjectorReference.generatedSpecifier}
injectToolbar(${JSON.stringify({
            toolbarUrl: toolbarClientFileReference.generatedSpecifier,
            logs
          }, null, "  ")})`
        }), "jsenv:toolbar");
        const htmlModified = stringifyHtmlAst(htmlAst);
        return {
          content: htmlModified
        };
      }
    }
  };
};

export { jsenvPluginToolbar };
