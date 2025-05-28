
"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';

import PropTypes from 'prop-types';
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
import { initiateEndDayProcess } from '@/lib/techtrack/workday'; // Import the initiateEndDayProcess function
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
export const sanitizeLocationPoint = (location?: LocationPoint | null | undefined): LocationPoint | undefined => {
 if (
    location &&
    typeof location.latitude === 'number' && !isNaN(location.latitude) &&
 typeof location.longitude === 'number' && !isNaN(location.longitude) &&
    typeof location.timestamp === 'number' && !isNaN(location.timestamp)
  ) {
    // Create a new object to ensure immutability and correct structure
    const sanitized: LocationPoint = { latitude: location.latitude, longitude: location.longitude, timestamp: location.timestamp };
 
    if (typeof location.accuracy === 'number' && !isNaN(location.accuracy)) {
      sanitized.accuracy = location.accuracy;
    } // No need to include accuracy if not a number
    return sanitized; // Return sanitized LocationPoint or undefined
  }
  return undefined;
};

interface CurrentStatusDisplayProps {
  workday: Workday | null;
  endOfDaySummary: WorkdaySummaryContext | null;
  isSavingToCloud: boolean;
}

const CurrentStatusDisplay = ({ workday, endOfDaySummary, isSavingToCloud }: CurrentStatusDisplayProps) => {
  if (!workday) {
 return <p className="text-muted-foreground">Presiona "Iniciar Seguimiento" para comenzar tu día.</p>;
  }

  let statusText = "Desconocido";
  let IconComponent = AlertTriangle;

  switch (workday.status) {
    case 'idle':
 statusText = "Listo para Empezar";
 IconComponent = Play;
 return (
 <div className="flex items-center space-x-2">
 <IconComponent className={`h-5 w-5 text-accent ${IconComponent === Loader2 ? 'animate-spin' : ''}`} />
 <span>{statusText}</span>
 </div>
 );
    case 'tracking':
 statusText = "Seguimiento Activo";
 IconComponent = Clock;
 return (
 <div className="flex items-center space-x-2">
 <IconComponent className={`h-5 w-5 text-accent ${IconComponent === Loader2 ? 'animate-spin' : ''}`} />
 <span>{statusText}</span>
 </div>
 );
    case 'paused':
      if (isSavingToCloud && workday.endTime) {
 statusText = "Finalizando jornada...";
 IconComponent = Loader2;
      } else {
 statusText = "Seguimiento Pausado";
 IconComponent = Pause;
      }
 return (
 <div className="flex items-center space-x-2">
 <IconComponent className={`h-5 w-5 text-accent ${IconComponent === Loader2 ? 'animate-spin' : ''}`} />
 <span>{statusText}</span>
 </div>
 );
    case 'ended':
      if (endOfDaySummary) {
 return <WorkdaySummaryDisplay summary={endOfDaySummary} />;
      }

 statusText = "Día Finalizado";
 IconComponent = StopCircle;
 return (
 <div className="flex items-center space-x-2">
 <IconComponent className={`h-5 w-5 text-accent ${IconComponent === Loader2 ? 'animate-spin' : ''}`} />
 <span>{statusText}</span>
 </div>
 );
    default:
 return (
 <div className="flex items-center space-x-2 text-muted-foreground">
 <AlertTriangle className="h-5 w-5" />
 <span>Estado Desconocido</span>
 </div>
 );
  }
};

