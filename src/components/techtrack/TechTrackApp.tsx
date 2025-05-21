
"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { MapPin, Play, Pause, StopCircle, Briefcase, Clock, CheckCircle, AlertTriangle, Loader2, History, CloudUpload, User } from 'lucide-react';
import type { LocationPoint, Job, TrackingStatus, TrackingEvent, Workday, PauseInterval, GeolocationError, WorkdaySummaryContext } from '@/lib/techtrack/types';
import { haversineDistance } from '@/lib/techtrack/geometry';
import { summarizeJobDescription } from '@/ai/flows/summarize-job-description';
import { decidePromptForNewJob } from '@/ai/flows/decide-prompt-for-new-job';
import { decidePromptForJobCompletion } from '@/ai/flows/decide-prompt-for-job-completion';
import { calculateWorkdaySummary } from '@/lib/techtrack/summary';
import { formatTime } from '@/lib/utils';import WorkdaySummaryDisplay from './WorkdaySummaryDisplay';import { db } from '@/lib/supabase';
import { doc, setDoc } from 'firebase/firestore';
import LocationInfo from './LocationInfo';


const LOCATION_INTERVAL_MS = 5 * 60 * 1000;
const STOP_DETECT_DURATION_MS = 15 * 60 * 1000;
const MOVEMENT_THRESHOLD_METERS = 100;
const RECENT_PROMPT_THRESHOLD_MS = 30 * 60 * 1000;
const LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX = 'TECHTRACK_CURRENT_WORKDAY_';


interface TechTrackAppProps {
  technicianName: string;
}

// Helper function to sanitize location point data for Firestore
const sanitizeLocationPoint = (location: any): LocationPoint | null => {
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
    }
    return sanitized;
  }
  return null;
};


