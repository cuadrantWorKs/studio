'use server';

/**
 * @fileOverview An AI agent that determines whether the user should be prompted for new job details.
 *
 * - decidePromptForNewJob - A function that determines if the user should be prompted for new job details.
 * - DecidePromptForNewJobInput - The input type for the decidePromptForNewJob function.
 * - DecidePromptForNewJobOutput - The return type for the decidePromptForNewJob function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

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
  input: { schema: DecidePromptForNewJobInputSchema },
  output: { schema: DecidePromptForNewJobOutputSchema },
  prompt: `Sos un asistente de IA que ayuda a determinar si se debe preguntar a un técnico para iniciar un nuevo trabajo.

Datos de entrada:
- Tiempo detenido: {{timeStoppedInMinutes}} minutos
- Se preguntó recientemente: {{hasBeenPromptedRecently}}

Reglas:
- Preguntar si se detuvo por más de 15 minutos y no se preguntó recientemente
- No preguntar demasiado seguido para no ser molesto

Respondé SOLO con JSON válido, sin otro texto:
{"shouldPrompt": true o false, "reason": "breve explicación en español argentino"}`,
});

const decidePromptForNewJobFlow = ai.defineFlow(
  {
    name: 'decidePromptForNewJobFlow',
    inputSchema: DecidePromptForNewJobInputSchema,
    outputSchema: DecidePromptForNewJobOutputSchema,
  },
  async input => {
    const { output } = await prompt(input);
    return output!;
  }
);