CurrentStatusDisplay.propTypes = {
  workday: PropTypes.object, // More specific shape can be defined if needed
  endOfDaySummary: PropTypes.object, // More specific shape can be defined if needed
  isSavingToCloud: PropTypes.bool.isRequired,
};
export default function TechTrackApp({ technicianName }: TechTrackAppProps): JSX.Element {
  const [workday, setWorkday] = useState<Workday | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null); // Keep this for user feedback

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [jobModalMode, setJobModalMode] = useState<'new' | 'summary'>('new');
  const [currentJobFormData, setCurrentJobFormData] = useState({ description: '', summary: '' });
  const [endOfDaySummary, setEndOfDaySummary] = useState<WorkdaySummaryContext | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
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
      try {
        const watchId = navigator.geolocation.watchPosition(
          (position) => {
            const newLocation: LocationPoint = {
 latitude: position.coords.latitude,
  longitude: position.coords.longitude,
 accuracy: position.coords.accuracy ?? undefined,
 timestamp: position.timestamp, // Keep as number (epoch milliseconds)
 };
            setCurrentLocation(sanitizeLocationPoint(newLocation) ?? null); // sanitizeLocationPoint returns LocationPoint or undefined, ensure setCurrentLocation accepts LocationPoint | null
 setGeolocationError(null); // Clear any previous error on success
          },
          (error) => { // Geolocation error handler
 console.error('Geolocation error:', error); // Keep existing error log
            setGeolocationError({ code: error.code, message: error.message });
            toast({
 title: "Error de Geolocalización",
 description: `No se pudo obtener tu ubicación: ${error.message}. Asegúrate de que los permisos estén habilitados.`,
 variant: "destructive",
            });
 // Optionally attempt to get a one-time location if watchPosition fails
 // navigator.geolocation.getCurrentPosition(...) - depends on requirements
          },
 { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }

 );
 return () => navigator.geolocation.clearWatch(watchId);
 } catch (err) {
 console.error('Geolocation watch error', err); // Keep existing error log
 setGeolocationError({ code: 0, message: 'Error iniciando seguimiento de geolocalización.' }); // Set a generic error state
 }
    }
  }, []); // toast is a stable reference from useToast

  const recordEvent = useCallback((type: TrackingEvent['type'], locationParam: LocationPoint | null | undefined, jobId?: string, details?: string) => {
 setWorkday(prev => { // Use functional update
      if (!prev) return null;
      const eventLocation = sanitizeLocationPoint(locationParam === undefined ? currentLocation : locationParam); // Sanitize the location for the event, returns LocationPoint | undefined
      const tempEventLiteral: Omit<TrackingEvent, 'workdayId' | 'isSynced'> = { // Define the literal structure first
        id: crypto.randomUUID(),
        type,
        timestamp: Date.now(), // Ensure timestamp is a number (epoch milliseconds)
        jobId: jobId ?? undefined, // Ensure jobId is undefined if null
        details: details ?? undefined, // Ensure details is undefined if null
        location: eventLocation, // sanitizeLocationPoint returns LocationPoint | undefined, which matches TrackingEvent type
 };
 return { ...prev, events: [...prev.events, {...tempEventLiteral, workdayId: prev.id, isSynced: false}] };
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
 const safeCurrentLocation = sanitizeLocationPoint(currentLocation); // Sanitize outside the state update, returns LocationPoint | undefined
 if (safeCurrentLocation) { // Check if sanitizeLocationPoint returned a LocationPoint (not null)
 setWorkday(prev => prev ? ({ ...prev, locationHistory: [...prev.locationHistory, safeCurrentLocation] }) : null); // Add sanitized location to history
 recordEvent('LOCATION_UPDATE', safeCurrentLocation, undefined, "Actualización periódica de 1 min"); // recordEvent expects LocationPoint | null | undefined
        }
      }, 60 * 1000); // Changed to 1 minute
    }

 return () => { if (intervalId) clearInterval(intervalId); };
  }, [workday?.status, currentLocation, recordEvent]);

  useEffect(() => {
    let retryInterval: NodeJS.Timeout | undefined = undefined;

    if (syncRetryActive) {
      console.log('Sync retry active. Setting up interval.');
      retryInterval = setInterval(async () => {
        console.log('Attempting failed sync retry...');        setSyncStatus('syncing'); // Set status to syncing before retry attempt
        try { // Start of try block for sync attempt
          toast({
            title: "Reintentando Sincronización",
            description: "Intentando sincronizar datos pendientes con la nube...",
          });
          await syncLocalDataToSupabase();
          setSyncStatus('success'); // Set status to success on successful retry
          setSyncRetryActive(false); // Sync succeeded, stop retries
 toast({
            title: "Sincronización Exitosa",
            description: "Datos pendientes sincronizados correctamente.",
          });
          console.log('Failed sync retry successful.');
        } catch (error) {
 toast({ title: "Error de Sincronización", description: "Fallo al reintentar la sincronización. Reintentando en 15 minutos.", variant: "destructive" });
          setSyncStatus('error');
          console.error('Failed sync retry failed:', error);
        }
      }, 15 * 60 * 1000); // 15 minutes
    }
 // Cleanup interval on component unmount or when retry becomes inactive
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
    } // No dependencies on toast or recordEvent needed here
  }, [workday, currentLocation, toast, recordEvent, currentJob, isJobModalOpen, aiLoading.newJob]);

  useEffect(() => {
    if (!isSavingToCloud && workday?.status === 'tracking' && currentJob && currentJob.status === 'active' && currentLocation) {
        if(aiLoading.jobCompletion || isJobModalOpen) return;

        const jobStartLocation = currentJob.startLocation; // Already sanitized LocationPoint
        if (!jobStartLocation) return; // Should not happen if job was created correctly

        const distance = haversineDistance(jobStartLocation, currentLocation); // currentLocation is sanitized
        if (distance > MOVEMENT_THRESHOLD_METERS) {
          const lastPromptTime = workday.lastJobCompletionPromptTime;

 setAiLoading(prev => ({ ...prev, jobCompletion: true })); // Set AI loading state before the call
          decidePromptForJobCompletion({ distanceMovedMeters: distance, lastJobPromptedTimestamp: lastPromptTime })
            .then(res => {
 if (res.shouldPrompt) {
                toast({ title: "¿Actualizar Trabajo?", description: `Te has movido significativamente. ¿Completaste el trabajo: ${currentJob.description}? IA: ${res.reason}` });

                setJobModalMode('summary');
                setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
                setIsJobModalOpen(true);
                recordEvent('JOB_COMPLETION_PROMPT', currentLocation, currentJob.id, `IA: ${res.reason}`); // recordEvent accepts LocationPoint | null | undefined
              }
              setWorkday(prev => prev ? ({ ...prev, lastJobCompletionPromptTime: Date.now() }) : null);
            })
            .catch(err => {
            console.error("AI Error (decidePromptForJobCompletion):", err);
              toast({ title: "Error de IA", description: "No se pudo verificar la finalización del trabajo. Por favor, finaliza/inicia trabajos manualmente si es necesario.", variant: "destructive" });
            })
            .finally(() => setAiLoading(prev => ({...prev, jobCompletion: false})));
        } // No dependencies on toast or recordEvent needed here
    }
  }, [workday, currentJob, currentLocation, toast, recordEvent, isJobModalOpen, aiLoading.jobCompletion]);


  const handleStartTracking = async () => {
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation); // sanitizeLocationPoint returns LocationPoint | undefined
 if (!safeCurrentLocation) { // Check if sanitized location is undefined
 toast({
        title: "Sin Geolocalización",
        description: "No se pudo obtener tu ubicación. Iniciando jornada sin coordenadas precisas.",
 variant: "default" // Changed to default as the variant "warning" does not exist
 }); // Changed to default as the variant "warning" does not exist
    }
    setIsLoading(true);
    setEndOfDaySummary(null);
    const startTime = Date.now(); // Ensure startTime is a number (epoch milliseconds)
    const workdayId = crypto.randomUUID();

    // Declare with let so we can reference it during construction
    const newWorkday: Workday = {
      id: workdayId,
      technicianId: technicianName,
 userId: technicianName, // Ensure userId is also set
      date: getCurrentFormattedDate(),
      startTime: startTime, // Assign the number directly
 startLocation: safeCurrentLocation, // Use the sanitized location (LocationPoint | undefined)
 status: 'tracking',
 locationHistory: safeCurrentLocation ? [safeCurrentLocation] : [],
      events: [{
        id: crypto.randomUUID(),
        type: 'SESSION_START' as TrackingEventType, // Ensure type is of type TrackingEventType
        // Explicitly cast timestamp to number as we know it's Date.now()
        timestamp: startTime as number,
 location: safeCurrentLocation, // sanitizeLocationPoint returns LocationPoint | undefined, matches type
 details: `Sesión iniciada por ${technicianName}`,
        workdayId: workdayId,
        isSynced: false,
      } as TrackingEvent], // Cast to TrackingEvent
      pauseIntervals: [],
      isSynced: false,
      jobs: [], // Initialize jobs array
 }; // Workday structure is now defined and matches types.ts

    // Guardamos local & estado, ensuring types for DB insertion
    // When adding to localDb, ensure startTime and startLocation match expected types
    // Explicitly construct the object with all Workday properties and correct types for localDb
 const workdayForDb: Workday = {
      technicianId: newWorkday.technicianId,
      userId: newWorkday.userId,
      date: newWorkday.date,
      startTime: newWorkday.startTime,
 startLocation: newWorkday.startLocation ?? null, // Convert undefined to null for Dexie (DbWorkday type)
      endTime: newWorkday.endTime ?? null, // Convert undefined to null for Dexie (DbWorkday type)
 endLocation: newWorkday.endLocation ?? null,
 status: newWorkday.status,
      locationHistory: newWorkday.locationHistory,
 jobs: newWorkday.jobs, // jobs property is a JSONB field in the DB
      events: newWorkday.events, 
      pauseIntervals: newWorkday.pauseIntervals,
 isSynced: newWorkday.isSynced, // isSynced property is a boolean field
 id: newWorkday.id, // Ensure ID is included for Dexie
 } as Workday; // Explicitly cast to Workday
    await localDb.workdays.add(workdayForDb);
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
 toast({
          title: "Sincronización Inicial Exitosa",
          description: "La jornada ha comenzado y se ha sincronizado inicialmente con la nube."
        });
    } catch (error) { // Add the error parameter to the catch block
        console.error("Error triggering sync after starting workday:", error);
        setSyncStatus('error');
        setSyncRetryActive(true); // Activate retry if initial sync fails
 toast({
          title: "Error de Sincronización Inicial",
          description: "Fallo al sincronizar la jornada con la nube. Reintentos automáticos activados.",
          variant: "destructive"
        });
    }
  };


  const handlePauseTracking = () => {
 if (!workday) return;
    setIsLoading(true);
    const now = Date.now();
    const newPauseInterval: PauseInterval = {
 id: crypto.randomUUID(),
 workdayId: workday.id,
 startTime: now, // Ensure startTime is number
 startLocation: sanitizeLocationPoint(currentLocation), // sanitizeLocationPoint returns LocationPoint | undefined, matches type
 isSynced: false,
    };
 setWorkday(prev => prev ? ({ // Use functional update
 ...prev,
      status: 'paused',
      // Add the new pause interval to the array
      pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
    }) : null);
 recordEvent('SESSION_PAUSE', currentLocation); // recordEvent expects LocationPoint | null | undefined, currentLocation is LocationPoint | null
 toast({ title: "Seguimiento Pausado", description: "Tu jornada laboral está en pausa." }); // Use functional update for toast
    setIsLoading(false);
 setSyncStatus('syncing'); // Set status to syncing before sync
 try {
      syncLocalDataToSupabase(); // Trigger sync after pausing
      setSyncStatus('success'); // Set status to success on successful sync
 toast({
        title: "Sincronización Exitosa",
        description: "Datos sincronizados con la nube después de pausar.", // Use functional update for toast
      });
 } catch (error) {
      console.error("Error triggering sync after pausing:", error);
      setSyncRetryActive(true); // Activate retry if initial sync fails
 toast({
        title: "Error de Sincronización",
 description: "Fallo al sincronizar datos después de pausar. Reintentos automáticos activados.",
 variant: "destructive"
      }); // Use functional update for toast
  } // Close the catch block with its curly brace
 };

  const handleResumeTracking = () => {
 if (!workday) return;
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
 currentPause.endLocation = sanitizeLocationPoint(currentLocation); // sanitizeLocationPoint returns LocationPoint | undefined
 currentPause.isSynced = false; // Mark the updated pause as unsynced
 }
 return {
 ...prev,
 status: 'tracking',
 pauseIntervals: updatedPauses, // Ensure updatedPauses is returned
 // Existing pauses that were already ended and potentially synced are spread by ...prev
 };
    });
 recordEvent('SESSION_RESUME', currentLocation); // recordEvent expects LocationPoint | null | undefined, currentLocation is LocationPoint | null
 toast({ title: "Seguimiento Reanudado", description: "¡Bienvenido de nuevo! El seguimiento está activo." });
 setIsLoading(false); // This should be set to false regardless of sync outcome
 setSyncStatus('syncing'); // Set status to syncing before sync attempt
 try {
      // Trigger sync after resuming
      syncLocalDataToSupabase();
      setSyncStatus('success');
 toast({ // Use functional update for toast
        title: "Sincronización Exitosa",
        description: "Datos sincronizados con la nube después de reanudar."
      });
 } catch (error) {
      console.error("Error triggering sync after resuming:", error);
 setSyncStatus('error');
 toast({ title: "Error de Sincronización", description: "Fallo al sincronizar datos después de reanudar. Reintentos automáticos activados.", variant: "destructive" });
 setSyncRetryActive(true); // Activate retry if sync fails
    }
  }; // Closing brace for handleResumeTracking

  const handleEndDay = async () => {
    if (!workday) {
        toast({ title: "Error", description: "No se puede finalizar el día sin una jornada activa.", variant: "destructive" });
        return;
    }
    const activeJob = workday.jobs.find(j => j.id === workday.currentJobId && j.status === 'active');

    if (activeJob) {
 setJobToSummarizeId(activeJob.id);
 setJobModalMode('summary');
 setCurrentJobFormData({ description: activeJob.description || '', summary: '' });
 setIsJobModalOpen(true);
 recordEvent('JOB_COMPLETION_PROMPT', currentLocation, activeJob.id, "Prompt al finalizar el día");
      return; // Stop here, the process will continue after the job form submit
    }

 // If no active job, proceed directly to initiating the end day process
    // Call initiateEndDayProcess with the current state of the workday.
    // This is safe because initiateEndDayProcess will make a copy.
    // The state updates (like setting status to 'ended') will happen inside finalizeWorkdayAndSave.
    console.log("No active job found. Initiating end day process directly.");
    // Ensure we are passing the current workday state
    if (workday) { // Check if workday is still valid
      initiateEndDayProcess(workday, toast, setIsLoading);
    } else {
       console.error("Workday became null unexpectedly before initiateEndDayProcess could be called.");
       toast({ title: "Error Interno", description: "Estado de jornada perdido al intentar finalizar.", variant: "destructive" });
    }
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
      startLocation: safeCurrentLocation, // sanitizeLocationPoint returns LocationPoint | undefined, matches type
      status: 'active' as 'active' | 'completed', // Explicitly cast to literal type
      isSynced: false,
    };
 setWorkday(prev => prev ? ({
      ...prev, // Spread previous state
 jobs: [...prev.jobs, newJob],
 currentJobId: newJob.id,
    }) : null);
 recordEvent('JOB_START', safeCurrentLocation, newJob.id, `Nuevo trabajo iniciado: ${newJob.description}`); // recordEvent accepts LocationPoint | null | undefined
 toast({ title: "Nuevo Trabajo Iniciado", description: `Trabajo: "${currentJobFormData.description}"` }); // Add description to toast
 setIsJobModalOpen(false);
 setSyncStatus('syncing'); // Set status to syncing before sync
 try {
 syncLocalDataToSupabase(); // Trigger sync after starting a new job
 setSyncStatus('success'); // Set status to success on successful sync
 toast({
        title: "Sincronización Exitosa",
        description: "Datos sincronizados con la nube después de iniciar un trabajo."
      });
 } catch (error) {
 console.error("Error triggering sync after starting new job:", error);
 setSyncStatus('error'); // Set status to error on failure
 toast({ title: "Error de Sincronización", description: "Fallo al sincronizar datos después de iniciar un trabajo. Reintentos automáticos activados.", variant: "destructive" });
 console.error("Error triggering sync after starting new job:", error);
 setSyncRetryActive(true); // Activate retry if initial sync fails
 }
    setJobToSummarizeId(null); // Reset jobToSummarizeId after handling new job submit
  } else if (jobModalMode === 'summary' && jobToSummarizeId) {
    if (!safeCurrentLocation) {
      return;
    }

    // This block is for job completion, not new job creation. The newJob object definition was misplaced.
 console.log(jobToSummarizeId);

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
 console.log('Workday before update:', workday);
    const jobBeforeCompletion = workday.jobs[jobToUpdateIndex];
    // 1. Immediately update local state to mark job as completed with user summary
 setWorkday(prev => {
 if (!prev) return null;
 const updatedJobs = [...prev.jobs];
 updatedJobs[jobToUpdateIndex] = { // Update the specific job object in the array copy
 ...jobBeforeCompletion, // Use data before AI call
 summary: currentJobFormData.summary || '', // Ensure user summary is saved as string
 status: 'completed', // Set status to completed
 endTime: Date.now(), // Ensure endTime is a number
 endLocation: safeCurrentLocation, // Ensure endLocation is undefined if geolocation is not available or sanitize returned undefined
 isSynced: false, // Mark the updated job as unsynced
 };

 console.log('Updated jobs before setting state:', updatedJobs);
 return {
        ...prev,
 jobs: updatedJobs,
 currentJobId: null, // No current job after completion, explicitly set to null
 };
    });

    // Record the job completion event immediately after local update
 recordEvent('JOB_COMPLETED', safeCurrentLocation, jobBeforeCompletion.id, `Trabajo completado. Usuario: ${currentJobFormData.summary}`); // recordEvent expects LocationPoint | null | undefined
 toast({ title: "Trabajo Completado", description: `Resumen de usuario guardado para el trabajo.` });

    // Close modal and reset form immediately (moved this outside the try/catch for sync)
    setIsJobModalOpen(false);
    try {
 setSyncStatus('syncing'); // Set status to syncing before sync
 syncLocalDataToSupabase(); // Trigger sync after completing a job (user summary saved)
 setSyncStatus('success'); // Set status to success on successful sync
 toast({
        title: "Sincronización Exitosa",
        description: "Datos sincronizados con la nube después de completar un trabajo."
      });
 } catch (error) {
 setSyncStatus('error');
 toast({ title: "Error de Sincronización", description: "Fallo al sincronizar datos después de completar un trabajo. Reintentos automáticos activados.", variant: "destructive" });
 setSyncRetryActive(true); // Keep existing retry activation
 }

 setCurrentJobFormData({ description: '', summary: '' }); // Reset form data

    // 2. Initiate AI summarization asynchronously (fire-and-forget)
    setAiLoading(prev => ({ ...prev, summarize: true })); // Indicate AI is working
    // Use the user's summary for the AI prompt
 await summarizeJobDescription({ jobDescription: currentJobFormData.summary || 'N/A' }) // Provide default if summary is empty
      .then(async aiRes => {
        // `aiRes` contains the AI summary
        console.log('AI Summarization result:', aiRes);
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
 setSyncStatus('syncing'); // Set status to syncing before sync
 await syncLocalDataToSupabase(); // Trigger sync after AI summary is added
 setSyncStatus('success'); // Set status to success on successful sync
 toast({ title: "Resumen de IA Disponible", description: "Se añadió el resumen de IA al trabajo." }); // Keep AI success toast
      }) // Close the then block for summarizeJobDescription
      .catch(err => {
 console.error("AI Error (summarizeJobDescription):", err); // Keep existing error handling
 toast({
 title: "Error de IA",
 description: "No se pudo generar el resumen de IA para este trabajo. Puedes añadirlo manualmente más tarde.",
 variant: "destructive"
 });
 setAiLoading(prev => ({ ...prev, summarize: false })); // Ensure AI loading is turned off on error
 toast({ title: "Error de IA", description: "No se pudo generar el resumen de IA para este trabajo.", variant: "destructive" });
        // The local state already has the user's summary, so no change needed there.
      })
      .finally(() => { // Ensure proper closing brace for .finally()
        // 4. Check if End Day action was pending and proceed
        console.log("AI summarize finally block: Pending end day action detected. Checking latest state...");
        // We need to check the *current* state of the workday in the callback. // Removed duplicate console.log
 setWorkday(latestWorkdayState => { // Using functional update to get latest state
 if (!latestWorkdayState) return latestWorkdayState; // Return current state if null or undefined
          const jobIsLocallyCompleted = latestWorkdayState.jobs.find(j => j.id === jobToSummarizeId)?.status === 'completed'; // Check the latest state
          if (jobIsLocallyCompleted) { // Only proceed if job is locally completed
            initiateEndDayProcess(latestWorkdayState, toast, setIsLoading);
          }
 return latestWorkdayState; // Always return the latest state
 }); // Close the setWorkday functional update call
 setAiLoading(prev => ({ ...prev, summarize: false })); // Ensure AI loading is off regardless of pendingEndDayAction
      }); // Close the summarizeJobDescription then/catch/finally block
    setJobToSummarizeId(null); // Reset jobToSummarizeId after processing completion
  }
};
 // MARK: Function Definitions
  const handleManualCompleteJob = () => {
    if (!currentJob) return;
    setJobModalMode('summary');
    setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
    setIsJobModalOpen(true);
 recordEvent('USER_ACTION', currentLocation, currentJob.id, "Modal de completar trabajo abierto manualmente");
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

  // Main render function for the component
  return (
    <div className="flex justify-center items-center min-h-screen p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <User className="h-6 w-6" />
            <span>{technicianName}</span> {/* Ensure technicianName is used here */}
          </CardTitle>
          <CardDescription>
            Sistema de Seguimiento Técnico
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col space-y-4"> {/* Changed to flex-col for better layout control */}
 <CurrentStatusDisplay
 workday={workday}
 endOfDaySummary={endOfDaySummary}
 isSavingToCloud={isSavingToCloud}
 /> {/* Ensure this is rendered */}

          {workday?.status !== 'ended' && ( // Hide location and time info after day ends
            <>
              <LocationInfo
                location={currentLocation}
                error={geolocationError || undefined}
                label="Ubicación Actual"
                getGoogleMapsLink={(loc) => `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`}
              />
              {geolocationError && (
 <div className="text-sm text-red-600 flex items-start space-x-2">
 <Ban className="h-5 w-5 flex-shrink-0" />
 <span><strong>Geolocalización Deshabilitada:</strong> Para iniciar el seguimiento, la aplicación necesita acceder a tu ubicación. Por favor, habilita los permisos de ubicación para esta app en la configuración de tu dispositivo.</span>
 </div>
 )}
              {workday?.status !== 'idle' && ( // Show elapsed time and current job if tracking or paused
                <>
                  <div className="flex items-center space-x-2 text-sm"><Clock className="h-5 w-5 text-blue-500" /><span>Tiempo Transcurrido: {formatTime(elapsedTime)}</span></div>
                  {currentJob && (<div className="flex items-center space-x-2 text-sm"><Briefcase className="h-5 w-5 text-green-500" /><span>Trabajo Actual: {currentJob.description}</span></div>)}
                </>
              )}
            </>
          )} {/* Closing tag for workday?.status !== 'ended' conditional rendering */}
          {workday?.status === 'idle' && !currentLocation && ( // Show waiting for location message only in idle state
            <div className="text-sm text-orange-600 flex items-center space-x-2">
              <MapPinned className="h-4 w-4 flex-shrink-0" /> <span>Esperando ubicación para iniciar seguimiento...</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex-col space-y-4">
          <ActionButton /> {/* Ensure ActionButton is rendered */}

          {/* Job Management Buttons (Show only when tracking and not loading/saving) */}
          {workday?.status === 'tracking' && !isLoading && !isSavingToCloud && (
            <div className="flex space-x-2 w-full">
              <Button onClick={handleManualStartNewJob} variant="secondary" size="sm" className="flex-1">
                <Briefcase className="mr-1 h-4 w-4" /> Nuevo Trabajo
              </Button>
              {currentJob && (
                <Button onClick={handleManualCompleteJob} variant="secondary" size="sm" className="flex-1">
                  <CheckCircle className="mr-1 h-4 w-4" /> Completar Trabajo
                </Button>
              )}
            </div>
          )}

          {/* Sync Status Indicator */}
          {syncStatus !== 'idle' && (
            <div className={`flex items-center space-x-2 text-sm ${syncStatus === 'error' ? 'text-red-600' : syncStatus === 'success' ? 'text-green-600' : 'text-blue-600'}`}>
              {syncStatus === 'syncing' && <Loader2 className="h-4 w-4 animate-spin" />}
              {syncStatus === 'success' && <CloudUpload className="h-4 w-4" />}
              {syncStatus === 'error' && <AlertTriangle className="h-4 w-4" />}
              <span>
                {syncStatus === 'syncing' && 'Sincronizando...'}
                {syncStatus === 'success' && 'Sincronizado con la nube.'}
                {syncStatus === 'error' && 'Error de sincronización. Reintentando.'}
              </span>
            </div>
          )}

          {/* AI Loading Indicators */}
          {(aiLoading.newJob || aiLoading.jobCompletion || aiLoading.summarize) && (
            <div className="flex items-center space-x-2 text-sm text-purple-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {aiLoading.newJob && 'IA pensando (nuevo trabajo)...'}
                {aiLoading.jobCompletion && 'IA pensando (finalizar trabajo)...'}
                {aiLoading.summarize && 'IA resumiendo trabajo...'}
              </span>
            </div>
          )}

          {/* Link to History */}
          <Link href="/history" passHref legacyBehavior>
            <Button variant="ghost" className="w-full">
              <History className="mr-2 h-4 w-4" /> Ver Historial
            </Button>
          </Link>
        </CardFooter>
      </Card>

      {/* Job Modal (New Job or Summarize Job) */}
      <Dialog open={isJobModalOpen} onOpenChange={setIsJobModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{jobModalMode === 'new' ? 'Nuevo Trabajo' : 'Completar/Resumir Trabajo'}</DialogTitle>
            <DialogDescription>
              {jobModalMode === 'new' ? 'Describe el nuevo trabajo que vas a comenzar.' : 'Describe el trabajo completado o añade un resumen.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="job-description">Descripción del Trabajo</Label>
              <Textarea
                id="job-description"
                placeholder={jobModalMode === 'new' ? 'Mantenimiento preventivo en cliente XYZ...' : 'Se realizó limpieza y ajuste de componentes.'}
                value={currentJobFormData.description}
                onChange={(e) => setCurrentJobFormData({ ...currentJobFormData, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit" onClick={() => handleJobFormSubmit(jobToSummarizeId)}>{jobModalMode === 'new' ? 'Iniciar Trabajo' : 'Guardar Resumen'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