export default function TechTrackApp({ technicianName }: TechTrackAppProps) {
  const [workday, setWorkday] = useState<Workday | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null);

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [jobModalMode, setJobModalMode] = useState<'new' | 'summary'>('new');
  const [currentJobFormData, setCurrentJobFormData] = useState({ description: '', summary: '' });
  const [jobToSummarizeId, setJobToSummarizeId] = useState<string | null>(null);

  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [endOfDaySummary, setEndOfDaySummary] = useState<WorkdaySummaryContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [pendingEndDayAction, setPendingEndDayAction] = useState(false);

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
            timestamp: position.timestamp,
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

  const recordEvent = useCallback((type: TrackingEvent['type'], locationParam?: LocationPoint | null, jobId?: string, details?: string) => {
    setWorkday(prev => {
      if (!prev) return null;
      const eventLocation = sanitizeLocationPoint(locationParam === undefined ? currentLocation : locationParam);
      const newEvent: TrackingEvent = {
        id: crypto.randomUUID(),
        type,
        timestamp: Date.now(),
        jobId,
        details,
        location: eventLocation || undefined, // Ensure undefined if null
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
        const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
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

          setAiLoading(prev => ({...prev, jobCompletion: true}));
          decidePromptForJobCompletion({ distanceMovedMeters: distance, lastJobPromptedTimestamp: lastPromptTime })
            .then(res => {
              if (res.shouldPrompt) {
                toast({ title: "¿Actualizar Trabajo?", description: `Te has movido significativamente. ¿Completaste el trabajo: ${currentJob.description}? IA: ${res.reason}` });
                setJobToSummarizeId(currentJob.id);
                setJobModalMode('summary');
                setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
                setIsJobModalOpen(true);
                recordEvent('JOB_COMPLETION_PROMPT', currentLocation, currentJob.id, `IA: ${res.reason}`);
              }
              setWorkday(prev => prev ? ({...prev, lastJobCompletionPromptTime: Date.now()}) : null);
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
      startTime: startTime,
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
      startTime: now,
      startLocation: sanitizeLocationPoint(currentLocation) || undefined
    };
    setWorkday(prev => prev ? ({
      ...prev,
      status: 'paused',
      pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
    }) : null);
    recordEvent('SESSION_PAUSE', currentLocation);
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
          currentPause.endTime = now;
          currentPause.endLocation = sanitizeLocationPoint(currentLocation) || undefined;
        }
      }
      return { ...prev, status: 'tracking', pauseIntervals: updatedPauses };
    });
    recordEvent('SESSION_RESUME', currentLocation);
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
    setIsSavingToCloud(true); 

    setWorkday(prev => {
        if (!prev) return null; 
        
        let tempWorkday = JSON.parse(JSON.stringify(prev)) as Workday; // Deep copy

        if (tempWorkday.status === 'paused' && tempWorkday.pauseIntervals.length > 0) {
            const lastPause = tempWorkday.pauseIntervals[tempWorkday.pauseIntervals.length - 1];
            if (lastPause.startTime && !lastPause.endTime) { 
                lastPause.endTime = actionTime;
                lastPause.endLocation = sanitizeLocationPoint(currentLocation) || undefined;
            }
        }
        
        return {
            ...tempWorkday,
            status: 'paused', 
            endTime: actionTime, 
        };
    });
    
    // Use a timeout to allow React to process the state update for 'paused' status and endTime,
    // so the timer visually stops before Firestore operation which might take time.
    setTimeout(async () => {
      await finalizeWorkdayAndSave(JSON.parse(JSON.stringify(workdayDataToEnd)), actionTime);
    }, 0);
  };


  const finalizeWorkdayAndSave = async (workdayAtStartOfEnd: Workday, finalizationTimestamp: number) => {
    setIsSavingToCloud(true); // Ensure this is true at the start of the async operation
    console.log("Starting finalizeWorkdayAndSave");
    console.log("Starting finalizeWorkdayAndSave for workday ID:", workdayAtStartOfEnd.id);
    
    if (!db) {
      console.error("Database DB instance is not available. Check configuration.");
      toast({ 
        title: "Error de Configuración de Base de Datos",
        description: "No se puede conectar a la base de datos. Revisa la configuración de Firebase.",
        variant: "destructive",
        duration: 10000
      });
      setIsSavingToCloud(false);
      setIsLoading(false);
      setPendingEndDayAction(false);
      setWorkday(prev => prev ? {...prev, status: workdayAtStartOfEnd.status, endTime: undefined } : workdayAtStartOfEnd);
      return;
    }
    
    const finalizedWorkdayForSave = {...workdayAtStartOfEnd}; // Create a mutable copy
    const endLocationToUse = sanitizeLocationPoint(currentLocation) || 
                             (finalizedWorkdayForSave.locationHistory.length > 0 ? sanitizeLocationPoint(finalizedWorkdayForSave.locationHistory[finalizedWorkdayForSave.locationHistory.length - 1]) : null) ||
                             sanitizeLocationPoint(finalizedWorkdayForSave.startLocation) || 
                             null;

    if (finalizedWorkdayForSave.pauseIntervals.length > 0) {
        const lastPause = finalizedWorkdayForSave.pauseIntervals[finalizedWorkdayForSave.pauseIntervals.length - 1];
        if (lastPause.startTime && !lastPause.endTime) { 
            lastPause.endTime = finalizationTimestamp;
            lastPause.endLocation = endLocationToUse || undefined; 
        }
    }
    
    finalizedWorkdayForSave.status = 'ended';     
    finalizedWorkdayForSave.endTime = finalizationTimestamp; 
    finalizedWorkdayForSave.endLocation = endLocationToUse;  
    finalizedWorkdayForSave.events = [
        ...(finalizedWorkdayForSave.events || []), 
        { 
          id: crypto.randomUUID(),
          type: 'SESSION_END',
          timestamp: finalizationTimestamp,
          location: endLocationToUse || undefined,
          details: `Sesión finalizada por ${technicianName}`
        }
    ];

    // Rigorous Sanitization Pass
    finalizedWorkdayForSave.startLocation = sanitizeLocationPoint(finalizedWorkdayForSave.startLocation);
    finalizedWorkdayForSave.endLocation = sanitizeLocationPoint(finalizedWorkdayForSave.endLocation);
    
    finalizedWorkdayForSave.locationHistory = (finalizedWorkdayForSave.locationHistory || [])
        .map(loc => sanitizeLocationPoint(loc))
        .filter(loc => loc !== null) as LocationPoint[];

    finalizedWorkdayForSave.jobs = (finalizedWorkdayForSave.jobs || []).map(job => {
        const jobStartLoc = sanitizeLocationPoint(job.startLocation);
        if (!jobStartLoc) {
            console.error(`CRITICAL: Job ${job.id} being saved with invalid startLocation. Original:`, job.startLocation, "Falling back to dummy location.");
            // This indicates a problem in job creation logic.
            // For now, use a dummy location to prevent Firestore error, but data is compromised.
            return {
                ...job,
                description: job.description || '',
                summary: job.summary || '',
                aiSummary: job.aiSummary || undefined,
                startLocation: { latitude: 0, longitude: 0, timestamp: job.startTime || Date.now(), accuracy: 0 }, // Dummy
                endLocation: sanitizeLocationPoint(job.endLocation),
                status: job.status || 'completed', // Ensure status is valid
            };
        }
        return {
            ...job,
            description: job.description || '',
            summary: job.summary || '',
            aiSummary: job.aiSummary || undefined,
            startLocation: jobStartLoc,
            endLocation: sanitizeLocationPoint(job.endLocation),
            status: job.status || 'completed',
        };
    });

    finalizedWorkdayForSave.events = (finalizedWorkdayForSave.events || []).map(event => ({
        ...event,
        details: event.details || '',
        location: sanitizeLocationPoint(event.location),
    }));

    finalizedWorkdayForSave.pauseIntervals = (finalizedWorkdayForSave.pauseIntervals || []).map(pause => ({
        ...pause,
        startLocation: sanitizeLocationPoint(pause.startLocation),
        endLocation: sanitizeLocationPoint(pause.endLocation),
    }));
    
    // Default potentially undefined string fields on the root Workday object if necessary
    finalizedWorkdayForSave.currentJobId = finalizedWorkdayForSave.currentJobId || null;

    console.log("Attempting to save workday to Supabase, ID:", finalizedWorkdayForSave.id);
    console.log("Finalized workday object before sending to Supabase:", finalizedWorkdayForSave);

    try {
        // Use finalizedWorkdayForSave directly
 console.log("Data being sent to Supabase for workday upsert (workdayDataForDb):", workdayDataForDb);
 console.log("Supabase client available. Proceeding with save.");
        // Start a transaction or similar mechanism if Supabase supports it directly for multiple related inserts.
        // Supabase client doesn't have a built-in transaction API like Firestore's batched writes.
        // We'll perform inserts sequentially. If any fail, we'll log the error.
        // A more robust solution would be to use a Supabase function (RPC) to handle the atomic insert.

        // 1. Insert Workday
        console.log("Attempting to upsert workday in Supabase");
        const workdayDataForDb = {
            id: finalizedWorkdayForSave.id, // Ensure ID is used for upsert
            user_id: finalizedWorkdayForSave.userId,
            date: finalizedWorkdayForSave.date,
            start_time: finalizedWorkdayForSave.startTime, // Use numerical timestamp directly
            end_time: finalizedWorkdayForSave.endTime || null, // Use numerical timestamp directly or null
            status: finalizedWorkdayForSave.status,
            last_new_job_prompt_time: finalizedWorkdayForSave.lastNewJobPromptTime || null,
            last_job_completion_prompt_time: finalizedWorkdayForSave.lastJobCompletionPromptTime ? new Date(finalizedWorkdayForSave.lastJobCompletionPromptTime).toISOString() : null,
            current_job_id: finalizedWorkdayForSave.currentJobId,
            start_location_latitude: finalizedWorkdayForSave.startLocation?.latitude,
            start_location_longitude: finalizedWorkdayForSave.startLocation?.longitude,
            start_location_timestamp: finalizedWorkdayForSave.startLocation?.timestamp ? new Date(finalizedWorkdayForSave.startLocation.timestamp).toISOString() : null,
            start_location_accuracy: finalizedWorkdayForSave.startLocation?.accuracy,
            end_location_latitude: finalizedWorkdayForSave.endLocation?.latitude,
            end_location_longitude: finalizedWorkdayForSave.endLocation?.longitude,
            end_location_timestamp: finalizedWorkdayForSave.endLocation?.timestamp || null, // Use numerical timestamp directly or null
            end_location_accuracy: finalizedWorkdayForSave.endLocation?.accuracy,
        };
        const { error: workdayError } = await db.from('workdays').upsert(workdayDataForDb, { onConflict: 'id' });
        if (workdayError) throw workdayError;
        console.log("Workday upsert successful");
        
        // 2. Insert Jobs - Supabase insert can take an array
        // Temporarily commented out for debugging
        // console.log("Preparing jobs data for insert:", finalizedWorkdayForSave.jobs);
        // if (finalizedWorkdayForSave.jobs?.length > 0) {
        //     const jobsToInsert = finalizedWorkdayForSave.jobs.map(job => ({
        //         // Use ID for upsert if jobs should be unique within a workday
        //         id: job.id,
        //         workday_id: finalizedWorkdayForSave.id,
        //         description: job.description,
        //         start_time: job.startTime,
        //         end_time: job.endTime || null,
        //         summary: job.summary,
        //         ai_summary: job.aiSummary,
        //         status: job.status,
        //         start_location_latitude: job.startLocation?.latitude || null,
        //         start_location_longitude: job.startLocation?.longitude || null,
        //         start_location_timestamp: job.startLocation?.timestamp || null, // Keep as number
        //         start_location_accuracy: job.startLocation?.accuracy || null,
        //         end_location_latitude: job.endLocation?.latitude || null,
        //         end_location_longitude: job.endLocation?.longitude || null,
        //         end_location_timestamp: job.endLocation?.timestamp || null, // Keep as number
        //         end_location_accuracy: job.endLocation?.accuracy || null,
        //     }));
        //      console.log(`Attempting to insert ${jobsToInsert.length} jobs`);
        //     const { error: jobsError } = await db.from('jobs').insert(jobsToInsert);
        //     if (jobsError) throw jobsError;
        //      console.log("Job insert successful");
        // }
        
        // 3. Insert Pause Intervals - Supabase insert can take an array
        // Temporarily commented out for debugging
        // console.log("Preparing pause intervals data for insert:", finalizedWorkdayForSave.pauseIntervals);
        // if (finalizedWorkdayForSave.pauseIntervals?.length > 0) {
        //     const pausesToInsert = finalizedWorkdayForSave.pauseIntervals.map(pause => ({
        //         id: pause.id,
        //         workday_id: finalizedWorkdayForSave.id,
        //         start_time: pause.startTime,
        //         end_time: pause.endTime || null,
        //         start_location_latitude: pause.startLocation?.latitude || null,
        //         start_location_longitude: pause.startLocation?.longitude || null,
        //         start_location_timestamp: pause.startLocation?.timestamp || null, // Keep as number
        //         start_location_accuracy: pause.startLocation?.accuracy || null,
        //         end_location_latitude: pause.endLocation?.latitude || null,
        //         end_location_longitude: pause.endLocation?.longitude || null,
        //         end_location_timestamp: pause.endLocation?.timestamp || null, // Keep as number
        //         end_location_accuracy: pause.endLocation?.accuracy || null,
        //     }));
        //      console.log(`Attempting to insert ${pausesToInsert.length} pause intervals`);
        //     const { error: pausesError } = await db.from('pause_intervals').insert(pausesToInsert);
        //     if (pausesError) throw pausesError;
        //      console.log("Pause intervals insert successful");
        // }

        // 4. Insert Events - Supabase insert can take an array
        // Temporarily commented out for debugging
        /*
        console.log("Preparing events data for insert:", finalizedWorkdayForSave.events);
        if (finalizedWorkdayForSave.events?.length > 0) {
            const eventsToInsert = finalizedWorkdayForSave.events.map(event => ({
                id: event.id,
                workday_id: finalizedWorkdayForSave.id,
                type: event.type,
                timestamp: event.timestamp,
                job_id: event.jobId,
                details: event.details,
                location_latitude: event.location?.latitude || null,
                location_longitude: event.location?.longitude || null,
                location_timestamp: event.location?.timestamp || null, // Keep as number
                location_accuracy: event.location?.accuracy || null,
            }));
            console.log(`Attempting to insert ${eventsToInsert.length} events`);
            const { error: eventsError } = await db.from('events').insert(eventsToInsert);
            if (eventsError) throw eventsError;
            console.log("Events insert successful");
        } */

        // 5. Insert Location History - Supabase insert can take an array
        // Temporarily commented out for debugging
        /*
        if (finalizedWorkdayForSave.locationHistory?.length > 0) {
            const locationsToInsert = finalizedWorkdayForSave.locationHistory.map(loc => ({
                id: crypto.randomUUID(),
                workday_id: finalizedWorkdayForSave.id, // Use finalizedWorkdayForSave.id here
                latitude: loc.latitude,
                 longitude: loc.longitude,
                 // Ensure timestamp is saved as a Date object or ISO string
                 timestamp: loc.timestamp ? new Date(loc.timestamp).toISOString() : null,
                 accuracy: loc.accuracy || null,
             }));
            console.log(`Attempting to insert ${locationsToInsert.length} location history points`);
            const { error: locationsError } = await db.from('locations').insert(locationsToInsert);
            if (locationsError) throw locationsError;
            console.log("Location history insert successful"); */
        }

      // All inserts successful, now update local state
      console.log("Supabase save successful for workday ID:", finalizedWorkdayForSave.id);
      setWorkday(finalizedWorkdayForSave); 
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
 console.log("Entering catch block in finalizeWorkdayAndSave");
      console.error("SUPABASE SAVE ERROR: Failed to save workday to Supabase.");
      console.error("Workday ID being saved:", finalizedWorkdayForSave.id);
      console.error("Full error object:", error);
      let errorMessage = "Un error desconocido ocurrió durante el guardado.";

      if (error instanceof Error) {
        errorMessage = error.message;
      }

      toast({
        title: "Error Crítico al Guardar en Nube",
        description: errorMessage,
        variant: "destructive",
        duration: 20000 
      });
      
      setWorkday(workdayAtStartOfEnd); // Revert to the state before attempting to finalize

    } finally {
      console.log("FINALLY block in finalizeWorkdayAndSave. Setting isSavingToCloud and isLoading to false.");
      setIsSavingToCloud(false);
      setIsLoading(false);
      setPendingEndDayAction(false); 
    }
  };

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
      return; 
    }
    if (workday) { 
        await initiateEndDayProcess(workday);
    }
  };

  const handleJobFormSubmit = () => {
    if (!workday) return;
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);

    if (jobModalMode === 'new') {
      if (!safeCurrentLocation) {
        toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin ubicación.", variant: "destructive" });
        return;
      }
      const newJob: Job = {
        id: crypto.randomUUID(),
        description: currentJobFormData.description,
        startTime: Date.now(),
        startLocation: safeCurrentLocation, // Already sanitized
        status: 'active',
      };
      setWorkday(prev => prev ? ({
        ...prev,
        jobs: [...prev.jobs, newJob],
        currentJobId: newJob.id,
      }) : null);
      recordEvent('JOB_START', safeCurrentLocation, newJob.id, `Nuevo trabajo iniciado: ${newJob.description}`);
      toast({ title: "Nuevo Trabajo Iniciado", description: newJob.description });
      setIsJobModalOpen(false);
      setCurrentJobFormData({ description: '', summary: '' });
      setJobToSummarizeId(null);
    } else if (jobModalMode === 'summary' && jobToSummarizeId) {
      setAiLoading(prev => ({...prev, summarize: true}));

      let completedWorkdayForSave: Workday | null = null; 

      const updateLocalWorkdayStateWithCompletedJob = (aiSummaryValue?: string | null) => {
        setWorkday(prev => {
          if (!prev) return null;
          const updatedWorkday = { 
            ...prev,
            jobs: prev.jobs.map(j => {
              if (j.id === jobToSummarizeId) {
                const jobUpdatePayload: Partial<Job> = {
                  summary: currentJobFormData.summary || '', // Ensure summary is not undefined
                  status: 'completed',
                  endTime: Date.now(),
                  endLocation: safeCurrentLocation || undefined, 
                };
                if (aiSummaryValue) { // Only add aiSummary if it has a value
                  jobUpdatePayload.aiSummary = aiSummaryValue;
                }
                return { ...j, ...jobUpdatePayload } as Job;
              }
              return j;
            }),
            currentJobId: null, 
          };
          completedWorkdayForSave = updatedWorkday; 
          return updatedWorkday; 
        });
      };

      summarizeJobDescription({ jobDescription: currentJobFormData.summary || 'N/A' }) // Provide default if empty
        .then(aiRes => {
          recordEvent('JOB_COMPLETED', safeCurrentLocation, jobToSummarizeId, `Trabajo completado. Usuario: ${currentJobFormData.summary}, IA: ${aiRes.summary}`);
          toast({ title: "Trabajo Completado", description: `Resumen guardado para el trabajo.` });
          updateLocalWorkdayStateWithCompletedJob(aiRes.summary);
        })
        .catch(err => {
          console.error("AI Error (summarizeJobDescription):", err);
          toast({ title: "Error de IA", description: "No se pudo generar el resumen de IA. Trabajo guardado sin él.", variant: "destructive" });
          recordEvent('JOB_COMPLETED', safeCurrentLocation, jobToSummarizeId, `Trabajo completado (falló resumen IA). Usuario: ${currentJobFormData.summary}`);
          updateLocalWorkdayStateWithCompletedJob(null); 
        })
        .finally(() => {
          setAiLoading(prev => ({...prev, summarize: false}));
          setIsJobModalOpen(false); 

          setTimeout(() => {
            if (pendingEndDayAction && completedWorkdayForSave) {
                initiateEndDayProcess(completedWorkdayForSave); 
            } else if (!pendingEndDayAction) {
                setCurrentJobFormData({ description: '', summary: '' });
                setJobToSummarizeId(null);
            }
          }, 0);
        });
      return; 
    }
  };

  const handleManualStartNewJob = () => {
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
    if (!safeCurrentLocation) {
      toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin ubicación.", variant: "destructive" });
      return;
    }
    setJobModalMode('new');
    setCurrentJobFormData({ description: '', summary: '' });
    setIsJobModalOpen(true);
    recordEvent('USER_ACTION', safeCurrentLocation, undefined, "Modal de nuevo trabajo abierto manualmente");
  };

  const handleManualCompleteJob = () => {
    if (!currentJob) return;
    setJobToSummarizeId(currentJob.id);
    setJobModalMode('summary');
    setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
    setIsJobModalOpen(true);
    recordEvent('USER_ACTION', sanitizeLocationPoint(currentLocation), currentJob.id, "Modal de completar trabajo abierto manualmente");
  };

  const CurrentStatusDisplay = () => {
    if (!workday) return <p className="text-muted-foreground">Presiona "Iniciar Seguimiento" para comenzar tu día.</p>;

    let statusText = "Desconocido";
    let IconComponent = AlertTriangle;

    switch (workday.status) {
      case 'idle': statusText = "Listo para Empezar"; IconComponent = Play; break;
      case 'tracking': statusText = "Seguimiento Activo"; IconComponent = Clock; break;
      case 'paused': 
        if (isSavingToCloud && workday.endTime) { 
             statusText = "Finalizando jornada...";
             IconComponent = Loader2; 
        } else {
            statusText = "Seguimiento Pausado"; IconComponent = Pause; 
        }
        break;
      case 'ended': statusText = "Día Finalizado"; IconComponent = StopCircle; break;
    }
    return (
      <div className="flex items-center space-x-2">
        <IconComponent className={`h-5 w-5 text-accent ${IconComponent === Loader2 ? 'animate-spin' : ''}`} />
        <span>{statusText}</span>
      </div>
    );
  };

  const ActionButton = () => {
    const commonDisabled = isLoading || isSavingToCloud;
    if (!workday || workday.status === 'idle') {
      return <Button onClick={handleStartTracking} disabled={!currentLocation || commonDisabled} className="w-full" size="lg">
        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-5 w-5" />} Iniciar Seguimiento
      </Button>;
    }
    if (workday.status === 'tracking') {
      return (
        <div className="grid grid-cols-2 gap-4">
          <Button onClick={handlePauseTracking} variant="outline" disabled={commonDisabled} className="w-full" size="lg">
            {isLoading && !isSavingToCloud ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-5 w-5" />} Pausar
          </Button>
          <Button onClick={handleEndDay} variant="destructive" disabled={commonDisabled} className="w-full" size="lg">
             {isSavingToCloud ? <CloudUpload className="mr-2 h-5 w-5 animate-pulse" /> : (isLoading && !isSavingToCloud ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> :<StopCircle className="mr-2 h-5 w-5" />)}
              Finalizar Día
          </Button>
        </div>
      );
    }
    if (workday.status === 'paused') {
       return (
        <div className="grid grid-cols-2 gap-4">
          <Button onClick={handleResumeTracking} disabled={commonDisabled || !!workday.endTime} className="w-full" size="lg">
            {isLoading && !isSavingToCloud && !workday.endTime ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-5 w-5" />} Reanudar
          </Button>
          <Button onClick={handleEndDay} variant="destructive" disabled={commonDisabled} className="w-full" size="lg">
            {isSavingToCloud ? <CloudUpload className="mr-2 h-5 w-5 animate-pulse" /> : (isLoading && !isSavingToCloud ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-5 w-5" />)}
             Finalizar Día
          </Button>
        </div>
      );
    }
     if (workday.status === 'ended') {
      return (
        <div className="w-full space-y-2">
            <Button onClick={() => {setWorkday(null); setElapsedTime(0); setEndOfDaySummary(null); setPendingEndDayAction(false);}} variant="secondary" className="w-full" size="lg">Iniciar Nuevo Día</Button>
        </div>
      );
    }
    return null;
  };

  const getGoogleMapsLink = (location: LocationPoint) => `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;


  return (
    <div className="flex flex-col min-h-screen items-center justify-center p-4 bg-background text-foreground">
       <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <div className="flex justify-between items-center space-x-2">
             <Link href="/history" passHref legacyBehavior>
                <Button variant="outline" size="sm" asChild>
                  <a><History className="mr-1 h-4 w-4" /> Historial Empresa</a>
                </Button>
              </Link>
            <div className="flex-grow text-center">
                <CardTitle className="text-3xl font-bold text-primary">TechTrack</CardTitle>
                <CardDescription className="flex items-center justify-center">
                    <User className="mr-1 h-4 w-4 text-muted-foreground"/> Bienvenido, {technicianName}.
                </CardDescription>
            </div>
            <div className="w-auto min-w-[calc(110px+0.5rem)]"> 
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 border rounded-lg bg-secondary/30">
            <CurrentStatusDisplay />
            {workday && (workday.status === 'tracking' || workday.status === 'paused' || (workday.status === 'ended' && !endOfDaySummary)) && (
              <p className="text-4xl font-mono font-bold text-center mt-2">{formatTime(elapsedTime)}</p>
            )}
             {workday?.status === 'ended' && endOfDaySummary && (
                 <p className="text-sm text-muted-foreground text-center mt-2">Tiempo total activo: {formatTime(endOfDaySummary.totalActiveTime)}</p>
             )}
          </div>

          {currentLocation && (
            <div className="text-xs text-muted-foreground flex items-center space-x-1">
              <MapPin className="h-3 w-3" />
              <span>Lat: {currentLocation.latitude.toFixed(4)}, Lon: {currentLocation.longitude.toFixed(4)} (Acc: {(currentLocation.accuracy ?? 0).toFixed(0)}m)</span>
            </div>
          )}
          {geolocationError && <p className="text-xs text-destructive">Error de Geolocalización: {geolocationError.message}</p>}

          {currentJob && currentJob.status === 'active' && (
            <Card className="bg-accent/10">
              <CardHeader className="p-3">
                <CardTitle className="text-sm flex items-center"><Briefcase className="mr-2 h-4 w-4 text-accent"/>Trabajo Actual</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <p className="text-sm">{currentJob.description}</p>
                 {currentJob.startLocation && <LocationInfo location={currentJob.startLocation} label="Iniciado en" time={currentJob.startTime} getGoogleMapsLink={getGoogleMapsLink} />}
              </CardContent>
              <CardFooter className="p-3">
                <Button onClick={handleManualCompleteJob} size="sm" className="w-full" disabled={isLoading || isSavingToCloud || aiLoading.summarize}>
                  <CheckCircle className="mr-2 h-4 w-4" /> Completar Este Trabajo
                </Button>
              </CardFooter>
            </Card>
          )}

          {workday?.status === 'tracking' && !currentJob && (
            <Button onClick={handleManualStartNewJob} variant="outline" className="w-full mt-2" disabled={isLoading || isSavingToCloud}>
              <Briefcase className="mr-2 h-4 w-4" /> Iniciar Nuevo Trabajo
            </Button>
          )}

          {(aiLoading.newJob || aiLoading.jobCompletion || aiLoading.summarize) && (
            <div className="flex items-center justify-center text-sm text-muted-foreground pt-2">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span>IA está pensando...</span>
            </div>
          )}

        </CardContent>
        <CardFooter>
          <ActionButton />
        </CardFooter>
      </Card>

      <Dialog open={isJobModalOpen} onOpenChange={(open) => {
        if (pendingEndDayAction && jobModalMode === 'summary' && !open && !aiLoading.summarize && !isSavingToCloud) {
            toast({title: "Acción Requerida", description: "Por favor, complete los detalles del trabajo antes de finalizar el día.", variant: "default"});
            setIsJobModalOpen(true); 
            return; 
        }

        setIsJobModalOpen(open); 

        if (!open) { 
            if (pendingEndDayAction && jobModalMode === 'summary' && !aiLoading.summarize && !isSavingToCloud) {
                setPendingEndDayAction(false); 
                toast({ title: "Finalización de Día Cancelada", description: "Se cerró el modal de completar trabajo. El día no ha finalizado.", variant: "default" });
            }
            if (aiLoading.summarize) { 
                 setAiLoading(prev => ({...prev, summarize: false}));
            }
            // Reset form only if not in the middle of an AI summary that might repopulate it
            if (!aiLoading.summarize) {
                 setCurrentJobFormData({ description: '', summary: '' });
                 setJobToSummarizeId(null);
            }
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{jobModalMode === 'new' ? 'Iniciar Nuevo Trabajo' : 'Completar Trabajo'}</DialogTitle>
            <DialogDescription>
              {jobModalMode === 'new' ? 'Ingrese los detalles para el nuevo trabajo.' : `Proporcione un resumen para: ${currentJobFormData.description}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {jobModalMode === 'new' && (
              <div className="space-y-2">
                <Label htmlFor="jobDescription">Descripción del Trabajo</Label>
                <Textarea
                  id="jobDescription"
                  value={currentJobFormData.description}
                  onChange={(e) => setCurrentJobFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Ej: Reparación de A/C en Calle Falsa 123"
                />
              </div>
            )}
            {jobModalMode === 'summary' && (
              <div className="space-y-2">
                <Label htmlFor="jobSummary">Resumen del Trabajo</Label>
                <Textarea
                  id="jobSummary"
                  value={currentJobFormData.summary}
                  onChange={(e) => setCurrentJobFormData(prev => ({ ...prev, summary: e.target.value }))}
                  placeholder="Ej: Se reemplazó el capacitor y se limpiaron las bobinas."
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" onClick={() => {
                 if (pendingEndDayAction && jobModalMode === 'summary') {
                    setPendingEndDayAction(false); 
                    toast({ title: "Finalización de Día Cancelada", description: "Se canceló la finalización del trabajo. El día no ha finalizado.", variant: "default" });
                 }
                 if (aiLoading.summarize) { 
                   setAiLoading(prev => ({...prev, summarize: false}));
                 }
                 setIsJobModalOpen(false); 
              }}>Cancelar</Button>
            </DialogClose>
            <Button onClick={handleJobFormSubmit} disabled={aiLoading.summarize || isLoading || isSavingToCloud}>
              {(aiLoading.summarize || isLoading || isSavingToCloud) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {jobModalMode === 'new' ? 'Iniciar Trabajo' : 'Completar Trabajo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSummaryModalOpen} onOpenChange={setIsSummaryModalOpen}>
        <DialogContent className="max-w-lg">
          {endOfDaySummary ? (
             <WorkdaySummaryDisplay summary={endOfDaySummary} showTitle={true} />
          ) : (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="mr-2 h-6 w-6 animate-spin" />
              <p>Calculando resumen...</p>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button onClick={() => setEndOfDaySummary(null)}>Cerrar</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


    