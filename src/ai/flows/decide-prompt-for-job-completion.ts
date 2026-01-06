'use server';

/**
 * @fileOverview A flow that uses GenAI to intelligently decide if the user should be prompted for job completion details, taking into account if the user has been prompted recently.
 *
 * - decidePromptForJobCompletion - A function that handles the decision process.
 * - DecidePromptForJobCompletionInput - The input type for the decidePromptForJobCompletion function.
 * - DecidePromptForJobCompletionOutput - The return type for the decidePromptForJobCompletion function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const DecidePromptForJobCompletionInputSchema = z.object({
  distanceMovedMeters: z
    .number()
    .describe('The distance the technician has moved in meters.'),
  lastJobPromptedTimestamp: z
    .number()
    .optional()
    .describe(
      'The timestamp of the last time the user was prompted for job details. Unix epoch time in milliseconds. If undefined, the user has not been prompted yet.'
    ),
  jobType: z
    .enum(['regular', 'supplies'])
    .optional()
    .describe('The type of job: regular or supplies (supply run). Supply runs should not prompt for completion.'),
});
export type DecidePromptForJobCompletionInput = z.infer<
  typeof DecidePromptForJobCompletionInputSchema
>;

const DecidePromptForJobCompletionOutputSchema = z.object({
  shouldPrompt: z
    .boolean()
    .describe(
      'Whether or not the user should be prompted for job completion details.'
    ),
  reason: z
    .string()
    .describe(
      'The reason for the decision, to be used for debugging and logging.'
    ),
});
export type DecidePromptForJobCompletionOutput = z.infer<
  typeof DecidePromptForJobCompletionOutputSchema
>;

export async function decidePromptForJobCompletion(
  input: DecidePromptForJobCompletionInput
): Promise<DecidePromptForJobCompletionOutput> {
  return decidePromptForJobCompletionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'decidePromptForJobCompletionPrompt',
  input: { schema: DecidePromptForJobCompletionInputSchema },
  output: { schema: DecidePromptForJobCompletionOutputSchema },
  prompt: `Sos un asistente de IA que ayuda a determinar si se debe preguntar a un técnico sobre la finalización de un trabajo.

Datos de entrada:
- Distancia recorrida: {{distanceMovedMeters}} metros
- Último timestamp de pregunta: {{lastJobPromptedTimestamp}}
- Tipo de trabajo: {{jobType}}

Reglas:
- Si el tipo de trabajo es 'supplies' (compra de insumos), NUNCA preguntar. Las compras de insumos no deben interrumpir la sesión.
- Preguntar si la distancia recorrida es mayor a 100 metros
- No preguntar si se preguntó en los últimos 30 minutos (1800000 ms)

Respondé SOLO con JSON válido, sin otro texto:
{"shouldPrompt": true o false, "reason": "breve explicación en español argentino"}`,
});

const decidePromptForJobCompletionFlow = ai.defineFlow(
  {
    name: 'decidePromptForJobCompletionFlow',
    inputSchema: DecidePromptForJobCompletionInputSchema,
    outputSchema: DecidePromptForJobCompletionOutputSchema,
  },
  async input => {
    const { output } = await prompt(input);
    return output!;
  }
);
