/**
 * Context compaction module.
 * Re-exports compressMessages from context-manager as `compact`
 * for use by the transformContext hook.
 *
 * This indirection avoids a circular import: compaction re-uses
 * estimateTokens / estimateMessagesTokens from context-manager.
 */
export { compressMessages as compact } from '../context-manager.js';
