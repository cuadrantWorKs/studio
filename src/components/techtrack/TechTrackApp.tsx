
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
  syncLocalDataToSupabase
} from '@/lib/techtrack/sync';
import {
  initiateEndDayProcess
} from '@/lib/techtrack/workday';
import { Play, Pause, StopCircle, Briefcase, Clock, CheckCircle, AlertTriangle,
  Loader2, History, CloudUpload, User, Ban, MapPinned } from 'lucide-react';

import { haversineDistance } from '@/lib/techtrack/geometry';
import { summarizeJobDescription } from '@/ai/flows/summarize-job-description';
import { db as localDb } from '@/db';
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay'; // Importing WorkdaySummaryDisplay
import { decidePromptForNewJob } from '@/ai/flows/decide-prompt-for-new-job';
import { decidePromptForJobCompletion } from '@/ai/flows/decide-prompt-for-job-completion';
import { Label } from '@/components/ui/label'; // Import the Label component from your UI library
import { formatTime } from '@/lib/utils';
import LocationInfo from './LocationInfo';
import type {
  LocationPoint, Job, TrackingEvent, Workday, PauseInterval,
 GeolocationError, WorkdaySummaryContext, TrackingEventType
} from '@/lib/techtrack/types';



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

// Placeholder for CurrentStatusDisplay
const CurrentStatusDisplay: React.FC<CurrentStatusDisplayProps> = ({ workday, endOfDaySummary, isSavingToCloud }) => {
  if (!workday) {
    return <div>Cargando estado...</div>;
  }
  return (
    <div>
      <div>Estado de la Jornada: {workday.status}</div>
      {endOfDaySummary && (
        <div>
          <h3>Resumen del Día</h3>
          <p>{endOfDaySummary.summary}</p>
        </div>
      )}
    </div>
  );
};

