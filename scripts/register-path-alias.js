// Registered via `node --require` before compiled output runs — both the
// test build (npm test) and, as of Phase 10, the scripts build (npm run
// build:scripts). tsconfig `paths` ("@/*") is a TypeScript-compile-time-only
// feature — it does not rewrite emitted `require("@/lib/...")` calls into
// relative paths, so plain `node` can't resolve them without this. Small
// enough that pulling in a package (tsc-alias, module-alias) for it isn't
// worth it, per the "prefer simple" guidance.
//
// PATH_ALIAS_BUILD_ROOT lets a caller point this at a different compiled
// output directory than the default `.test-build` — added so
// scripts/run-scheduled-batch.ts (compiled separately via
// tsconfig.scripts.json into .scripts-build, since it needs
// lib/supabase/**/*.ts, which tsconfig.test.json deliberately excludes) can
// reuse this exact file rather than forking a near-identical copy.
// Unset, this defaults to `.test-build` — npm test's own behavior is
// completely unaffected by this change.
const Module = require("module");
const path = require("path");

const root = path.join(__dirname, "..", process.env.PATH_ALIAS_BUILD_ROOT || ".test-build");
const original = Module._resolveFilename;

Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) {
    request = path.join(root, request.slice(2));
  }
  return original.call(this, request, ...args);
};
