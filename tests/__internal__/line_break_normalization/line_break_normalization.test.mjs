import { assert } from "@jsenv/assert"
import { readFile } from "@jsenv/filesystem"

import { createVersionGenerator } from "@jsenv/core/src/build/version_generator.js"

const test = ({ content, contentType, lineBreakNormalization }) => {
  const versionGenerator = createVersionGenerator()
  versionGenerator.augmentWithContent({
    content,
    contentType,
    lineBreakNormalization,
  })
  return versionGenerator.generate()
}

{
  const actual = {
    unixStringWithoutNormalization: test({
      content: `console.log(42);\n`,
      contentType: "text/javascript",
      lineBreakNormalization: false,
    }),
    windowsStringWithoutNormalization: test({
      content: `console.log(42);\r\n`,
      contentType: "text/javascript",
      lineBreakNormalization: false,
    }),
    unixStringWithNormalization: test({
      content: `console.log(42);\n`,
      contentType: "text/javascript",
      lineBreakNormalization: true,
    }),
    windowsStringWithNormalization: test({
      content: `console.log(42);\r\n`,
      contentType: "text/javascript",
      lineBreakNormalization: true,
    }),
  }
  const expected = {
    unixStringWithoutNormalization: "7df141f2",
    windowsStringWithoutNormalization: "fda1b59e",
    unixStringWithNormalization: "7df141f2",
    windowsStringWithNormalization: "7df141f2",
  }
  assert({ actual, expected })
}

{
  const actual = {
    unixBufferWithoutNormalization: test({
      content: Buffer.from(`console.log(42);\n`),
      contentType: "text/javascript",
      lineBreakNormalization: false,
    }),
    windowsBufferWithoutNormalization: test({
      content: Buffer.from(`console.log(42);\r\n`),
      contentType: "text/javascript",
      lineBreakNormalization: false,
    }),
    unixBufferWithNormalization: test({
      content: Buffer.from(`console.log(42);\n`),
      contentType: "text/javascript",
      lineBreakNormalization: true,
    }),
    windowsBufferWithNormalization: test({
      content: Buffer.from(`console.log(42);\r\n`),
      contentType: "text/javascript",
      lineBreakNormalization: true,
    }),
  }
  const expected = {
    unixBufferWithoutNormalization: "7df141f2",
    windowsBufferWithoutNormalization: "fda1b59e",
    unixBufferWithNormalization: "7df141f2",
    windowsBufferWithNormalization: "7df141f2",
  }
  assert({ actual, expected })
}

// lineBreakNormalization disabled when content type is not textual
// (for instance an image)
{
  const imageBuffer = await readFile(new URL("./image.png", import.meta.url))
  const actual = {
    imageBufferRecognizedAsImage: test({
      content: imageBuffer,
      contentType: "image/png",
      lineBreakNormalization: true,
    }),
    imageBufferRecognizedAsHtml: test({
      content: imageBuffer,
      contentType: "text/html",
      lineBreakNormalization: true,
    }),
  }
  const expected = {
    imageBufferRecognizedAsImage: "574c1c76",
    imageBufferRecognizedAsHtml: "f649d8e3",
  }
  assert({ actual, expected })
}
