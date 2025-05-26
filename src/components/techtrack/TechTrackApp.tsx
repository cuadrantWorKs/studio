
"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';

import Link from 'next/link';

import { Button } from '@/components/ui/button';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';

import { Textarea } from '@/components/ui/textarea';

import { useToast } from '@/hooks/use-toast';

import {
  MapPin, Play, Pause, StopCircle, Briefcase, Clock, CheckCircle, 
  AlertTriangle, Loader2, History, CloudUpload, User, MessageSquareText, 
  Ban, MapPinned
} from 'lucide-react';

import { haversineDistance } from '@/lib/techtrack/geometry';

import { summarizeJobDescription } from '@/ai/flows/summarize-job-description';

import { decidePromptForNewJob } from '@/ai/flows/decide-prompt-for-new-job';

import { decidePromptForJobCompletion } from '@/ai/flows/decide-prompt-for-job-completion';

import { calculateWorkdaySummary } from '@/lib/techtrack/summary';
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay';
import { db } from '@/lib/supabase';
import { Label } from '@/components/ui/label'; // Import the Label component from your UI library
import { formatTime } from '@/lib/utils';
import LocationInfo from './LocationInfo';
import type {
  LocationPoint, Job, TrackingEvent, Workday, PauseInterval,
 GeolocationError, WorkdaySummaryContext, TrackingStatus
} from '@/lib/techtrack/types';

const LOCATION_INTERVAL_MS = 5 * 60 * 1000;
const STOP_DETECT_DURATION_MS = 15 * 60 * 1000;
const MOVEMENT_THRESHOLD_METERS = 100;
const RECENT_PROMPT_THRESHOLD_MS = 30 * 60 * 1000;
const LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX = 'TECHTRACK_CURRENT_WORKDAY_';


interface TechTrackAppProps {
  technicianName: string;
}

// Helper function to sanitize location point data for Firestore
const sanitizeLocationPoint = (location: LocationPoint | null | undefined): LocationPoint | null => {
  if (
    location &&
    typeof location.latitude === 'number' && !isNaN(location.latitude) &&
    typeof location.longitude === 'number' && !isNaN(location.longitude) &&
    typeof location.timestamp === 'number' && !isNaN(location.timestamp)
  ) {
    const sanitized: LocationPoint = {
      latitude: location.latitude,
      longitude: location.longitude,
      timestamp: location.timestamp,
    };
    if (typeof location.accuracy === 'number' && !isNaN(location.accuracy)) {
      sanitized.accuracy = location.accuracy;
    } // No need to include accuracy if not a number
    return sanitized;
  }
  return null;
};



