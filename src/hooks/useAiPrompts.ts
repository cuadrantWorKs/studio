import { useState, useEffect } from 'react';
import { Workday, LocationPoint, Job } from '@/lib/techtrack/types';
import { decidePromptForNewJob } from '@/ai/flows/decide-prompt-for-new-job';
import { decidePromptForJobCompletion } from '@/ai/flows/decide-prompt-for-job-completion';
import { haversineDistance } from '@/lib/techtrack/geometry';
import { useToast } from '@/hooks/use-toast';

const STOP_DETECT_DURATION_MS = 15 * 60 * 1000;
const MOVEMENT_THRESHOLD_METERS = 100;
const RECENT_PROMPT_THRESHOLD_MS = 30 * 60 * 1000;

interface UseAiPromptsProps {
    workday: Workday | null;
    currentLocation: LocationPoint | null;
    currentJob: Job | null | undefined;
    isJobModalOpen: boolean;
    setWorkday: React.Dispatch<React.SetStateAction<Workday | null>>;
    recordEvent: (type: any, location: any, jobId?: string, details?: string) => void;
    openJobModal: (mode: 'new' | 'summary', data?: any) => void;
}

export function useAiPrompts({
    workday,
    currentLocation,
    currentJob,
    isJobModalOpen,
    setWorkday,
    recordEvent,
    openJobModal
}: UseAiPromptsProps) {
    const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
    const { toast } = useToast();

    // New Job Prompt Logic
    useEffect(() => {
        if (workday?.status === 'tracking' && !currentJob) {
            if (aiLoading.newJob || isJobModalOpen) return;

            const lastMovementTime = workday.locationHistory[workday.locationHistory.length - 1]?.timestamp || workday.startTime;
            const timeSinceLastMovement = Date.now() - (lastMovementTime || Date.now());
            const timeSinceWorkdayStart = Date.now() - (workday.startTime || Date.now());

            // Only trigger if BOTH:
            // 1. We haven't moved for the threshold duration
            // 2. The workday has been active for at least that duration (prevents alerts on immediate start with old cached GPS)
            if (timeSinceLastMovement > STOP_DETECT_DURATION_MS && timeSinceWorkdayStart > STOP_DETECT_DURATION_MS) {
                const hasBeenPromptedRecently = workday.lastNewJobPromptTime && (Date.now() - workday.lastNewJobPromptTime < RECENT_PROMPT_THRESHOLD_MS);

                setAiLoading(prev => ({ ...prev, newJob: true }));
                decidePromptForNewJob({ hasBeenPromptedRecently: !!hasBeenPromptedRecently, timeStoppedInMinutes: Math.round(STOP_DETECT_DURATION_MS / (60 * 1000)) })
                    .then(res => {
                        if (res.shouldPrompt) {
                            toast({ title: "¿Nuevo Trabajo?", description: "Parece que te has detenido. ¿Comenzando un nuevo trabajo? IA: " + res.reason });
                            openJobModal('new');
                            recordEvent('NEW_JOB_PROMPT', currentLocation, undefined, `IA: ${res.reason}`);
                        }
                        setWorkday(prev => prev ? ({ ...prev, lastNewJobPromptTime: Date.now() }) : null);
                    })
                    .catch(err => {
                        console.error("AI Error (decidePromptForNewJob):", err);
                        toast({ title: "Error de IA", description: "No se pudo verificar si hay un nuevo trabajo.", variant: "destructive" });
                    })
                    .finally(() => setAiLoading(prev => ({ ...prev, newJob: false })));
            }
        }
    }, [workday, currentLocation, toast, recordEvent, currentJob, isJobModalOpen, aiLoading.newJob, openJobModal, setWorkday]);

    // Job Completion Prompt Logic
    useEffect(() => {
        if (workday?.status === 'tracking' && currentJob && currentJob.status === 'active' && currentLocation) {
            if (aiLoading.jobCompletion || isJobModalOpen) return;

            const jobStartLocation = currentJob.startLocation;
            if (!jobStartLocation) return;

            const distance = haversineDistance(jobStartLocation, currentLocation);
            if (distance > MOVEMENT_THRESHOLD_METERS) {
                const lastPromptTime = workday.lastJobCompletionPromptTime;

                setAiLoading(prev => ({ ...prev, jobCompletion: true }));
                decidePromptForJobCompletion({ distanceMovedMeters: distance, lastJobPromptedTimestamp: lastPromptTime })
                    .then(res => {
                        if (res.shouldPrompt) {
                            toast({ title: "¿Actualizar Trabajo?", description: `Te has movido significativamente. ¿Completaste el trabajo: ${currentJob.description}? IA: ${res.reason}` });
                            openJobModal('summary', { description: currentJob.description || '', summary: '' });
                            recordEvent('JOB_COMPLETION_PROMPT', currentLocation, currentJob.id, `IA: ${res.reason}`);
                        }
                        setWorkday(prev => prev ? ({ ...prev, lastJobCompletionPromptTime: Date.now() }) : null);
                    })
                    .catch(err => {
                        console.error("AI Error (decidePromptForJobCompletion):", err);
                        toast({ title: "Error de IA", description: "No se pudo verificar la finalización del trabajo.", variant: "destructive" });
                    })
                    .finally(() => setAiLoading(prev => ({ ...prev, jobCompletion: false })));
            }
        }
    }, [workday, currentJob, currentLocation, toast, recordEvent, isJobModalOpen, aiLoading.jobCompletion, openJobModal, setWorkday]);

    return { aiLoading };
}
