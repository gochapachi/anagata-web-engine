// Runs the site-builder smoke test with the n8n key resolved on disk.
//
// WHY THIS EXISTS: invoking smoke-site-builder.mjs from a bash one-liner with
// `export KEY=$(node -e ...)` fails instantly with "stdin is not a tty" and exit
// 1 - before the workflow is even called. A .cmd shim gives the child a real
// console so the credential export works and the run proceeds.
@echo off
cd /d "%~dp0.."
node n8n\scripts\smoke-site-builder.mjs %*