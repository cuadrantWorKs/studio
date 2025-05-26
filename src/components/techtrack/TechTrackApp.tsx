
"use client";

import type { Workday as DbWorkday } from '@/db'; // Import DbWorkday from db.ts
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
import { db as localDb } from '@/db'; // Import the local database instance
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay';
import { db } from '@/lib/supabase';
import { syncLocalDataToSupabase } from '@/lib/techtrack/sync'; // Import sync function
import { Label } from '@/components/ui/label'; // Import the Label component from your UI library
import { formatTime } from '@/lib/utils';
import LocationInfo from './LocationInfo';
import type {
  LocationPoint, Job, TrackingEvent, Workday, PauseInterval,
  GeolocationError, WorkdaySummaryContext, TrackingStatus, TrackingEventType
} from '@/lib/techtrack/types';

const LOCATION_INTERVAL_MS = 60000;
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
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncRetryActive, setSyncRetryActive] = useState(false);
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
 { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [toast]);

  const recordEvent = useCallback((type: TrackingEvent['type'], locationParam: LocationPoint | null | undefined, jobId?: string, details?: string) => {
    setWorkday(prev => { // Use functional update
      if (!prev) return null;
      const eventLocation = sanitizeLocationPoint(locationParam === undefined ? currentLocation : locationParam);      const tempEventLiteral = {
        id: crypto.randomUUID(),
        type,
 timestamp: Date.now(), // Ensure timestamp is a number (epoch milliseconds)
        jobId,
        details: details ?? undefined, // Ensure details is undefined if null
        location: eventLocation ?? undefined, // Ensure undefined if null
      };

 return { ...prev, events: [...prev.events, {...tempEventLiteral, workdayId: prev.id, isSynced: false} as TrackingEvent] }; // Add workdayId and isSynced, cast to TrackingEvent
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
          recordEvent('LOCATION_UPDATE', safeCurrentLocation, undefined, "Actualización periódica de 1 min");
        }
      }, 60 * 1000); // Changed to 1 minute
    }

    return () => clearInterval(intervalId);
  }, [workday?.status, currentLocation, recordEvent]);

  useEffect(() => {
    let retryInterval: NodeJS.Timeout | undefined = undefined;

    if (syncRetryActive) {
      console.log('Sync retry active. Setting up interval.');
      retryInterval = setInterval(async () => {
        console.log('Attempting failed sync retry...');        setSyncStatus('syncing'); // Set status to syncing before retry attempt
        try {
          await syncLocalDataToSupabase();
          setSyncStatus('success'); // Set status to success on successful retry
          // Keep the previous logic to clear interval and retry state
          setSyncRetryActive(false); // Sync succeeded, stop retries
          console.log('Failed sync retry successful.');
        } catch (error) {
          console.error('Failed sync retry failed:', error);
        }
      }, 15 * 60 * 1000); // 15 minutes
    }

    return () => {
      if (retryInterval) clearInterval(retryInterval);
    };
  }, [syncRetryActive]);

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
    if (!isSavingToCloud && workday?.status === 'tracking' && currentJob && currentJob.status === 'active' && currentLocation) {
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
            console.error("Client-side AI Error (decidePromptForNewJob):", err);
              toast({ title: "Error de IA", description: "No se pudo verificar la finalización del trabajo.", variant: "destructive" });
            })
            .finally(() => setAiLoading(prev => ({...prev, jobCompletion: false})));
        }
    }
  }, [workday, currentJob, currentLocation, toast, recordEvent, isJobModalOpen, aiLoading.jobCompletion]);


  const handleStartTracking = async () => {
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
    if (!safeCurrentLocation) {
      toast({ title: "Ubicación Requerida", description: "No se puede iniciar el seguimiento sin ubicación.", variant: "destructive" });
 toast({
 title: "Sin Geolocalización",
 description: "Se iniciará la jornada sin coordenadas reales.",
 variant: "warning"
 });
    }
    setIsLoading(true);
    setEndOfDaySummary(null);
    const startTime = Date.now();
    const workdayId = crypto.randomUUID();

    // Declare with let so we can reference it during construction
    const newWorkday: Workday = {
      id: workdayId,
      technicianId: technicianName,
      userId: technicianName, // Ensure userId is also set
      date: getCurrentFormattedDate(),
      startTime: startTime, // Assign the number directly, already ensured to be a number
      startLocation: safeCurrentLocation,
 status: 'tracking' as TrackingStatus, // Ensure status is of type TrackingStatus
      locationHistory: [safeCurrentLocation],
      events: [{
        id: crypto.randomUUID(),
        type: 'SESSION_START' as TrackingEventType, // Ensure type is of type TrackingEventType
        // Explicitly cast timestamp to number as we know it's Date.now()
        timestamp: startTime as number,
        location: safeCurrentLocation || undefined, // Ensure location is LocationPoint | undefined
        details: `Sesión iniciada por ${technicianName}`,
        // Now we can reference workdayId
        workdayId: workdayId,
        isSynced: false,
      } as TrackingEvent], // Cast to TrackingEvent
      pauseIntervals: [],
      isSynced: false,
      jobs: [], // Initialize jobs array
    };

    // Guardamos local & estado, ensuring types for DB insertion
    // When adding to localDb, ensure startTime and startLocation match expected types
    // Explicitly construct the object with all Workday properties and correct types
    const workdayForDb: DbWorkday = {
      technicianId: newWorkday.technicianId || '', // Ensure string
      userId: newWorkday.userId, // Ensure userId is included
      date: newWorkday.date,
      startTime: newWorkday.startTime!, // Add non-null assertion
      startLocation: newWorkday.startLocation ?? null, // Ensure LocationPoint | null for DB
      status: newWorkday.status as 'idle' | 'tracking' | 'paused' | 'ended', // Cast to union of literals
      events: newWorkday.events,
      pauseIntervals: newWorkday.pauseIntervals,
      isSynced: newWorkday.isSynced,
      jobs: newWorkday.jobs,
      id: ''
    };
    
 await localDb.workdays.add(workdayForDb); // Add the explicitly constructed object with type assertion

    setWorkday(newWorkday);
    toast({ title: "Seguimiento Iniciado", description: "Tu jornada laboral ha comenzado." });

    // Primer prompt IA
    setTimeout(() => {
        setJobModalMode('new');
        setCurrentJobFormData({ description: '', summary: '' });
        setIsJobModalOpen(true);
        // Add the recordEvent call here as planned
        recordEvent('NEW_JOB_PROMPT', safeCurrentLocation, undefined, "Prompt inicial después del inicio de sesión");
    }, 100);

    setIsLoading(false);
    setSyncStatus('syncing');
    try {
        await syncLocalDataToSupabase(); // Trigger sync after starting workday
        setSyncStatus('success');
    } catch (error) { // Add the error parameter to the catch block
        console.error("Error triggering sync after starting workday:", error);
        setSyncStatus('error');
        setSyncRetryActive(true); // Activate retry if initial sync fails
    }
  };


  const handlePauseTracking = () => {
    if (!workday) return;
    setIsLoading(true);
    const now = Date.now();
    const newPauseInterval: PauseInterval = {
 id: crypto.randomUUID(), // Generate ID for new pause interval
 workdayId: workday.id, // Link to the current workday
      startTime: now,
 startLocation: sanitizeLocationPoint(currentLocation) ?? undefined, // Ensure undefined if null
 isSynced: false,
    };
 setWorkday(prev => prev ? ({ // Use functional update
      ...prev,
      status: 'paused',
      // Add the new pause interval to the array
      pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
    }) : null);
    recordEvent('SESSION_PAUSE', safeLoc || undefined); // Ensure location is sanitized
    toast({ title: "Seguimiento Pausado", description: "Tu jornada laboral está en pausa." });
    setIsLoading(false);
 setSyncStatus('syncing'); // Set status to syncing before sync
 try {
      syncLocalDataToSupabase(); // Trigger sync after pausing
      setSyncStatus('success'); // Set status to success on successful sync
 } catch (error) { console.error("Error triggering sync after pausing:", error); setSyncStatus('error');
 console.error("Error triggering sync after pausing:", error);
      setSyncRetryActive(true); // Activate retry if initial sync fails
 }
  };

  const handleResumeTracking = () => {
    setIsLoading(true);
    const now = Date.now();
    setWorkday(prev => {
      if (!prev) return null;
      const updatedPauses = [...prev.pauseIntervals];
      // Find the last active pause interval and update its end time and location
      const lastActivePauseIndex = updatedPauses.findIndex(p => p.startTime && !p.endTime);
      if (lastActivePauseIndex > -1) {
        const currentPause = updatedPauses[lastActivePauseIndex];
 currentPause.endTime = now;
          currentPause.endLocation = sanitizeLocationPoint(currentLocation) ?? undefined;
 currentPause.isSynced = false; // Mark as unsynced
        }
 return {
 ...prev,
 status: 'tracking',
 pauseIntervals: updatedPauses, // Ensure updatedPauses is returned
 // Existing pauses that were already ended and potentially synced remain unchanged
      }
    });
    recordEvent('SESSION_RESUME', safeLoc || undefined); // Ensure location is sanitized
    toast({ title: "Seguimiento Reanudado", description: "¡Bienvenido de nuevo! El seguimiento está activo." });
    setIsLoading(false);
    // Trigger sync after resuming
    syncLocalDataToSupabase().then(() => {
      setSyncStatus('success');
    }).catch((error) => {
      console.error("Error triggering sync after resuming:", error);
      setSyncRetryActive(true); // Activate retry if initial sync fails
    });
  };

  const initiateEndDayProcess = async (workdayDataToEnd: Workday, toast: ReturnType<typeof useToast>['toast'], setIsLoading: React.Dispatch<React.SetStateAction<boolean>>) => {
    const actionTime = Date.now(); // Define actionTime here if it's needed immediately for the timeout
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

    let finalizedWorkdayForSave: Workday = { ...workdayAtStartOfEnd };
    
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

 try { // Start of the try block covering database operations

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
 events: (workdayAtStartOfEnd.events || []).map(event => ({ ...event })),
 pauseIntervals: (workdayAtStartOfEnd.pauseIntervals || []).map(pause => ({ ...pause })),
 locationHistory: (workdayAtStartOfEnd.locationHistory || []).map(loc => ({ ...loc })),
        };
        
        // Determine the best end location for the workday
        const finalEndLocationCandidate = sanitizeLocationPoint(currentLocation) ||
                                          (finalizedWorkdayForSave.locationHistory.length > 0 ? sanitizeLocationPoint(finalizedWorkdayForSave.locationHistory[finalizedWorkdayForSave.locationHistory.length - 1]) : null) || // Explicitly sanitize
                                          sanitizeLocationPoint(finalizedWorkdayForSave.startLocation) || // Explicitly sanitize
                                          null;

        finalizedWorkdayForSave.endLocation = finalEndLocationCandidate || null; // Ensure it's null if undefined
        
        // Update pause intervals that were still active at the end of the day using the finalization timestamp
 finalizedWorkdayForSave.pauseIntervals = (finalizedWorkdayForSave.pauseIntervals || []).map((pause: PauseInterval) => {
            if (pause.startTime && !pause.endTime) {
                return {
                    id: pause.id,
 workdayId: finalizedWorkdayForSave.id, // Add workdayId
 startLocation: sanitizeLocationPoint(pause.startLocation) || null, // Ensure startLocation is sanitized and can be null for DB
 startTime: pause.startTime,
 endTime: finalizationTimestamp, // Ensure end time is a number
                endLocation: finalEndLocationCandidate || undefined, // Use the determined final end location or undefined
 isSynced: false, // Mark as unsynced
                };
            } else { // Handle already ended pauses and ensure they are linked to the workday
                return {
                    ...pause, // Spread the original pause object to include id, workdayId, startTime
 startLocation: sanitizeLocationPoint(pause.startLocation) || undefined,
 endTime: pause.endTime ?? undefined,
 endLocation: sanitizeLocationPoint(pause.endLocation) || undefined, // Ensure existing endLocation is sanitized
 isSynced: pause.isSynced, // Keep existing sync status for already ended pauses
                };
            }
 });
        
        // Rigorous Sanitization Pass for main Workday locations
        finalizedWorkdayForSave.startLocation = sanitizeLocationPoint(finalizedWorkdayForSave.startLocation);
        finalizedWorkdayForSave.endLocation = sanitizeLocationPoint(finalizedWorkdayForSave.endLocation);



 finalizedWorkdayForSave.locationHistory = (finalizedWorkdayForSave.locationHistory || []) // Ensure array exists
            .map(loc => sanitizeLocationPoint(loc)) // Sanitize each location point
 .filter(loc => loc !== null) as LocationPoint[];

        // The rest of the logic relies on finalizedWorkdayForSave being defined.
        // Supabase insertion logic
            // Map and sanitize Job data for Supabase
            finalizedWorkdayForSave.jobs = (workdayAtStartOfEnd.jobs || []).map((job): Job => {
              // Sanitize locations and ensure timestamps are numbers
              const jobStartLoc = sanitizeLocationPoint(job.startLocation) || null; // Ensure startLocation is null if invalid
              const jobEndLoc = sanitizeLocationPoint(job.endLocation) || finalEndLocationCandidate || null; // Use job end location, then final end location, or null

              return {
                workdayId: finalizedWorkdayForSave.id,
                id: job.id,
 description: job.description || '', // Ensure string, handle null/undefined
 summary: job.summary || undefined,
 aiSummary: job.aiSummary ?? undefined, // Ensure undefined or string
                startLocation: jobStartLoc,
                endLocation: jobEndLoc,
                status: job.status === 'active' ? 'completed' : job.status,
                startTime: job.startTime!,                                // asumo non-null
                endTime: job.status === 'active' && !job.endTime
                  ? finalizationTimestamp // Ensure number
 : job.endTime!,                                         // asumo non-null
 isSynced: job.isSynced, // Keep existing sync status
              } as Job; // Explicitly cast to Job
            });

            finalizedWorkdayForSave.events = [
              // Conserva los eventos que ya estaban

 // Filter for jobs that were newly completed in this finalization step
              // Add a JOB_COMPLETED event for each job that was completed during finalization (status was active)
              ...(finalizedWorkdayForSave.jobs || []).map((job): TrackingEvent => ({
                id: crypto.randomUUID(),
                type: 'JOB_COMPLETED',
                timestamp: job.endTime!, // job.endTime es number garantizado
                jobId: job.id,
                details: `Trabajo completado: ${job.description}. Resumen: ${job.summary}`,
 location: sanitizeLocationPoint(job.endLocation) || undefined, // Use job's end location, ensure undefined if null
 workdayId: finalizedWorkdayForSave.id, // Ensure workdayId is included
                isSynced: false,
              })),
            ];

            console.log("Finalized workday object before sending to Supabase:", finalizedWorkdayForSave); // Keep this log

            console.log("Supabase client available. Proceeding with save.");
            // We'll perform inserts sequentially. If any fail, we'll log the error.
            // A more robust solution would be to use a Supabase function (RPC) to handle the atomic inserts.

  // … todo tu código de upserts (workdays, jobs, pauses, events, locations) …

            // Map location history data for Supabase insert
            const locationsToInsert = (finalizedWorkdayForSave.locationHistory || [])
              .filter(loc => loc !== null && loc !== undefined) // Ensure no null or undefined locations get through
              .map(loc => ({
                workday_id: finalizedWorkdayForSave.id,
                latitude: loc!.latitude, // Use non-null assertion after filter
                longitude: loc!.longitude, // Use non-null assertion after filter
                timestamp: new Date(loc!.timestamp).toISOString(), // Convert epoch milliseconds to ISO string
                accuracy: loc!.accuracy ?? null, // Use accuracy if exists, otherwise null
              }));


  // Después de tu último upsert:
  const { error: locationsError } = await db
    .from('locations')
    .insert(locationsToInsert);
  if (locationsError) throw locationsError;

  // Actualizamos estado local y mostramos toast
  const successfullySavedWorkday = { ...finalizedWorkdayForSave, isSynced: true };
  setWorkday(successfullySavedWorkday);
  toast({
    title: "Día Finalizado y Guardado",
 description: "La sesión de trabajo ha concluido y se ha guardado en la nube."
  });
  localStorage.removeItem(getLocalStorageKey());

  // Intento de resumen en su propio try/catch pero TODO dentro del supabase try
  try {
    const summary = await calculateWorkdaySummary(finalizedWorkdayForSave);
    setEndOfDaySummary(summary);
    setIsSummaryModalOpen(true);
  } catch (summaryError) {
    console.error("Error al calcular el resumen del fin de día:", summaryError);
    toast({
      title: "Error de Resumen",
      description: "No se pudo calcular el resumen de la jornada.",
      variant: "destructive"
    });
  }

} catch (error: any) {
  // Aquí va tu manejo del error global de Supabase
  console.error("Workday ID being saved:", finalizedWorkdayForSave?.id);
  console.error("Full error object:", {
    code: error.code,
    details: error.details,
    hint: error.hint,
    message: error.message
  });
  const errorMessage = error instanceof Error ? error.message : "Error desconocido al guardar en la nube.";
  toast({
    title: "Error Crítico al Guardar en Nube",
    description: errorMessage,
    variant: "destructive",
    duration: 20000
  });
  // Si quieres revertir el estado local:
  setWorkday(workdayAtStartOfEnd);

} finally {
  setIsSavingToCloud(false);
  setIsLoading(false);
  setPendingEndDayAction(false);
}
}; // <-- Semicolon para cerrar la definición de la función


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
 workdayId: workday.id, // Link to the current workday
 startLocation: safeCurrentLocation || null, // Ensure startLocation is null if geolocation is not available
 status: 'active',
 isSynced: false,
 };
 setWorkday(prev => prev ? ({
 ...prev, // Spread previous state
 jobs: [...prev.jobs, newJob],
 currentJobId: newJob.id,
 }) : null);
 recordEvent('JOB_START', safeCurrentLocation || undefined, newJob.id, `Nuevo trabajo iniciado: ${newJob.description}`); // Ensure location is undefined if null
 toast({ title: "Nuevo Trabajo Iniciado", description: newJob.description });
 setIsJobModalOpen(false);
 setSyncStatus('syncing'); // Set status to syncing before sync
      try {
      syncLocalDataToSupabase(); // Trigger sync after starting a new job
      setSyncStatus('success'); // Set status to success on successful sync
 } catch (error) { console.error("Error triggering sync after starting new job:", error); setSyncStatus('error');
        console.error("Error triggering sync after starting new job:", error);
      setSyncRetryActive(true); // Activate retry if initial sync fails
 }
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
 endLocation: safeCurrentLocation || null, // Ensure endLocation is null if geolocation is not available
 isSynced: false, // Mark the updated job as unsynced
 };

 return {
            ...prev,
 jobs: updatedJobs,
 currentJobId: null, // No current job after completion, explicitly set to null
          };
        });

        // Record the job completion event immediately after local update
 recordEvent('JOB_COMPLETED', safeCurrentLocation || undefined, jobToSummarizeId, `Trabajo completado. Usuario: ${currentJobFormData.summary}`); // Ensure location is undefined if null
 toast({ title: "Trabajo Completado", description: `Resumen de usuario guardado para el trabajo.` });

 // Close modal and reset form immediately
        setIsJobModalOpen(false);
        try {
 setSyncStatus('syncing'); // Set status to syncing before sync
 syncLocalDataToSupabase(); // Trigger sync after completing a job (user summary saved)
 setSyncStatus('success'); // Set status to success on successful sync
 } catch (error) {
 setSyncRetryActive(true); // Keep existing retry activation
 }
 setCurrentJobFormData({ description: '', summary: '' });

 // 2. Initiate AI summarization asynchronously (fire-and-forget)
      setAiLoading(prev => ({ ...prev, summarize: true })); // Indicate AI is working
 // Use the user's summary for the AI prompt
 await summarizeJobDescription({ jobDescription: currentJobFormData.summary || 'N/A' }) // Provide default if summary is empty
 .then(async aiRes => {
          // `aiRes` contains the AI summary
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
            updatedJobs[jobIndexForAI].isSynced = false; // Mark job as unsynced again with AI summary
 return { ...prev, jobs: updatedJobs };
          });
          // Optionally show a toast for successful AI summary update
 await syncLocalDataToSupabase(); // Trigger sync after AI summary is added
 toast({ title: "Resumen de IA Disponible", description: "Se añadió el resumen de IA al trabajo." }); // Keep AI success toast
      }) // Close the then block for summarizeJobDescription
 .catch(err => {
 console.error("AI Error (summarizeJobDescription):", err); // Keep existing error handling
 toast({ title: "Error de IA", description: "No se pudo generar el resumen de IA para este trabajo.", variant: "destructive" });
          // The local state already has the user's summary, so no change needed there.
 })
 .finally(() => {
          // 4. Check if End Day action was pending and proceed
 if (pendingEndDayAction) { // Ensure we only proceed if the flag is still true
 console.log("AI summarize finally block: Pending end day action detected. Checking latest state...");
 // We need to check the *current* state of the workday in the callback.
 setWorkday(latestWorkdayState => { // Using functional update to get latest state
 if (!latestWorkdayState) return latestWorkdayState; // Return current state if null
 const jobIsLocallyCompleted = latestWorkdayState.jobs.find(j => j.id === jobToSummarizeId)?.status === 'completed';
 if (jobIsLocallyCompleted) { // Only proceed if job is locally completed
 initiateEndDayProcess(latestWorkdayState, toast, setIsLoading);
 setPendingEndDayAction(false); // Clear the flag once action is initiated
 }
 return latestWorkdayState; // Always return the latest state
          }
); // Close the setWorkday functional update call
 setAiLoading(prev => ({ ...prev, summarize: false })); // Ensure AI loading is off
    };
  }); // Close the handleJobFormSubmit function definition


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

  // Final Render
  return (
    <div className="flex justify-center items-center min-h-screen p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <User className="h-6 w-6" />
            <span>{technicianName}</span>
          </CardTitle>
          <CardDescription>
            Sistema de Seguimiento Técnico
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col space-y-4">
          <CurrentStatusDisplay />

          <LocationInfo
 location={currentLocation === null ? undefined : currentLocation}
 error={geolocationError || undefined}
 label="Current Location"
 getGoogleMapsLink={(loc) => `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`} />
 {geolocationError && (
 <div className="text-sm text-red-600 flex items-start space-x-2">
 <Ban className="h-5 w-5 flex-shrink-0" />
 <span><strong>Geolocalización Deshabilitada:</strong> Para iniciar el seguimiento, la aplicación necesita acceder a tu ubicación. Por favor, habilita los permisos de ubicación para esta app en la configuración de tu dispositivo.</span>
 </div>
 )}
          {workday?.status !== 'idle' && (
            <>
              <div className="flex items-center space-x-2 text-sm">
                <Clock className="h-5 w-5 text-blue-500" />
                <span>Tiempo Transcurrido: {formatTime(elapsedTime)}</span>
              </div>
              {currentJob && (
                <div className="flex items-center space-x-2 text-sm"><Briefcase className="h-5 w-5 text-green-500" /><span>Trabajo Actual: {currentJob.description}</span></div>
              )}
            </>
          )}
          {workday?.status === 'idle' && !currentLocation && (
            <div className="text-sm text-orange-600 flex items-center space-x-2">
              <MapPinned className="h-4 w-4 flex-shrink-0" /> <span>Esperando ubicación para iniciar seguimiento...</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex-col space-y-4">
          <ActionButton />
        </CardFooter>
      </Card>
    </div>
 ); {/* Main div ends here */}
}
}
}