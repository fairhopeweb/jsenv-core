import { ancestor } from "acorn-walk"

import { parseJsWithAcorn } from "./parse_js_with_acorn.js"
import {
  isNewWorkerCall,
  analyzeNewWorkerCall,
  isNewSharedWorkerCall,
  analyzeNewSharedWorkerCall,
  isServiceWorkerRegisterCall,
  analyzeServiceWorkerRegisterCall,
} from "./js_static_analysis/web_worker_entry_point.js"
import {
  isImportScriptsCall,
  analyzeImportScriptCalls,
} from "./js_static_analysis/web_worker.js"
import {
  isNewUrlCall,
  analyzeNewUrlCall,
} from "./js_static_analysis/new_url.js"
import {
  isSystemRegisterCall,
  analyzeSystemRegisterCall,
  isSystemImportCall,
  analyzeSystemImportCall,
} from "./js_static_analysis/system.js"

export const parseJsUrls = ({
  js,
  url,
  isJsModule = false,
  isWebWorker = false,
} = {}) => {
  const jsUrls = []
  if (canSkipStaticAnalysis({ js, isJsModule, isWebWorker })) {
    return jsUrls
  }
  const jsAst = parseJsWithAcorn({
    js,
    url,
    isJsModule,
  })
  const onUrl = (jsUrl) => {
    jsUrls.push(jsUrl)
  }
  ancestor(jsAst, {
    CallExpression: (node) => {
      if (isServiceWorkerRegisterCall(node)) {
        analyzeServiceWorkerRegisterCall(node, {
          isJsModule,
          onUrl,
        })
        return
      }
      if (isWebWorker && isImportScriptsCall(node)) {
        analyzeImportScriptCalls(node, {
          onUrl,
        })
        return
      }
      if (!isJsModule && isSystemRegisterCall(node)) {
        analyzeSystemRegisterCall(node, {
          onUrl,
        })
        return
      }
      if (!isJsModule && isSystemImportCall(node)) {
        analyzeSystemImportCall(node, {
          onUrl,
        })
        return
      }
    },
    NewExpression: (node, ancestors) => {
      if (isNewWorkerCall(node)) {
        analyzeNewWorkerCall(node, {
          isJsModule,
          onUrl,
        })
        return
      }
      if (isNewSharedWorkerCall(node)) {
        analyzeNewSharedWorkerCall(node, {
          isJsModule,
          onUrl,
        })
        return
      }
      if (isNewUrlCall(node)) {
        const parent = ancestors[ancestors.length - 2]
        if (
          parent &&
          (isNewWorkerCall(parent) ||
            isNewSharedWorkerCall(parent) ||
            isServiceWorkerRegisterCall(parent))
        ) {
          return
        }
        analyzeNewUrlCall(node, {
          isJsModule,
          onUrl,
        })
        return
      }
    },
  })
  return jsUrls
}

const canSkipStaticAnalysis = ({ js, isJsModule, isWebWorker }) => {
  if (isJsModule) {
    if (
      js.includes("new URL(") ||
      js.includes("new Worker(") ||
      js.includes("new SharedWorker(") ||
      js.includes("serviceWorker.register(")
    ) {
      return false
    }
  }
  if (!isJsModule) {
    if (
      js.includes("System.") ||
      js.includes("new URL(") ||
      js.includes("new Worker(") ||
      js.includes("new SharedWorker(") ||
      js.includes("serviceWorker.register(")
    ) {
      return false
    }
  }
  if (isWebWorker && js.includes("importScripts(")) {
    return false
  }
  return true
}
