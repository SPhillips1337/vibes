import dotenv from 'dotenv';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

dotenv.config();

const OptionalUrlSchema = z.string().url().or(z.literal('')).default('');

export const ConfigSchema = z.object({
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434/v1'),
  OLLAMA_MODEL: z.string().default('gemma2:9b'),
  PLANNER_MODEL: z.string().default(''),
  PLANNER_BASE_URL: OptionalUrlSchema,
  PLANNER_API_KEY: z.string().default(''),
  OLLAMA_API_KEY: z.string().default('ollama'),
  CONTEXT_WINDOW: z.coerce.number().default(32768),
  MAX_STEPS: z.coerce.number().default(25),
  THINKING_MODE: z.union([z.boolean(), z.string().transform(v => v === 'enabled')]).default(true),
  MAX_CONCURRENT_TASKS: z.coerce.number().default(1),
  ENABLE_REVIEWER: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(true),
  REVIEWER_MODEL: z.string().default('gemma2:27b'),
  REVIEWER_BASE_URL: OptionalUrlSchema,
  REVIEWER_API_KEY: z.string().default(''),
  MEMORY_ENABLED: z.union([z.boolean(), z.string().transform(v => v !== 'false')]).default(true),
  MEMORY_USER_ID: z.string().default('default'),
  MULTI_AGENT_ENABLED: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(false),
  YOLO_MODE: z.union([z.boolean(), z.string().transform(v => v !== 'false')]).default(true),
  AGENT_HOOKS: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(true),
  DATA_SHARING_MODE: z.enum(['none', 'workspace', 'full']).default('none'),
  TOOL_EXECUTION_MODE: z.enum(['sequential', 'parallel']).default('sequential'),
  CONTEXT_COMPACTION_ENABLED: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(true),
  TRACE_DIR: z.string().optional(),
  TRIAGE_ENABLED: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(false),
  TRIAGE_MODEL: z.string().default(''),
  TRIAGE_BASE_URL: OptionalUrlSchema,
  TRIAGE_API_KEY: z.string().default(''),
  TRIAGE_INTERVAL: z.coerce.number().default(5),
  TRIAGE_AUTO_STEER: z.union([z.boolean(), z.string().transform(v => v !== 'false')]).default(true),
  LOCAL_MEMORY: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(false),
  CODEX_ENABLED: z.union([z.boolean(), z.string().transform(v => v !== 'false')]).default(true),
  CODEX_TOP_K: z.coerce.number().default(3),
  ENABLE_STRUCTURAL_AUDIT: z.union([z.boolean(), z.string().transform(v => v !== 'false')]).default(true),
  ENABLE_ADVERSARIAL_AUDIT: z.union([z.boolean(), z.string().transform(v => v === 'true')]).default(false),
  CODEX_SCRIPT_PATH: z.string().default(''),
  CODEX_PYTHON_PATH: z.string().default(''),
});

export type Config = z.infer<typeof ConfigSchema>;

const VIBES_DIR = path.join(process.cwd(), '.vibes');
const CONFIG_PATH = path.join(VIBES_DIR, 'config.json');

function loadPersistentConfig(): Partial<Config> {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('⚠️ Failed to load persistent config:', error);
  }
  return {};
}

const envConfig = ConfigSchema.safeParse(process.env);
const persistentConfig = loadPersistentConfig();

// Merge: Env (defaults/overrides) <- Persistent (user saved)
const merged = {
  ...envConfig.success ? envConfig.data : {},
  ...persistentConfig,
};

const finalParsed = ConfigSchema.safeParse(merged);

if (!finalParsed.success) {
  console.error('❌ Invalid configuration:', finalParsed.error.format());
  process.exit(1);
}

// IMPORTANT: Always read config values as `config.FIELD` at call-time.
// Do NOT destructure at module level (e.g. `const { MAX_STEPS } = config`).
// updateConfig() mutates this object in-place via Object.assign; destructured
// copies will hold stale values for the lifetime of the module.
export const config: Config = finalParsed.data;

export function hasPersistentConfig(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export function updateConfig(newConfig: Partial<Config>) {
  try {
    if (!fs.existsSync(VIBES_DIR)) {
      fs.mkdirSync(VIBES_DIR, { recursive: true });
    }
    const current = loadPersistentConfig();
    const updated = { ...current, ...newConfig };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
    
    // Also update the in-memory object for the current session
    Object.assign(config, updated);
  } catch (error) {
    console.error('⚠️ Failed to save configuration:', error);
  }
}
