#!/usr/bin/env node

// Keep transitive dependency deprecations from corrupting the Ink display.
process.noDeprecation = true;

await import('./index.js');