function TechTrackApp({ technicianName }: TechTrackAppProps): JSX.Element {
  const [workday, setWorkday] = useState<Workday | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null); // Keep this for user feedback

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [jobModalMode, setJobModalMode] = useState<'new' | 'summary'>('new');
  const [currentJobFormData, setCurrentJobFormData] = useState({ description: '', summary: '' });
  const [endOfDaySummary, setEndOfDaySummary] = useState<WorkdaySummaryContext | null>(null);

  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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
          (position: GeolocationPosition) => { // Explicitly type the position parameter
            const newLocation: LocationPoint = {
              latitude: position.coords.latitude,
  longitude: position.coords.longitude,
 timestamp: position.timestamp, // Keep as number (epoch milliseconds)
 accuracy: position.coords.accuracy ?? undefined,
 };
            setCurrentLocation(sanitizeLocationPoint(newLocation) ?? null); // sanitizeLocationPoint returns LocationPoint or undefined, ensure setCurrentLocation accepts LocationPoint | null
 setGeolocationError(null); // Clear any previous error on success
          },
          (error) => { // Geolocation error handler
 console.error('Geolocation error:', error); // Keep existing error log
            setGeolocationError({ code: error.code, message: error.message });
            toast({
 title: "Error de Geolocalización",
 description: `No se pudo obtener tu ubicación: ${error.message}. Asegúrate de que los permisos estén habilitados.`, // Fixed unescaped entities
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
 } // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, []); // toast is a stable reference from useToast

  const recordEvent = useCallback((type: TrackingEvent['type'], locationParam: LocationPoint | null | undefined, jobId?: string, details?: string) => {
 setWorkday(prev => { // Use functional update pattern to ensure latest state
      if (!prev) return null; // Return null if previous state is null
      const eventLocation = sanitizeLocationPoint(locationParam === undefined ? currentLocation : locationParam); // Sanitize the location for the event, returns LocationPoint | undefined
      const tempEventLiteral: Omit<TrackingEvent, 'workdayId' | 'isSynced'> = { // Define the literal structure first
        id: crypto.randomUUID(),
        type,
        timestamp: Date.now(), // Ensure timestamp is a number
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
        if (!workday || !workday.startTime) return; // Add guard clauses
        const now = Date.now();
        let activeTime = now - workday.startTime;
        workday.pauseIntervals?.forEach(p => { // Use optional chaining for pauseIntervals
          if (p.endTime && p.startTime) {
            activeTime -= (p.endTime - p.startTime);
          }
        });
        setElapsedTime(activeTime < 0 ? 0 : activeTime);
      }, 1000);
    } else if ((workday?.status === 'paused' || workday?.status === 'ended') && workday?.startTime) { // Add checks for workday and startTime
        const baseTime = (workday.endTime || workday.pauseIntervals?.find(p => !p.endTime)?.startTime || Date.now()); // Use optional chaining
        let activeTime = (baseTime) - (workday.startTime || baseTime) ;
         workday.pauseIntervals?.forEach(p => { // Use optional chaining
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
 setWorkday(prev => prev ? ({ ...prev, locationHistory: [...(prev.locationHistory || []), safeCurrentLocation] }) : null); // Add sanitized location to history, handle potential null locationHistory
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
          toast({ // Show toast before attempting retry
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
          setSyncStatus('error'); // Set status to error on retry failure
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
      
      const lastMovementTime = workday.locationHistory?.[workday.locationHistory.length -1]?.timestamp || workday.startTime; // Use optional chaining
      if (Date.now() - (lastMovementTime || Date.now()) > STOP_DETECT_DURATION_MS) {
        const hasBeenPromptedRecently = (workday.lastNewJobPromptTime || 0) > 0 && (Date.now() - (workday.lastNewJobPromptTime || 0) < RECENT_PROMPT_THRESHOLD_MS); // Ensure lastNewJobPromptTime is treated as a number
 // Set AI loading state before the AI call
 setAiLoading(prev => ({...prev, newJob: true}));
 decidePromptForNewJob({ hasBeenPromptedRecently: !!hasBeenPromptedRecently, timeStoppedInMinutes: Math.round(STOP_DETECT_DURATION_MS / (60*1000)) })
          .then(res => {
            if (res.shouldPrompt) {
              toast({ title: "¿Nuevo Trabajo?", description: "Parece que te has detenido. ¿Comenzando un nuevo trabajo? IA: " + res.reason });
 setJobModalMode('new' as 'new' | 'summary'); // Explicitly cast
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
 if (workday?.status === 'tracking' && currentJob && currentJob.status === 'active' && currentLocation) {
        if(aiLoading.jobCompletion || isJobModalOpen) return;

        const jobStartLocation = currentJob.startLocation; // Already sanitized LocationPoint
        if (!jobStartLocation) return; // Should not happen if job was created correctly

        const distance = haversineDistance(jobStartLocation, currentLocation); // currentLocation is sanitized
        if (distance > MOVEMENT_THRESHOLD_METERS) {
          const lastPromptTime = workday.lastJobCompletionPromptTime;
 console.log("Checking job completion prompt logic...");
 setAiLoading(prev => ({ ...prev, jobCompletion: true })); // Set AI loading state before the call
          decidePromptForJobCompletion({ distanceMovedMeters: distance, lastJobPromptedTimestamp: lastPromptTime ?? 0 }) // Pass 0 if lastPromptTime is null/undefined
            .then(res => {
 if (res.shouldPrompt) {
                toast({ title: "¿Actualizar Trabajo?", description: `Te has movido significativamente. ¿Completaste el trabajo: ${currentJob.description}? IA: ${res.reason}` });

 setJobModalMode('summary' as 'new' | 'summary'); // Explicitly cast
                setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
                setIsJobModalOpen(true);
                recordEvent('JOB_COMPLETION_PROMPT', currentLocation, currentJob.id, `IA: ${res.reason}`); // recordEvent accepts LocationPoint | null | undefined
              }
              setWorkday(prev => prev ? ({ ...prev, lastJobCompletionPromptTime: Date.now() }) : null); // eslint-disable-next-line react-hooks/exhaustive-deps
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
 if (!currentLocation) { // Use currentLocation state directly to check if we ever got a location
      toast({ title: "Esperando Ubicación", description: "Aún no se ha obtenido tu ubicación. Iniciando jornada sin coordenadas iniciales.", variant: "default" });
    }
    setIsLoading(true);
    setGeolocationError(null); // Clear any previous location errors on start
    setEndOfDaySummary(null);
    const startTime = Date.now(); // Ensure startTime is a number (epoch milliseconds)
    const workdayId = crypto.randomUUID(); // Declare workdayId

    // Declare with let so we can reference it during construction
    const newWorkday: Workday = {
      id: workdayId,
      technicianId: technicianName,
 userId: technicianName, // Ensure userId is also set
      date: getCurrentFormattedDate(),
      startTime: startTime, // Assign the number directly
 startLocation: safeCurrentLocation, // Use the sanitized location (LocationPoint | undefined)
 status: 'tracking', // Always set status to tracking
 locationHistory: safeCurrentLocation ? [safeCurrentLocation] : [],
      events: [{ // Initialize events array
        id: crypto.randomUUID(),
        type: 'SESSION_START' as TrackingEventType, // Ensure type is of type TrackingEventType
        // Explicitly cast timestamp to number as we know it's Date.now()
        timestamp: startTime,
        location: safeCurrentLocation, // sanitizeLocationPoint returns LocationPoint | undefined, matches type
 details: `Sesión iniciada por ${technicianName}`,
        workdayId: workdayId,
        isSynced: false,
      }], // Removed explicit cast as literal type should match
      pauseIntervals: [],
      isSynced: false,
      jobs: [], // Initialize jobs array with correct type
 }; // Workday structure is now defined and matches types.ts

    // Guardamos local & estado, ensuring types for DB insertion
    // When adding to localDb (Dexie), ensure properties match the DbWorkday type
    // Explicitly construct the object with all Workday properties and correct types for localDb
 const workdayForDb: Workday = {
      technicianId: newWorkday.technicianId,
 userId: newWorkday.userId,
      date: newWorkday.date,
      startTime: newWorkday.startTime,
 startLocation: newWorkday.startLocation ?? null, // Convert undefined to null for Dexie (DbWorkday type)
      endTime: newWorkday.endTime ?? null, // Convert undefined to null for Dexie (DbWorkday type)
 endLocation: newWorkday.endLocation ?? null, // Convert undefined to null
 status: newWorkday.status,
      locationHistory: newWorkday.locationHistory,
 jobs: newWorkday.jobs, // jobs property is a JSONB field in the DB
      events: newWorkday.events, // events property
      pauseIntervals: newWorkday.pauseIntervals,
 isSynced: newWorkday.isSynced, // Ensure isSynced is included
 id: newWorkday.id, // Ensure ID is included for Dexie
 } as Workday; // Explicitly cast to Workday
    await localDb.workdays.add(workdayForDb);
    setWorkday(newWorkday);
    toast({ title: "Seguimiento Iniciado", description: "Tu jornada laboral ha comenzado." });

    // First AI prompt after starting tracking
    setTimeout(() => {
 setJobModalMode('new' as 'new' | 'summary'); // Explicitly cast
        setCurrentJobFormData({ description: '', summary: '' });
        setIsJobModalOpen(true);
        // Add the recordEvent call here as planned
        recordEvent('NEW_JOB_PROMPT', safeCurrentLocation, undefined, "Prompt inicial después del inicio de sesión");
    }, 100);

    setIsLoading(false);
 setSyncStatus('syncing'); // Set status to syncing before initial sync
    try {
        await syncLocalDataToSupabase(); // Trigger sync after starting workday
        setSyncStatus('success');
 toast({
          title: "Sincronización Inicial Exitosa",
          description: "La jornada ha comenzado y se ha sincronizado inicialmente con la nube."
        });
    } catch (error) { // Add the error parameter to the catch block
 console.error("Error triggering sync after starting workday:", error); // Log the actual error in catch block
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
 startTime: now, // Ensure startTime is a number
 startLocation: sanitizeLocationPoint(currentLocation), // sanitizeLocationPoint returns LocationPoint | undefined, matches type
 isSynced: false,
    };
 setWorkday(prev => prev ? ({ // Use functional update
      ...prev,
      status: 'paused',
      // Add the new pause interval to the array
      pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
    }) : null);
 recordEvent('SESSION_PAUSE', currentLocation); // Pass currentLocation which is LocationPoint | null
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
 console.error("Error triggering sync after pausing:", error); // Log the actual error in catch block
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
 setWorkday(prev => { // Use functional update to get the latest state
 if (!prev) return null;
 const updatedPauses = [...(prev.pauseIntervals || [])]; // Ensure pauses is an array, handle potential null
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
    }); // Close the setWorkday functional update
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
 setSyncStatus('error'); // Set status to error on sync failure after logging
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
  if (!workday || (jobModalMode === 'summary' && !jobToSummarizeId)) {
 return;
  } // Check if workday is null or if in summary mode without a jobToSummarizeId
  const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
 
  // Common logic for setting loading state during save operations
  setIsSavingToCloud(true);
 
  if (jobModalMode === 'new') {
    if (!safeCurrentLocation) {
 toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin una ubicación válida.", variant: "destructive" }); // Show toast
      return; // Return early if location is not available
    }
    const newJob: Job = { // Define the newJob object here with proper type annotation
      id: crypto.randomUUID(), // Assign a new UUID
      description: currentJobFormData.description,
      startTime: Date.now(), // Ensure startTime is a number
 workdayId: workday.id, // Link to the current workday
      startLocation: safeCurrentLocation, // sanitizeLocationPoint returns LocationPoint | undefined
      status: 'active' as 'active' | 'completed', // Explicitly cast to literal type
      isSynced: false,
    };
 setWorkday(prev => prev ? ({ // Use functional update to get the latest state
      ...prev, // Spread previous state
 jobs: [...prev.jobs, newJob],
 currentJobId: newJob.id, // Ensure id is treated as string | null
    }) : null); // If prev is null, return null
 recordEvent('JOB_START', safeCurrentLocation, newJob.id, `Nuevo trabajo iniciado: ${newJob.description}`); // Record job start event
 toast({ title: "Nuevo Trabajo Iniciado", description: `Trabajo: "${currentJobFormData.description}"` }); // Add description to toast message
 setIsJobModalOpen(false);
 setSyncStatus('syncing'); // Set status to syncing before sync -- This is redundant with setIsSavingToCloud(true) in this case.
 try {
 syncLocalDataToSupabase(); // Trigger sync after starting a new job
 setSyncStatus('success'); // Set status to success on successful sync
 toast({
        title: "Sincronización Exitosa",
        description: "Datos sincronizados con la nube después de iniciar un trabajo."
      });
 } catch (error) { // Add the error parameter to the catch block.
 console.error("Error triggering sync after starting new job:", error); // Log the actual error in catch block
 setSyncStatus('error'); // Set status to error on failure
 toast({ title: "Error de Sincronización", description: "Fallo al sincronizar datos después de iniciar un trabajo. Reintentos automáticos activados.", variant: "destructive" }); // Add toast on sync failure
 } finally {
 setIsSavingToCloud(false); // Ensure saving state is turned off regardless of sync outcome or error
 }
    setJobToSummarizeId(null); // Reset jobToSummarizeId after handling new job submit
  } else if (jobModalMode === 'summary' && jobToSummarizeId) {
    // This block is for job completion/summarization
    console.log(jobToSummarizeId);

 // --- Modified Logic for Job Completion (Non-blocking AI) ---
 console.log("Handling job completion form submit for job ID:", jobToSummarizeId);
 const jobToUpdateIndex = workday.jobs.findIndex(j => j.id === jobToSummarizeId); // Find the index of the job to update
 if (jobToUpdateIndex === -1) {
 console.error(`Attempted to complete non-existent job with ID: ${jobToSummarizeId}`);
 toast({ title: "Error Interno", description: "No se encontró el trabajo para completar.", variant: "destructive" }); // Add toast for user feedback

 setCurrentJobFormData({ description: '', summary: '' });
 setJobToSummarizeId(null);
 return;
 }
 console.log('Workday before update:', workday);
    const jobBeforeCompletion = workday.jobs[jobToUpdateIndex];
    // 1. Immediately update local state to mark job as completed with user summary
 setWorkday(prev => {
 if (!prev) return null;
 const updatedJobs = [...prev.jobs];
 updatedJobs[jobToUpdateIndex] = { // Update the specific job object in the array copy using the correct index
 ...jobBeforeCompletion, // Use data before AI call
 summary: currentJobFormData.summary, // Ensure user summary is saved as string
 status: 'completed', // Set status to completed explicitly
 endTime: Date.now(), // Ensure endTime is a number
 endLocation: safeCurrentLocation, // Ensure endLocation is undefined if geolocation is not available or sanitize returned undefined
            isSynced: false, // Mark the updated job as unsynced
 };

 console.log('Updated jobs before setting state:', updatedJobs); // Log the state before setting
 return {
        ...prev,
 jobs: updatedJobs,
 currentJobId: null, // No current job after completion, explicitly set to null
 };
    });

    // Record the job completion event immediately after local update
 recordEvent('JOB_COMPLETED', safeCurrentLocation, jobBeforeCompletion.id, `Trabajo completado. Usuario: ${currentJobFormData.summary}`); // recordEvent expects LocationPoint | null | undefined
 toast({ title: "Trabajo Completado", description: `Resumen de usuario guardado para el trabajo.` }); // Show toast for user summary saved

    // Close modal and reset form immediately (moved this outside the try/catch for sync)
    setIsJobModalOpen(false);
    try {
 setSyncStatus('syncing'); // Set status to syncing before sync
 // Await the sync operation to ensure local state is saved before potentially ending the day
 await syncLocalDataToSupabase(); // Trigger sync after completing a job (user summary saved)
 setSyncStatus('success'); // Set status to success on successful sync
 toast({
        title: "Sincronización Exitosa",
        description: "Datos sincronizados con la nube después de completar un trabajo."
      });
 } catch (error) { // Add the error parameter to the catch block
 console.error("Error triggering sync after completing job:", error); // Log the actual error in catch block
 toast({ title: "Error de Sincronización", description: "Fallo al sincronizar datos después de completar un trabajo. Reintentos automáticos activados.", variant: "destructive" });
 setSyncRetryActive(true); // Keep existing retry activation
 } finally {
 // This will be set to false after the *initial* save attempt for the job summary.
 // AI summarization will have its own loading state.
 }

 setCurrentJobFormData({ description: '', summary: '' }); // Reset form data

    // 2. Initiate AI summarization asynchronously (fire-and-forget)
 setAiLoading(prev => ({ ...prev, summarize: true })); // Indicate AI is working by setting state
    // Use the job description and user's summary for the AI prompt
 await summarizeJobDescription({ jobDescription: jobBeforeCompletion.description || 'N/A' }) // Provide default if summary is empty
      .then(async aiRes => { // Use async in the then block to await inner promises
        console.log('AI Summarization result:', aiRes);
        console.log("AI Summarization successful:", aiRes.summary);
        // Update local state with AI summary opportunistically
        setWorkday(prev => {
          if (!prev) return null; // Return null if previous state is null
          const jobIndexForAI = prev.jobs.findIndex(j => j.id === jobToSummarizeId); // Find the index using prev state
          if (jobIndexForAI === -1) return prev; // Job not found
          const updatedJobs = [...prev.jobs]; // Create a copy of the jobs array from prev state
          updatedJobs[jobIndexForAI] = {
 ...updatedJobs[jobIndexForAI], // Spread the existing job properties
            aiSummary: aiRes.summary, // Add or update aiSummary
            // Ensure id is kept as string and status as literal type
            id: updatedJobs[jobIndexForAI].id,
          };
          updatedJobs[jobIndexForAI].isSynced = false; // Mark job as unsynced again with AI summary
          return { ...prev, jobs: updatedJobs };
        });
        // Optionally show a toast for successful AI summary update
 setSyncStatus('syncing'); // Set status to syncing before sync
 await syncLocalDataToSupabase(); // Trigger sync after AI summary is added
 setSyncStatus('success'); // Set status to success on successful sync
 toast({ title: "Resumen de IA Disponible", description: "Se añadió el resumen de IA al trabajo." }); // Show toast for AI summary added
      }) // Close the then block for summarizeJobDescription
      .catch(err => {
 console.error("AI Error (summarizeJobDescription):", err); // Keep existing error handling
 toast({ // Show error toast for AI summarization failure
 title: "Error de IA",
 description: "No se pudo generar el resumen de IA para este trabajo. Puedes añadirlo manualmente más tarde.",
 variant: "destructive"
 });
        // The local state already has the user's summary, so no change needed there.
      })
      .finally(() => { // Ensure proper closing brace for .finally()
        // 4. Check if End Day action was pending and proceed
        console.log("AI summarize finally block: Pending end day action detected. Checking latest state...");
 setWorkday(latestWorkdayState => { // Using functional update to get latest state
 if (!latestWorkdayState) return null; // Return null if latest state is null or undefined
 // Fix: Check if the job is locally completed before initiating the end day process.
          const jobIsLocallyCompleted = latestWorkdayState.jobs.find(j => j.id === jobToSummarizeId)?.status === 'completed'; // Check the latest state
 if (jobIsLocallyCompleted) { // Only proceed if job is locally completed
            initiateEndDayProcess(latestWorkdayState, toast, setIsLoading);
          }
 return latestWorkdayState; // Always return the latest state
 }); // Close the setWorkday functional update call
 setAiLoading(prev => ({ ...prev, summarize: false })); // Ensure AI loading is off regardless of pendingEndDayAction
 }); // Close the summarizeJobDescription then/catch/finally block
    setJobToSummarizeId(null); // Reset jobToSummarizeId after processing completion
}; // Closing brace for handleJobFormSubmit
 // MARK: Function Definitions
    setJobModalMode('summary');
    // Only proceed if currentJob is not null or undefined
 if (currentJob) {
 setCurrentJobFormData({ description: currentJob.description || '', summary: '' }); // Ensure description is string
 setIsJobModalOpen(true);
 recordEvent('USER_ACTION', currentLocation, currentJob.id, "Modal de completar trabajo abierto manualmente");
 } else {
 toast({
 title: "Error",
 description: "No hay un trabajo activo para completar manualmente.",
 variant: "destructive",
      });
    }
  };

  const handleManualCompleteJob = () => {
    // Only proceed if currentJob is not null or undefined
    if (currentJob) {
      setJobToSummarizeId(currentJob.id); // Ensure jobToSummarizeId is set to the active job's ID
      setJobModalMode('summary' as 'new' | 'summary'); // Explicitly cast
      setCurrentJobFormData({ description: currentJob.description || '', summary: '' }); // Ensure description is string
      setIsJobModalOpen(true);
      recordEvent('USER_ACTION', currentLocation, currentJob.id, "Modal de completar trabajo abierto manualmente");
    } else {
      toast({
        title: "Error",
        description: "No hay un trabajo activo para completar manualmente.",
        variant: "destructive",
      });
    }
  };

 const handleManualStartNewJob = () => {
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
    if (!safeCurrentLocation) {
      toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin una ubicación válida.", variant: "destructive" });
      return;
    }
    setJobModalMode('new' as 'new' | 'summary'); // Explicitly cast to literal type
    setCurrentJobFormData({ description: '', summary: '' }); // Set initial form data
    setIsJobModalOpen(true); // Open the modal
 setJobToSummarizeId(null); // Ensure jobToSummarizeId is null when starting a new job action
    recordEvent('USER_ACTION', safeCurrentLocation, undefined, "Modal de nuevo trabajo abierto manualmente"); // Record the event
  };

  const ActionButton = () => {
    const commonDisabled = isLoading || isSavingToCloud || aiLoading.newJob || aiLoading.jobCompletion || aiLoading.summarize; // Disable buttons while loading, saving, or AI is active

    if (!workday || workday.status === 'idle') {
      // Render start button if no workday exists or workday status is idle
 return (
        <Button
          onClick={() => handleStartTracking()}
          disabled={commonDisabled || !currentLocation} // Disable if loading/saving or no location
 variant="default" // Primary button for starting
 className="w-full"
          size="lg"
        >
          {commonDisabled ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" /> // Play icon for starting
          )}
          Iniciar Seguimiento
        </Button>
      );
    }

    // Display button based on workday status
    switch (workday.status) {
      case 'tracking':
        return (
          <div className="flex space-x-2 w-full">
            <Button onClick={handlePauseTracking} disabled={commonDisabled} variant="secondary" className="flex-1">
              {commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />}
 Pausar
            </Button>
            <Button onClick={handleEndDay} disabled={commonDisabled} variant="destructive" className="flex-1">
              {commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-4 w-4" />}
 Finalizar Día
            </Button>
          </div>
 );

 case 'paused':
        return (
          <div className="flex space-x-2 w-full"> {/* Use a div for spacing */}
            <Button onClick={handleResumeTracking} disabled={commonDisabled} variant="default" className="flex-1">
              {commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
 Reanudar
            </Button>
            {/* Add a spacer or another button here if needed */}
            <Button onClick={handleEndDay} disabled={commonDisabled} variant="destructive" className="flex-1">
              {commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-4 w-4" />}
 Finalizar Día
            </Button>
          </div>
 );
 case 'ended':
        return (
          <Button
            onClick={() => {
 // Reset state for a new day
                  setWorkday(null);
                  setElapsedTime(0);
                  setEndOfDaySummary(null);
 localStorage.removeItem(getLocalStorageKey()); // Clear local storage
 toast({ title: "Día Finalizado", description: "Puedes comenzar un nuevo día de seguimiento." });
                }}
 disabled={commonDisabled}
 variant="default" // Primary button for starting a new day
 className="w-full" // Make the button full width
 size="lg"
          >
            {commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />} {/* Use Play icon for starting new day */}
          Iniciar Nuevo Día
 </Button>
 );
    }

    return null;
  };


 return (
    <>
 <div className="flex justify-center items-center min-h-screen p-4"> {/* Container for Card, ensures centering */}
        <Card className="w-full max-w-md shadow-xl">
          {/* CardHeader and following sections are now correctly nested inside Card */}
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <User className="h-6 w-6" />
              <span>{technicianName}</span> {/* Ensure technicianName is used here */}
            </CardTitle>
            <CardDescription>
              Sistema de Seguimiento Técnico
            </CardDescription>
          </CardHeader>
          {workday?.status !== 'ended' && ( // Hide location and time info after day ends
            <> {/* Wrap multiple elements in a fragment */}
 <LocationInfo
                location={currentLocation}
                error={geolocationError || undefined}
                label="Ubicación Actual"
 getGoogleMapsLink={(loc: LocationPoint) => `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`}
              />
              {geolocationError && (
                <div className="text-sm text-red-600 flex items-start space-x-2">
                  <Ban className="h-5 w-5 flex-shrink-0" /> {/* Added icon for error */}
                  <span><strong>Geolocalización Deshabilitada:</strong> Para iniciar el seguimiento, la aplicación necesita acceder a tu ubicación. Por favor, habilita los permisos de ubicación para esta app en la configuración de tu dispositivo.</span> {/* Fixed unescaped entities */}
                </div>
              )}
              {workday?.status !== 'idle' && ( // Show elapsed time and current job if tracking or paused
                <> {/* Wrap multiple elements in a fragment */}
                  <div className="flex items-center space-x-2 text-sm"><Clock className="h-5 w-5 text-blue-500" /><span>Tiempo Transcurrido: {formatTime(elapsedTime)}</span></div>
                  {currentJob ? (
                    <div className="flex items-center space-x-2 text-sm">
 <Briefcase className="h-5 w-5 text-green-500" />
 <span>Trabajo Actual: {currentJob.description}</span>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
          {workday?.status === 'idle' && !currentLocation && ( // Show waiting for location message only in idle state
            <CardContent className="flex flex-col space-y-4"> {/* Changed to flex-col for better layout control */}
              <> {/* Wrap multiple elements in a fragment */}
                <CurrentStatusDisplay
                  workday={workday}
                  endOfDaySummary={endOfDaySummary}
                  isSavingToCloud={isSavingToCloud}
                />
                <div className="text-sm text-orange-600 flex items-center space-x-2">
                  <MapPinned className="h-4 w-4 flex-shrink-0" /> <span>Esperando ubicación para iniciar seguimiento...</span>
                </div>
              </>
            </CardContent>  
          )};
        
      

          <CardFooter className="flex-col space-y-4">
 <ActionButton />

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
              <div className={"flex items-center space-x-2 text-sm " + (syncStatus === 'error' ? 'text-red-600' : syncStatus === 'success' ? 'text-green-600' : 'text-blue-600')}>
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
      </div> {/* Closing div for centering container */}
    </>
  );
}