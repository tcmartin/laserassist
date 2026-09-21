# Hosted build entrypoint correction

The standard `npm run build` still invoked a legacy script that installed
dependencies, built a Python ASR executable and generated a different builder
configuration. This conflicts with the verified hosted-only package and can
restore retired components during a release.

Plan: keep package.json as the single packaging configuration, route standard
build commands directly to the installed electron-builder, and retain the old
shell entrypoint only as a thin compatibility wrapper. Do not install or change
dependencies during a build. Preserve explicit platform commands and normal
signing behavior. Validate the entrypoint contract, shell syntax, package content,
and the built application's startup. Unsigned validation does not establish
Developer ID signing or notarization.

Validation: shell syntax and the packaging entrypoint assertions passed. The
standard package configuration built a macOS arm64 directory with signing
explicitly disabled for local validation. The archive contains 46 entries,
including the eight hosted/calling source files; tests, models and docs are
absent. Eleven runtime files match source byte for byte. The built app passed
the contact/review/script-edit/workspace-reset UI test through its packaged
renderer. No new dependencies were installed.