export default function TechTrackApp({ technicianName }: TechTrackAppProps) {
  const [workday, setWorkday] = useState<Workday | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null); // Keep this for user feedback

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [jobModalMode, setJobModalMode] = useState<'new' | 'summary'>('new');
  const [currentJobFormData, setCurrentJobFormData] = useState({ description: '', summary: '' });
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [endOfDaySummary, setEndOfDaySummary] = useState<WorkdaySummaryContext | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [pendingEndDayAction, setPendingEndDayAction] = useState(false);
  const [jobToSummarizeId, setJobToSummarizeId] = useState<string | null>(null);

  const { toast } = useToast();

  const getCurrentFormattedDate = () => new Date().toISOString().split('T')[0];
  const getLocalStorageKey = useCallback(() => `${LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX}${technicianName}`, [technicianName]);


  useEffect(() => {
    const localStorageKey = getLocalStorageKey();
    const savedWorkdayJson = localStorage.getItem(localStorageKey);
    if (savedWorkdayJson) {
      try {
        const savedWorkday = JSON.parse(savedWorkdayJson) as Workday;
        if (savedWorkday && savedWorkday.userId === technicianName && savedWorkday.status !== 'ended') {
            setWorkday(savedWorkday);
        } else {
            localStorage.removeItem(localStorageKey); // Clean up if invalid or ended
        }
      } catch (e) {
        console.error("Error parsing workday from localStorage", e);
        localStorage.removeItem(localStorageKey);
      }
    }
  }, [technicianName, getLocalStorageKey]);

  useEffect(() => {
    const localStorageKey = getLocalStorageKey();
    if (workday && workday.status !== 'ended' && workday.userId === technicianName) {
      localStorage.setItem(localStorageKey, JSON.stringify(workday));
    }
  }, [workday, technicianName, getLocalStorageKey]);


  const currentJob = useMemo(() => {
    if (!workday?.currentJobId) return null;
    return workday.jobs.find(j => j.id === workday.currentJobId);
  }, [workday]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const newLocation: LocationPoint = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? undefined, 
 timestamp: position.timestamp, // Keep as number (epoch milliseconds)
          };
          setCurrentLocation(sanitizeLocationPoint(newLocation)); // Sanitize immediately
          setGeolocationError(null);
        },
        (error) => {
          setGeolocationError({ code: error.code, message: error.message });
          toast({ title: "Error de Geolocalización", description: error.message, variant: "destructive" });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [toast]);

  const recordEvent = useCallback((type: TrackingEvent['type'], locationParam: LocationPoint | null | undefined, jobId?: string, details?: string) => {
    setWorkday(prev => { // Use functional update
      if (!prev) return null;
      const eventLocation = sanitizeLocationPoint(locationParam === undefined ? currentLocation : locationParam);
      const newEvent: TrackingEvent = {
        id: crypto.randomUUID(),
        type,
 timestamp: Date.now(), // Ensure timestamp is a number (epoch milliseconds)
        jobId,
        details: details ?? undefined, // Ensure details is undefined if null
        location: eventLocation ?? undefined, // Ensure undefined if null
      };
      return { ...prev, events: [...prev.events, newEvent] };
    });
  }, [currentLocation]);


  useEffect(() => {
    let intervalId: NodeJS.Timeout | undefined = undefined;

    if (workday?.status === 'tracking') {
      intervalId = setInterval(() => {
        const now = Date.now();
        let activeTime = now - (workday.startTime || now);
        workday.pauseIntervals.forEach(p => {
          if (p.endTime && p.startTime) {
            activeTime -= (p.endTime - p.startTime);
          }
        });
        setElapsedTime(activeTime < 0 ? 0 : activeTime);
      }, 1000);
    } else if (workday?.status === 'paused' || workday?.status === 'ended') {
        const baseTime = (workday.endTime || workday.pauseIntervals.find(p => !p.endTime)?.startTime || Date.now());
        let activeTime = (baseTime) - (workday.startTime || baseTime) ;
         workday.pauseIntervals.forEach(p => {
          if (p.endTime && p.startTime) {
             if (!(workday.status === 'paused' && p.startTime === workday.pauseIntervals[workday.pauseIntervals.length-1]?.startTime && !p.endTime)) {
                 activeTime -= (p.endTime - p.startTime);
             }
          }
        });
        setElapsedTime(activeTime < 0 ? 0 : activeTime);
    } else if (workday?.status === 'idle'){
        setElapsedTime(0);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [workday]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (workday?.status === 'tracking' && currentLocation) { 
      intervalId = setInterval(() => {
        const safeCurrentLocation = sanitizeLocationPoint(currentLocation) as LocationPoint | null; // Explicitly cast
        if (safeCurrentLocation) { 
          setWorkday(prev => prev ? ({ ...prev, locationHistory: [...prev.locationHistory, safeCurrentLocation] }) : null);
          recordEvent('LOCATION_UPDATE', safeCurrentLocation, undefined, "Actualización periódica de 5 min");
        }
      }, LOCATION_INTERVAL_MS);
    }
    return () => clearInterval(intervalId);
  }, [workday?.status, currentLocation, recordEvent]);

  useEffect(() => {
    if (workday?.status === 'tracking' && !currentJob) {
      if (aiLoading.newJob || isJobModalOpen) return; 
      
      const lastMovementTime = workday.locationHistory[workday.locationHistory.length -1]?.timestamp || workday.startTime;
      if (Date.now() - (lastMovementTime || Date.now()) > STOP_DETECT_DURATION_MS) {
        const hasBeenPromptedRecently = workday.lastNewJobPromptTime && (Date.now() - workday.lastNewJobPromptTime < RECENT_PROMPT_THRESHOLD_MS);
        
 setAiLoading(prev => ({...prev, newJob: true}));
        decidePromptForNewJob({ hasBeenPromptedRecently: !!hasBeenPromptedRecently, timeStoppedInMinutes: Math.round(STOP_DETECT_DURATION_MS / (60*1000)) })
          .then(res => {
            if (res.shouldPrompt) {
              toast({ title: "¿Nuevo Trabajo?", description: "Parece que te has detenido. ¿Comenzando un nuevo trabajo? IA: " + res.reason });
              setJobModalMode('new');
              setIsJobModalOpen(true);
              recordEvent('NEW_JOB_PROMPT', currentLocation, undefined, `IA: ${res.reason}`);
            }
            setWorkday(prev => prev ? ({...prev, lastNewJobPromptTime: Date.now()}) : null);
          })
          .catch(err => {
            console.error("AI Error (decidePromptForNewJob):", err);
            toast({ title: "Error de IA", description: "No se pudo verificar si hay un nuevo trabajo.", variant: "destructive" });
          })
          .finally(() => setAiLoading(prev => ({...prev, newJob: false})));
      }
    }
  }, [workday, currentLocation, toast, recordEvent, currentJob, isJobModalOpen, aiLoading.newJob]);

  useEffect(() => {
    if (workday?.status === 'tracking' && currentJob && currentJob.status === 'active' && currentLocation) {
        if(aiLoading.jobCompletion || isJobModalOpen) return;
 
        const jobStartLocation = currentJob.startLocation; // Already sanitized LocationPoint
        if (!jobStartLocation) return; // Should not happen if job was created correctly

        const distance = haversineDistance(jobStartLocation, currentLocation); // currentLocation is sanitized
        if (distance > MOVEMENT_THRESHOLD_METERS) {
          const lastPromptTime = workday.lastJobCompletionPromptTime;

 setAiLoading(prev => ({ ...prev, jobCompletion: true }));
          decidePromptForJobCompletion({ distanceMovedMeters: distance, lastJobPromptedTimestamp: lastPromptTime })
            .then(res => {
 if (res.shouldPrompt) {
                toast({ title: "¿Actualizar Trabajo?", description: `Te has movido significativamente. ¿Completaste el trabajo: ${currentJob.description}? IA: ${res.reason}` });

                setJobModalMode('summary');
                setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
                setIsJobModalOpen(true);
                recordEvent('JOB_COMPLETION_PROMPT', currentLocation, currentJob.id, `IA: ${res.reason}`);
              }
              setWorkday(prev => prev ? ({ ...prev, lastJobCompletionPromptTime: Date.now() }) : null);
            })
            .catch(err => {
              console.error("AI Error (decidePromptForJobCompletion):", err);
              toast({ title: "Error de IA", description: "No se pudo verificar la finalización del trabajo.", variant: "destructive" });
            })
            .finally(() => setAiLoading(prev => ({...prev, jobCompletion: false})));
        }
    }
  }, [workday, currentJob, currentLocation, toast, recordEvent, isJobModalOpen, aiLoading.jobCompletion]);


  const handleStartTracking = () => {
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
    if (!safeCurrentLocation) {
      toast({ title: "Ubicación Requerida", description: "No se puede iniciar el seguimiento sin ubicación.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    setEndOfDaySummary(null);
    const startTime = Date.now();
    const newWorkday: Workday = {
      id: crypto.randomUUID(),
      userId: technicianName,
      date: getCurrentFormattedDate(),
 startTime: startTime, // Ensure startTime is a number (epoch milliseconds)
      startLocation: safeCurrentLocation, 
      status: 'tracking',
      locationHistory: [safeCurrentLocation], 
      jobs: [],
      events: [{ id: crypto.randomUUID(), type: 'SESSION_START', timestamp: startTime, location: safeCurrentLocation || undefined, details: `Sesión iniciada por ${technicianName}` }],
      pauseIntervals: [],
    };
    setWorkday(newWorkday);
    toast({ title: "Seguimiento Iniciado", description: "Tu jornada laboral ha comenzado." });

    setTimeout(() => {
        setJobModalMode('new');
        setCurrentJobFormData({ description: '', summary: '' });
        setIsJobModalOpen(true);
        recordEvent('NEW_JOB_PROMPT', safeCurrentLocation, undefined, "Prompt inicial después del inicio de sesión");
    }, 100);
    setIsLoading(false);
  };

  const handlePauseTracking = () => {
    if (!workday) return;
    setIsLoading(true);
    const now = Date.now();
    const newPauseInterval: PauseInterval = {
 id: crypto.randomUUID(), // Generate ID for new pause interval
      startTime: now,
 startLocation: sanitizeLocationPoint(currentLocation) ?? undefined // Ensure undefined if null
    } as PauseInterval; // Explicitly cast to PauseInterval
 setWorkday(prev => prev ? ({ // Use functional update
      ...prev,
      status: 'paused',
      pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
    }) : null);
    recordEvent('SESSION_PAUSE', sanitizeLocationPoint(currentLocation)); // Ensure location is sanitized
    toast({ title: "Seguimiento Pausado" });
    setIsLoading(false);
  };

  const handleResumeTracking = () => {
    if (!workday) return;
    setIsLoading(true);
    const now = Date.now();
    setWorkday(prev => {
      if (!prev) return null;
      const updatedPauses = [...prev.pauseIntervals];
      if (updatedPauses.length > 0) {
        const currentPause = updatedPauses[updatedPauses.length - 1];
        if (!currentPause.endTime && currentPause.startTime) {
 currentPause.endTime = now; // Ensure endTime is a number
          currentPause.endLocation = sanitizeLocationPoint(currentLocation) ?? undefined;
        }
      }
      return { ...prev, status: 'tracking', pauseIntervals: updatedPauses };
    });
    recordEvent('SESSION_RESUME', sanitizeLocationPoint(currentLocation)); // Ensure location is sanitized
    toast({ title: "Seguimiento Reanudado" });
    setIsLoading(false);
  };

 const initiateEndDayProcess = async (workdayDataToEnd: Workday | null) => {
    if (!workdayDataToEnd) {
        console.error("initiateEndDayProcess called with null workdayDataToEnd");
        toast({ title: "Error Interno", description: "No se pueden finalizar los datos del día.", variant: "destructive"});
        setIsLoading(false);
        return; 
    }
    const actionTime = Date.now();
    
    setIsLoading(true);
    setIsSavingToCloud(true); // Indicate saving is in progress

    // We don't need to update the state to 'paused' *before* calling finalizeWorkdayAndSave
    // The status update to 'ended' should happen within finalizeWorkdayAndSave
    // Let's simplify and pass the original workdayDataToEnd to finalizeWorkdayAndSave

    // Use a timeout to ensure any pending state updates related to job completion
    // or other actions that might trigger initiateEndDayProcess have a chance to
    // be processed by React before the finalization process begins.
    // Pass workdayDataToEnd which represents the state at the time of initiating
    // the end day process.
    setTimeout(async () => {
      await finalizeWorkdayAndSave(workdayDataToEnd, actionTime);
    }, 0);
  };


  const finalizeWorkdayAndSave = async (workdayAtStartOfEnd: Workday, finalizationTimestamp: number) => {
    setIsSavingToCloud(true); // Ensure this is true at the start of the async operation
    console.log("Starting finalizeWorkdayAndSave for workday ID:", workdayAtStartOfEnd?.id);

let finalizedWorkdayForSave!: Workday;
    
    try {
        if (!db) {
            console.error("Database DB instance is not available. Check configuration.");
                toast({title: "Error de Configuración de Base de Datos",
                description: "No se puede conectar a la base de datos.",
                variant: "destructive",
                duration: 10000
            });
            // Revert status as save didn't even start, and Firebase is not used
            setWorkday(prev => prev ? { ...prev, status: workdayAtStartOfEnd.status, endTime: undefined } : workdayAtStartOfEnd);
 return; // Exit the function early if DB is not available
        }

        // Create finalizedWorkdayForSave by copying properties, ensuring number timestamps are preserved
        // Also update status, endTime, and determine the final endLocation using the provided timestamp
        finalizedWorkdayForSave = {
            ...workdayAtStartOfEnd, // Start with the original workday properties
            status: 'ended', // Set status to ended
            endTime: finalizationTimestamp, // Set the final end time
            // endLocation will be determined after sanitization below
            currentJobId: null, // Explicitly set current job to null

            // Deep copy and sanitize nested arrays to ensure data integrity and correct types
            jobs: (workdayAtStartOfEnd.jobs || []).map(job => ({ ...job })), // Shallow copy jobs for initial structure, ensure original status and times are copied
 events: (workdayAtStartOfEnd.events || []).map(event => ({ ...event })), // Shallow copy events for initial structure
            pauseIntervals: (workdayAtStartOfEnd.pauseIntervals || []).map(pause => ({ ...pause })), // Shallow copy pause intervals for initial structure
            locationHistory: (workdayAtStartOfEnd.locationHistory || []).map(loc => ({ ...loc })), // Shallow copy location history
        };

        // Determine the best end location for the workday
        const finalEndLocationCandidate = sanitizeLocationPoint(currentLocation) ||
                                          (finalizedWorkdayForSave.locationHistory.length > 0 ? sanitizeLocationPoint(finalizedWorkdayForSave.locationHistory[finalizedWorkdayForSave.locationHistory.length - 1]) : null) || // Explicitly sanitize
                                          sanitizeLocationPoint(finalizedWorkdayForSave.startLocation) || // Explicitly sanitize
                                          null;

        finalizedWorkdayForSave.endLocation = finalEndLocationCandidate || null; // Ensure it's null if undefined

        // Update pause intervals that were still active at the end of the day using the finalization timestamp
        finalizedWorkdayForSave.pauseIntervals = finalizedWorkdayForSave.pauseIntervals.map((pause: PauseInterval) => {
 if (pause.startTime && !pause.endTime) {
                return {
 id: pause.id,
 startLocation: sanitizeLocationPoint(pause.startLocation) || undefined, // Ensure startLocation is sanitized
 startTime: pause.startTime,
 endTime: finalizationTimestamp, // Ensure end time is a number
 endLocation: finalEndLocationCandidate || undefined, // Use the determined final end location or undefined
 };
 } else { // Handle already ended pauses
 return {
 id: pause.id,
 startLocation: sanitizeLocationPoint(pause.startLocation) || undefined,
 startTime: pause.startTime,
 endTime: pause.endTime ?? undefined, // Use existing endTime or undefined, ensure type
 endLocation: sanitizeLocationPoint(pause.endLocation) || undefined, // Ensure existing endLocation is sanitized
 };
 }
        });

        // Rigorous Sanitization Pass
        finalizedWorkdayForSave.startLocation = sanitizeLocationPoint(finalizedWorkdayForSave.startLocation);
        finalizedWorkdayForSave.endLocation = sanitizeLocationPoint(finalizedWorkdayForSave.endLocation);

 finalizedWorkdayForSave.locationHistory = (finalizedWorkdayForSave.locationHistory || []) // Ensure array exists
            .map(loc => sanitizeLocationPoint(loc)) // Sanitize each location point
 .filter(loc => loc !== null) as LocationPoint[];
        
// >>> REEMPLAZA DE 453 A 493 ESTE BLOQUE >>> 
finalizedWorkdayForSave.jobs = (workdayAtStartOfEnd.jobs || []).map((job): Job => {
  // 1) Sanitizamos el startLocation y forzamos no-null
  const jobStartLoc = sanitizeLocationPoint(job.startLocation);
  if (!jobStartLoc) {
    console.error(`Job ${job.id} tiene startLocation inválido.`, job.startLocation);
    throw new Error(`Invalid startLocation for job ${job.id}`);
  }

  // 2) Construimos el objeto Job, garantizando startTime/endTime como números
  return {
    id: job.id,
    description: job.description || '',
    summary: job.summary || '',
    aiSummary: job.aiSummary ?? undefined,
    startLocation: jobStartLoc,
    endLocation: job.endLocation
      ? sanitizeLocationPoint(job.endLocation)!
      : finalEndLocationCandidate!,
    status: job.status === 'active' ? 'completed' : job.status,
    startTime: job.startTime!,                                // asumo non-null
    endTime: job.status === 'active' && !job.endTime
      ? finalizationTimestamp
      : job.endTime!,                                         // asumo non-null
  };
});
// <<< HASTA AQUÍ (lín. 493) <<<


// >>> REEMPLAZA DE 484 A 500 ESTE BLOQUE >>>
finalizedWorkdayForSave.events = [
  // Conserva los eventos que ya estaban
  ...(finalizedWorkdayForSave.events as TrackingEvent[]),

  // Añade un evento JOB_COMPLETED por cada job finalizado
  ...(finalizedWorkdayForSave.jobs || []).map((job): TrackingEvent => ({
    id: crypto.randomUUID(),
    type: 'JOB_COMPLETED',
    timestamp: job.endTime!, // job.endTime es number garantizado
    jobId: job.id,
    details: `Trabajo completado: ${job.description}. Resumen: ${job.summary}`,
    location: sanitizeLocationPoint(job.endLocation)!,
  })),
];
// <<< HASTA AQUÍ (línea ~500) <<<

// <<< REEMPLAZA TODO ESTO >>>
//
// 1) Map your existing events into a proper TrackingEvent[]
const existingEvents: TrackingEvent[] = (finalizedWorkdayForSave.events || []).map((e) => ({
  id:       e.id || crypto.randomUUID(),
  type:     e.type,
  timestamp:e.timestamp,
  jobId:    e.jobId ?? undefined,
  details:  e.details ?? undefined,
  location: e.location ?? undefined,
}));

// 2) Build your JOB_COMPLETED events
const completedEvents: TrackingEvent[] = (finalizedWorkdayForSave.jobs || []).map((job) => ({
  id:       crypto.randomUUID(),
  type:     'JOB_COMPLETED',
  timestamp: job.endTime ?? finalizationTimestamp,
  jobId:    job.id,
  details:  `Trabajo completado: ${job.description}. Resumen: ${job.summary}. IA: ${job.aiSummary ?? 'N/A'}`,
  location: job.endLocation ?? job.startLocation ?? undefined,
}));

// 3) Overwrite events once, combining both lists
finalizedWorkdayForSave.events = [
  ...existingEvents,
  ...completedEvents,
];
// HASTA AQUÍ >>>
// ─── REPLACE the old pauseIntervals block with this ───
finalizedWorkdayForSave.pauseIntervals = (finalizedWorkdayForSave.pauseIntervals || []).map((pause) => ({
  ...pause,  // keep id, startTime, endTime, etc.
  startLocation: sanitizeLocationPoint(pause.startLocation) ?? undefined,
  endLocation:   sanitizeLocationPoint(pause.endLocation)   ?? undefined,
}));
// ───────────────────────────────────────────────────────

        console.log("Attempting to save workday to Supabase, ID:", finalizedWorkdayForSave.id);
        console.log("Finalized workday object before sending to Supabase:", finalizedWorkdayForSave);

        console.log("Supabase client available. Proceeding with save.");
        // Supabase client doesn't have a built-in transaction API like Firestore's batched writes.
        // We'll perform inserts sequentially. If any fail, we'll log the error.
        // A more robust solution would be to use a Supabase function (RPC) to handle the atomic inserts.

        // 1. Insert/Upsert Workday
        console.log("Attempting to upsert workday in Supabase");
        const workdayDataForDb = {
            id: finalizedWorkdayForSave.id, // Ensure ID is used for upsert
            user_id: finalizedWorkdayForSave.userId,
            date: finalizedWorkdayForSave.date,
            // Timestamps for Workday and Job/Pause intervals are int8 (bigint) in Supabase
 start_time: finalizedWorkdayForSave.startTime || null, // Ensure number or null, corrected from ISO string
            end_time: finalizedWorkdayForSave.endTime || null, // Ensure number or null
            status: finalizedWorkdayForSave.status,
 last_new_job_prompt_time: finalizedWorkdayForSave.lastNewJobPromptTime || null, // Ensure number or null
            last_job_completion_prompt_time: finalizedWorkdayForSave.lastJobCompletionPromptTime || null, // Ensure number or null
            current_job_id: finalizedWorkdayForSave.currentJobId || null, // Ensure null if undefined
 start_location_latitude: finalizedWorkdayForSave.startLocation?.latitude || null, // Ensure number or null
            start_location_longitude: finalizedWorkdayForSave.startLocation?.longitude,
 start_location_timestamp: finalizedWorkdayForSave.startLocation?.timestamp || null, // Send number or null
 end_location_latitude: finalizedWorkdayForSave.endLocation?.latitude, // Ensure number or undefined/null
            end_location_longitude: finalizedWorkdayForSave.endLocation?.longitude,
 end_location_timestamp: finalizedWorkdayForSave.endLocation?.timestamp || null, // Send number or null
        }; // Ensure all fields match Supabase schema and nullability
 console.log("Data being sent for workday upsert:", workdayDataForDb);
        const { data: workdayData, error: workdayError } = await db
 .from('workdays')
 .upsert(workdayDataForDb, { onConflict: 'id' });
 console.log("Data being sent for workday upsert:", JSON.stringify(workdayDataForDb)); // Log the specific data object

        if (workdayError) throw workdayError;
 console.log("Workday upsert successful"); // Keep this success log

        // Temporarily commenting out inserts other than location history to isolate the build issue
        // 2. Insert Jobs - Supabase insert can take an array
        console.log("Preparing jobs data for insert:", finalizedWorkdayForSave.jobs);
        if (finalizedWorkdayForSave.jobs?.length > 0) {
 const jobsToInsert = finalizedWorkdayForSave.jobs.map(job => ({
                id: job.id, // Use ID for upsert if jobs should be unique within a workday
 workday_id: finalizedWorkdayForSave.id,
 description: job.description,
                start_time: job.startTime || null, // Send number or null
 end_time: job.endTime ?? null, // Send number or null
 summary: job.summary,
 ai_summary: job.aiSummary || null, // Handle undefined/null
 status: job.status,
 start_location_latitude: job.startLocation?.latitude || null, // Ensure number or null
                start_location_longitude: job.startLocation?.longitude || null,
 start_location_timestamp: job.startLocation?.timestamp || null, // Send number or null
                start_location_accuracy: job.startLocation?.accuracy ?? null,
 end_location_latitude: job.endLocation?.latitude || null,
                end_location_longitude: job.endLocation?.longitude || null,
 end_location_timestamp: job.endLocation?.timestamp ?? null, // Send number or null
 }));
 console.log("Data being sent for jobs insert:", JSON.stringify(jobsToInsert)); // Log the specific data object
            console.log(`Attempting to insert ${jobsToInsert.length} jobs`);
            const { error: jobsError } = await db.from('jobs').upsert(jobsToInsert, { onConflict: 'id' });
            if (jobsError) throw jobsError;
            console.log("Job upsert successful");
        }

        // 3. Insert Pause Intervals - Supabase insert can take an array
        console.log("Preparing pause intervals data for insert:", finalizedWorkdayForSave.pauseIntervals);
        if (finalizedWorkdayForSave.pauseIntervals?.length > 0) {
 const pausesToInsert = finalizedWorkdayForSave.pauseIntervals.map(pause => ({
                id: pause.id, // Use ID for upsert
 workday_id: finalizedWorkdayForSave?.id, // Add null check for finalizedWorkdayForSave


 start_time: pause.startTime ?? null, // Send number or null
 end_time: pause.endTime ?? null, // Send number or null
                start_location_latitude: pause.startLocation?.latitude || null,
 start_location_longitude: pause.startLocation?.longitude || null, // Corrected typo
 start_location_timestamp: pause.startLocation?.timestamp || null, // Send number or null, corrected from ISO string
 start_location_accuracy: pause.startLocation?.accuracy || null, // Use ?? null),
                end_location_latitude: pause.endLocation?.latitude || null,
                end_location_longitude: pause.endLocation?.longitude || null, // Fixed typo
 end_location_timestamp: pause.endLocation?.timestamp || null, // Send number or null
 }));

            console.log("Data being sent for pause intervals insert:", pausesToInsert); // Log the specific data object
            console.log(`Attempting to insert ${pausesToInsert.length} pause intervals`);
            const { error: pausesError } = await db.from('pause_intervals').upsert(pausesToInsert, { onConflict: 'id' });
            if (pausesError) throw pausesError;
            console.log("Pause intervals upsert successful");
 }

        // 4. Insert Events - Supabase insert can take an array
        console.log("Preparing events data for insert:", finalizedWorkdayForSave.events);
        if (finalizedWorkdayForSave.events?.length > 0) {
 const eventsToInsert = finalizedWorkdayForSave.events.map(event => ({
                id: event.id,
                workday_id: finalizedWorkdayForSave.id,
                type: event.type,
 timestamp: event.timestamp || null, // Send number or null
 jobId: event.jobId || null, // Ensure null if undefined
                details: event.details || null, // Ensure null or string
 location_latitude: event.location?.latitude || null,
 location_longitude: event.location?.longitude || null, // Ensure number or null, fixed typo if it existed
 location_timestamp: event.location?.timestamp || null, // Send number or null, corrected from ISO string
                location_accuracy: event.location?.accuracy ?? null, // Use ?? null),
 }));
            console.log("Data being sent for events insert:", eventsToInsert); // Log the specific data object
            console.log(`Attempting to insert ${eventsToInsert.length} events`);
            // const { error: eventsError } = await db.from('events').upsert(eventsToInsert, { onConflict: 'id' }); // Use upsert for idempotency
            // if (eventsError) throw eventsError; // Keep commented out if this caused issues before
            // console.log("Events insert successful");
        }
// Temporarily commenting out inserts other than location history to isolate the build issue
        // 5. Insert Location History - Supabase insert can take an array
        // Temporarily commented out for debugging
        if (finalizedWorkdayForSave.locationHistory?.length > 0) {
 const locationsToInsert = finalizedWorkdayForSave.locationHistory.map(loc => ({
 // Let Supabase generate the ID for location history if the column is serial/identity or rely on composite primary key
 workday_id: finalizedWorkdayForSave.id, // Use finalizedWorkdayForSave.id here
 latitude: loc.latitude,
 longitude: loc.longitude,
 // Location history timestamp should be int8 (bigint) in Supabase, assuming it's stored as milliseconds
 timestamp: loc.timestamp ?? null, // Send number or null
 accuracy: loc.accuracy || null, // Ensure null if undefined
 }));
            console.log("Data being sent for location history insert:", locationsToInsert); // Log the specific data object
            console.log(`Attempting to upsert ${locationsToInsert.length} location history points`);
            // Supabase insert does not support onConflict for arrays directly,
            // but location history points should be unique anyway.
            const { error: locationsError } = await db.from('locations').insert(locationsToInsert);
            if (locationsError) throw locationsError;
        }

      // All inserts successful, now update local state;
      // Use a shallow copy here to avoid issues with React state updates
      const successfullySavedWorkday = { ...finalizedWorkdayForSave }; // Create a copy to ensure state update triggers re-render
      console.log("Supabase save successful for workday ID:", finalizedWorkdayForSave.id); // Ensure this is logged
      setWorkday(successfullySavedWorkday); 
      toast({ title: "Día Finalizado y Guardado", description: "La sesión de trabajo ha concluido y se ha guardado en la nube." });
      localStorage.removeItem(getLocalStorageKey());

      try {
        const summary = await calculateWorkdaySummary(finalizedWorkdayForSave);
        setEndOfDaySummary(summary);
        setIsSummaryModalOpen(true);
      } catch (summaryError) {
        console.error("Error al calcular el resumen del fin de día:", summaryError);
        toast({ title: "Error de Resumen", description: "No se pudo calcular el resumen de la jornada.", variant: "destructive" });
      }

    } catch (error: any) {
 console.error("SUPABASE SAVE ERROR: Failed to save workday to Supabase.", error);
      console.error("Workday ID being saved:", finalizedWorkdayForSave?.id); // Access ID safely
      console.error("Full error object:", {
 code: (error as any).code, // Cast to any to access code property
 details: error.details,
 hint: error.hint,
 message: error.message,
 });
      // The ReferenceError seems to be happening here or immediately after the catch block
      let errorMessage = "Un error desconocido ocurrió durante el guardado en la nube.";
      if (error instanceof Error) {
 errorMessage = error.message; // Use error message
      }

      toast({
        title: "Error Crítico al Guardar en Nube",
        description: errorMessage,
        variant: "destructive",
        duration: 20000 
      });
      
 // Revert local state to the state before the finalization attempt if available
 if (finalizedWorkdayForSave) {
        setWorkday(workdayAtStartOfEnd); // Revert local state to the state *before* initiateEndDayProcess was called
 }

    } finally {
      console.log("FINALLY block in finalizeWorkdayAndSave. Setting isSavingToCloud and isLoading to false.");
      setIsSavingToCloud(false);
      setIsLoading(false); // Ensure loading state is off
      setPendingEndDayAction(false);
    }
    if (!workday) {

        toast({ title: "Error", description: "No se puede finalizar el día sin una jornada activa.", variant: "destructive" });
        return;
    }
    const activeJob = workday.jobs.find(j => j.id === workday.currentJobId && j.status === 'active');

    if (activeJob) {
      setPendingEndDayAction(true);
      setJobToSummarizeId(activeJob.id);
      setJobModalMode('summary');
      setCurrentJobFormData({ description: activeJob.description || '', summary: '' });
      setIsJobModalOpen(true);
      recordEvent('JOB_COMPLETION_PROMPT', currentLocation, activeJob.id, "Prompt al finalizar el día");
      return; 
    }
    if (workday) { 
        await initiateEndDayProcess(workday);
    }
  };

  const handleManualStartNewJob = () => {
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
    if (!safeCurrentLocation) {
      toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin una ubicación válida.", variant: "destructive" });
      return;
    }
    setJobModalMode('new');
    setCurrentJobFormData({ description: '', summary: '' });
    setIsJobModalOpen(true);
 setJobToSummarizeId(null); // Ensure jobToSummarizeId is null when starting a new job action
    recordEvent('USER_ACTION', safeCurrentLocation, undefined, "Modal de nuevo trabajo abierto manualmente");
  
  };

  const handleManualCompleteJob = () => {
    if (!currentJob) return;
    setJobModalMode('summary');
    setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
    setIsJobModalOpen(true);
 recordEvent('USER_ACTION', sanitizeLocationPoint(currentLocation), currentJob.id, "Modal de completar trabajo abierto manualmente"); // Ensure location is sanitized
  };



  const handleJobFormSubmit = async (jobId?: string | null) => {
 if (!workday || (jobModalMode === 'summary' && !jobToSummarizeId)) return;
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
  
    if (jobModalMode === 'new') {
 if (!safeCurrentLocation) {
 toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin una ubicación válida.", variant: "destructive" });
 return;
 }
 

 const newJob: Job = { // Define the newJob object here
 id: crypto.randomUUID(),
 description: currentJobFormData.description,
 startTime: Date.now(), // Ensure startTime is a number (epoch milliseconds)
 startLocation: safeCurrentLocation, // Already sanitized
 status: 'active',
 };
 setWorkday(prev => prev ? ({
 ...prev, // Spread previous state
 jobs: [...prev.jobs, newJob],
 currentJobId: newJob.id,
 }) : null);
 recordEvent('JOB_START', safeCurrentLocation, newJob.id, `Nuevo trabajo iniciado: ${newJob.description}`);
 toast({ title: "Nuevo Trabajo Iniciado", description: newJob.description });
 setIsJobModalOpen(false);
        setCurrentJobFormData({ description: '', summary: '' });
 setJobToSummarizeId(null); // Reset jobToSummarizeId
    } else if (jobModalMode === 'summary' && jobToSummarizeId) {
 if (!safeCurrentLocation) {
 toast({ title: "Ubicación Requerida", description: "No se puede completar el trabajo sin una ubicación válida.", variant: "destructive" });;
 return;
 }

 // This block is for job completion, not new job creation. The newJob object definition was misplaced.

 // --- Modified Logic for Job Completion (Non-blocking AI) ---
 console.log("Handling job completion form submit for job ID:", jobToSummarizeId);

 // Find the job to update
 const jobToUpdateIndex = workday.jobs.findIndex(j => j.id === jobToSummarizeId);
 if (jobToUpdateIndex === -1) {
 console.error(`Attempted to complete non-existent job with ID: ${jobToSummarizeId}`);
 toast({ title: "Error Interno", description: "No se encontró el trabajo para completar.", variant: "destructive" }); // User feedback

 setCurrentJobFormData({ description: '', summary: '' });
 setJobToSummarizeId(null);
 return;
 }

 // Store the job data *before* updating its status to 'completed'
 const jobBeforeCompletion = workday.jobs[jobToUpdateIndex];
 // 1. Immediately update local state to mark job as completed with user summary
 setWorkday(prev => {
          if (!prev) return null;
          const updatedJobs = [...prev.jobs];
 updatedJobs[jobToUpdateIndex] = { // Update the specific job object in the array copy
 ...jobBeforeCompletion, // Use data before AI call
 summary: currentJobFormData.summary || '', // Ensure user summary is saved as string
 status: 'completed', // Explicitly cast to literal type
 endTime: Date.now(), // Ensure endTime is a number
 endLocation: safeCurrentLocation || undefined,
 // aiSummary will be added later if AI is successful
 };

 return {
            ...prev,
 jobs: updatedJobs,
 currentJobId: null, // No current job after completion, explicitly set to null
          };
        });

        // Record the job completion event immediately after local update
 recordEvent('JOB_COMPLETED', safeCurrentLocation, jobToSummarizeId, `Trabajo completado. Usuario: ${currentJobFormData.summary}`);
 toast({ title: "Trabajo Completado", description: `Resumen de usuario guardado para el trabajo.` });

 // Close modal and reset form immediately
 setIsJobModalOpen(false);
 setCurrentJobFormData({ description: '', summary: '' });

 // 2. Initiate AI summarization asynchronously (fire-and-forget)
 // This call does NOT block the rest of the function execution.
 setAiLoading(prev => ({...prev, summarize: true})); // Indicate AI is working
 // Use the user's summary for the AI prompt
 summarizeJobDescription({ jobDescription: currentJobFormData.summary || 'N/A' }) // Provide default if summary is empty
        .then(aiRes => { // `aiRes` contains the AI summary
 console.log("AI Summarization successful:", aiRes.summary);
 // Update local state with AI summary opportunistically
 setWorkday(prev => {
            if (!prev) return null;
            const jobIndexForAI = prev.jobs.findIndex(j => j.id === jobToSummarizeId);
            if (jobIndexForAI === -1) return prev; // Job not found (shouldn't happen if ID is correct)
            const updatedJobs = [...prev.jobs];
 updatedJobs[jobIndexForAI] = {
 ...updatedJobs[jobIndexForAI],
 aiSummary: aiRes.summary,
 };
 // We could also potentially update localStorage here if desired,
 // but for now, keep it simple and rely on the next cloud sync.
 return { ...prev, jobs: updatedJobs };
          });
 // Optionally show a toast for successful AI summary update
 toast({ title: "Resumen de IA Disponible", description: "Se añadió el resumen de IA al trabajo." });
        })
        .catch(err => {
          console.error("AI Error (summarizeJobDescription):", err);
 // 3. Handle AI failure - log error, show toast, but don't revert job status
 toast({ title: "Error de IA", description: "No se pudo generar el resumen de IA para este trabajo.", variant: "destructive" });
 // The local state already has the user's summary, so no change needed there.
        })
        .finally(() => {

 // 4. Check if End Day action was pending and proceed
 if (pendingEndDayAction) { // Ensure we only proceed if the flag is still true
 console.log("AI summarize finally block: Pending end day action detected. Checking latest state...");
            // We need to check the *current* state of the workday in the callback.
 setWorkday(latestWorkdayState => {
 if (!latestWorkdayState) return null; // Should not happen here
                const jobIsLocallyCompleted = latestWorkdayState.jobs.find(j => j.id === jobToSummarizeId)?.status === 'completed';
                if (pendingEndDayAction && jobIsLocallyCompleted) {
                    console.log("Pending end day action detected and job locally completed. Initiating end day process.");
                    // Pass the latest state to initiateEndDayProcess
                    initiateEndDayProcess(latestWorkdayState);
                    setPendingEndDayAction(false); // Clear the flag once action is initiated
                } else if (!pendingEndDayAction) {
 // If no pending end day action, this was just a manual job completion, reset form
                    console.log("AI summarize finally block: Job completed, but no pending end day action.");
 // Form is already reset, this block is unnecessary
                    setCurrentJobFormData({ description: '', summary: '' });
                    setJobToSummarizeId(null);
                 }
 return latestWorkdayState; // Always return state
 });
 }
    });



  const handleEndDay = async () => {
    if (!workday) {
        toast({ title: "Error", description: "No se puede finalizar el día sin una jornada activa.", variant: "destructive" });
        return;
    }
    const activeJob = workday.jobs.find(j => j.id === workday.currentJobId && j.status === 'active');

    if (activeJob) {
 setPendingEndDayAction(true);
 setJobToSummarizeId(activeJob.id);
 setJobModalMode('summary');
 setCurrentJobFormData({ description: activeJob.description || '', summary: '' });
 setIsJobModalOpen(true);
 recordEvent('JOB_COMPLETION_PROMPT', currentLocation, activeJob.id, "Prompt al finalizar el día");
      return; // Stop here, the process will continue after the job form submit
    }

    // If no active job, proceed directly to finalizing the workday
    if (workday) { // Ensure workday is not null
 await initiateEndDayProcess(workday);
    }
  };


  const LabelIcon: React.FC<{ htmlFor?: string; className?: string; children: React.ReactNode }> = ({ htmlFor, className, children }) => {
 return (
 <Label htmlFor={htmlFor} className={`flex items-center ${className}`}>
 {children === 'Descripción' && <MessageSquareText className="mr-1 h-4 w-4" />}
 {children === 'Resumen' && <MessageSquareText className="mr-1 h-4 w-4" />}
 {children}
 </Label>
 );
  };

  // Define ActionButton outside of handleJobFormSubmit
  // Define ActionButton
  const ActionButton = () => {
    const commonDisabled = isLoading || isSavingToCloud;
    if (!workday || workday.status === 'idle') {
      return (
        <Button
          onClick={handleStartTracking}
          disabled={!currentLocation || commonDisabled}
          className="w-full"
          size="lg"
        >
          {isLoading
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <Play className="mr-2 h-5 w-5" />}
          Iniciar Seguimiento
        </Button>
      );
    }
    if (workday.status === 'tracking') {
      return (
        <div className="grid grid-cols-2 gap-4">
          <Button
            onClick={handlePauseTracking}
            variant="outline"
            disabled={commonDisabled}
            className="w-full"
            size="lg"
          >
            {isLoading
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Pause className="mr-2 h-5 w-5" />}
            Pausar
          </Button>
          <Button
            onClick={handleEndDay}
            variant="destructive"
            disabled={commonDisabled}
            className="w-full"
            size="lg"
          >
            {isSavingToCloud
              ? <CloudUpload className="mr-2 h-5 w-5 animate-pulse" />
              : <StopCircle className="mr-2 h-5 w-5" />}
            Finalizar Día
          </Button>
        </div>
      );
    }
    if (workday.status === 'paused') {
      return (
        <div className="grid grid-cols-2 gap-4">
          <Button
            onClick={handleResumeTracking}
            disabled={commonDisabled}
            className="w-full"
            size="lg"
          >
            {isLoading
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Play className="mr-2 h-5 w-5" />}
            Reanudar
          </Button>
          <Button
            onClick={handleEndDay}
            variant="destructive"
            disabled={commonDisabled}
            className="w-full"
            size="lg"
          >
            {isSavingToCloud
              ? <CloudUpload className="mr-2 h-5 w-5 animate-pulse" />
              : <StopCircle className="mr-2 h-5 w-5" />}
            Finalizar Día
          </Button>
        </div>
      );
    }
    if (workday.status === 'ended') {
      return (
        <Button
          onClick={() => {
            setWorkday(null);
            setElapsedTime(0);
            setEndOfDaySummary(null);
            setPendingEndDayAction(false);
          }}
          variant="secondary"
          className="w-full"
          size="lg"
        >
          Iniciar Nuevo Día
        </Button>
      );
    }
    return null;
  };

  // Define CurrentStatusDisplay
  const CurrentStatusDisplay = () => {
    if (!workday) {
      return <p className="text-muted-foreground">Presiona "Iniciar Seguimiento" para comenzar tu día.</p>;
    }

    let statusText = "Desconocido";
    let IconComponent = AlertTriangle;

    switch (workday.status) {
      case 'idle':
        statusText = "Listo para Empezar";
        IconComponent = Play;
        break;
      case 'tracking':
        statusText = "Seguimiento Activo";
        IconComponent = Clock;
        break;
      case 'paused':
        if (isSavingToCloud && workday.endTime) {
          statusText = "Finalizando jornada...";
          IconComponent = Loader2;
        } else {
          statusText = "Seguimiento Pausado";
          IconComponent = Pause;
        }
        break;
      case 'ended':
        statusText = "Día Finalizado";
        IconComponent = StopCircle;
        break;
    }

    return (
      <div className="flex items-center space-x-2">
        <IconComponent className={`h-5 w-5 text-accent ${IconComponent === Loader2 ? 'animate-spin' : ''}`} />
        <span>{statusText}</span>
      </div>
    );
  };

// Final render
return (
  <>
    <Card className="w-full max-w-md shadow-xl">
      {/* …el resto de tu JSX… */}
      <CardFooter className="flex-col space-y-4">
        <ActionButton />
        {workday?.status !== 'ended' && (
          <div className="text-sm text-muted-foreground">
            Nota: La geolocalización es crucial para el registro. Asegúrate de tener permisos activos en tu dispositivo.
          </div>
        )}
      </CardFooter>
      </Card>
  </>
);
}   // cierra el return del final render
}   // cierra el return del handleJobFormSubmit
}   // cierra export default function TechTrackApp
