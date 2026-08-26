// Tiny, cross-platform launcher for the compiled scheduled-batch script —
// plain Node, no shell env-var syntax (which isn't portable between
// PowerShell/cmd and bash), and no new dependency to get one. Sets
// PATH_ALIAS_BUILD_ROOT before requiring register-path-alias.js so the
// shared alias resolver points at .scripts-build (Phase 10's own compiled
// output, via tsconfig.scripts.json) instead of its .test-build default —
// npm test's own behavior is completely unaffected, since it never sets
// this variable and register-path-alias.js falls back to .test-build when
// it's unset.
process.env.PATH_ALIAS_BUILD_ROOT = ".scripts-build";
require("./register-path-alias.js");
require("../.scripts-build/scripts/run-scheduled-batch.js");
