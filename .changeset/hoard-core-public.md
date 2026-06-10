---
"@irrg/hoard-core": minor
"@irrg/itchio-hoard": patch
"@irrg/humblebundle-hoard": patch
"@irrg/drivethru-hoard": patch
"@irrg/bundleofholding-hoard": patch
---

Publish @irrg/hoard-core as a public package; providers depend on it at runtime

Fixes a packaging defect in 0.3.0 where @irrg/hoard-core was marked private but
referenced as a runtime dependency in the CLI and as an import in provider type
declarations. Provider builds revert from tsup back to tsc; core is now a real
published dependency rather than an inlined bundle.
