import { config } from 'dotenv';
config();

import '@/ai/flows/decide-prompt-for-new-job.ts';
import '@/ai/flows/summarize-job-description.ts';
import '@/ai/flows/decide-prompt-for-job-completion.ts';