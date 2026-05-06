import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  OLLAMA_BASE_URL: z.string().url(),
  OLLAMA_MODEL: z.string(),
  OLLAMA_API_KEY: z.string().default('ollama'),
  CONTEXT_WINDOW: z.coerce.number().default(32768),
  MAX_STEPS: z.coerce.number().default(25),
  THINKING_MODE: z.string().transform(v => v === 'enabled').default('enabled'),
  MAX_CONCURRENT_TASKS: z.coerce.number().default(1),
  MEMORY_ENABLED: z.string().transform(v => v !== 'false').default('true'),
  MEMORY_USER_ID: z.string().default('default'),
  MULTI_AGENT_ENABLED: z.string().transform(v => v === 'true').default('false'),
});

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid configuration:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
