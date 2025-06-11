'use server';

/**
 * @fileOverview An AI agent that determines whether the user should be prompted for new job details.
 *
 * - decidePromptForNewJob - A function that determines if the user should be prompted for new job details.
 * - DecidePromptForNewJobInput - The input type for the decidePromptForNewJob function.
 * - DecidePromptForNewJobOutput - The return type for the decidePromptForNewJob function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const DecidePromptForNewJobInputSchema = z.object({
  hasBeenPromptedRecently: z
    .boolean()
    .describe('Whether the user has been prompted for job details recently.'),
  timeStoppedInMinutes: z
    .number()
    .describe('The amount of time the user has been stopped in minutes.'),
});
export type DecidePromptForNewJobInput = z.infer<
  typeof DecidePromptForNewJobInputSchema
>;

const DecidePromptForNewJobOutputSchema = z.object({
  shouldPrompt: z
    .boolean()
    .describe(
      'Whether the user should be prompted to enter information for a new job.'
    ),
  reason: z.string().describe('The reason for the decision.'),
});
export type DecidePromptForNewJobOutput = z.infer<
  typeof DecidePromptForNewJobOutputSchema
>;

export async function decidePromptForNewJob(
  input: DecidePromptForNewJobInput
): Promise<DecidePromptForNewJobOutput> {
  return decidePromptForNewJobFlow(input);
}

const prompt = ai.definePrompt({
  name: 'decidePromptForNewJobPrompt',
  input: {schema: DecidePromptForNewJobInputSchema},
  output: {schema: DecidePromptForNewJobOutputSchema},
  prompt: `You are an AI assistant that helps determine whether a technician should be prompted to enter information about a new job.

  The technician has stopped moving for {{timeStoppedInMinutes}} minutes.
  It is known whether the technician has been prompted recently, specifically: {{#if hasBeenPromptedRecently}}they have been prompted recently{{else}}they have not been prompted recently{{/if}}.

  Based on this information, determine whether the technician should be prompted to enter information for a new job.
  Consider that prompting too often can be annoying, but not prompting enough can lead to incomplete data.
`,
});

// Simple in-memory rate limiter
class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async checkLimit(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = this.windowMs - (now - oldestRequest);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.requests.push(now);
  }
}

const limiter = new RateLimiter(13, 60000); // 10 requests per minute

const decidePromptForNewJobFlow = ai.defineFlow(
  {
    name: 'decidePromptForNewJobFlow',
    inputSchema: DecidePromptForNewJobInputSchema,
    outputSchema: DecidePromptForNewJobOutputSchema,
  },
  async input => {
  await limiter.checkLimit();

    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        const {output} = await prompt(input);
        return output!;
      } catch (error: any) {
        if (error.status === 429 && retryCount < maxRetries - 1) {
          const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
          console.log(`Rate limited, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
        } else {
          throw error;
        }
      }
    }
 

    const {output} = await prompt(input);
    return output!;
  }
);
