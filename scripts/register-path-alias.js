// Registered via `node --require` before the compiled test files run.
// tsconfig `paths` ("@/*") is a TypeScript-compile-time-only feature — it
// does not rewrite emitted `require("@/lib/...")` calls into relative
// paths, so plain `node` can't resolve them without this. Small enough
// that pulling in a package (tsc-alias, module-alias) for it isn't worth
// it, per the "prefer simple" guidance.
const Module = require("module");
const path = require("path");

const root = path.join(__dirname, "..", ".test-build");
const original = Module._resolveFilename;

Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) {
    request = path.join(root, request.slice(2));
  }
  return original.call(this, request, ...args);
};
