import { useState, useEffect } from 'react';
import { Workday, LocationPoint, Job, TrackingEvent } from '@/lib/techtrack/types';
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
    recordEvent: (type: TrackingEvent['type'], location: LocationPoint | null, jobId?: string, details?: string) => void;
    openJobModal: (mode: 'new' | 'summary', data?: { description?: string; summary?: string }, startTime?: number) => void;
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
        if (workday?.status === 'tracking' && !currentJob && currentLocation) {
            if (aiLoading.newJob || isJobModalOpen) return;

            // Find the point where the technician first stopped moving
            // Iterate backwards through history to find the first point that is far away
            let stopStartTime = workday.locationHistory[workday.locationHistory.length - 1]?.timestamp || workday.startTime || Date.now();

            for (let i = workday.locationHistory.length - 1; i >= 0; i--) {
                const point = workday.locationHistory[i];
                const distance = haversineDistance(point, currentLocation);
                if (distance > MOVEMENT_THRESHOLD_METERS) {
                    // This was the last time we were "far away"
                    // So the stop started at the next point's timestamp
                    stopStartTime = workday.locationHistory[i + 1]?.timestamp || point.timestamp || workday.startTime || Date.now();
                    break;
                } else {
                    // Still part of the same stop cluster
                    stopStartTime = point.timestamp;
                }
            }

            const timeSinceStopStarted = Date.now() - stopStartTime;
            const timeSinceWorkdayStart = Date.now() - (workday.startTime || Date.now());

            // Trigger if:
            // 1. We've been stopped for > 15 mins (based on first point in cluster)
            // 2. Workday has been active for > 15 mins
            if (timeSinceStopStarted > STOP_DETECT_DURATION_MS && timeSinceWorkdayStart > STOP_DETECT_DURATION_MS) {
                const hasBeenPromptedRecently = workday.lastNewJobPromptTime && (Date.now() - workday.lastNewJobPromptTime < RECENT_PROMPT_THRESHOLD_MS);
                if (hasBeenPromptedRecently) return;

                setAiLoading(prev => ({ ...prev, newJob: true }));
                decidePromptForNewJob({
                    hasBeenPromptedRecently: !!hasBeenPromptedRecently,
                    timeStoppedInMinutes: Math.round(timeSinceStopStarted / (60 * 1000))
                })
                    .then(res => {
                        if (res.shouldPrompt) {
                            toast({ title: "¿Nuevo Trabajo?", description: "Parece que te has detenido. ¿Comenzando un nuevo trabajo? IA: " + res.reason });
                            openJobModal('new', undefined, stopStartTime);
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
                if (lastPromptTime && (Date.now() - lastPromptTime < RECENT_PROMPT_THRESHOLD_MS)) return;

                setAiLoading(prev => ({ ...prev, jobCompletion: true }));
                decidePromptForJobCompletion({ distanceMovedMeters: distance, lastJobPromptedTimestamp: lastPromptTime, jobType: currentJob.type || 'regular' })
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
