
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
import { MapPin, Play, Pause, StopCircle, Briefcase, Clock, CheckCircle, AlertTriangle, Loader2, History } from 'lucide-react';
import type { LocationPoint, Job, TrackingStatus, TrackingEvent, Workday, PauseInterval, GeolocationError, WorkdaySummaryContext } from '@/lib/techtrack/types';
import { haversineDistance } from '@/lib/techtrack/geometry';
import { summarizeJobDescription } from '@/ai/flows/summarize-job-description';
import { decidePromptForNewJob } from '@/ai/flows/decide-prompt-for-new-job';
import { decidePromptForJobCompletion } from '@/ai/flows/decide-prompt-for-job-completion';
import { formatTime } from '@/lib/utils';
import { calculateWorkdaySummary } from '@/lib/techtrack/summary';
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay';


const LOCATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STOP_DETECT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const MOVEMENT_THRESHOLD_METERS = 100; // 100 meters
const RECENT_PROMPT_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const LOCAL_STORAGE_KEY = 'TECHTRACK_WORKDAYS_HISTORY';

export default function TechTrackApp() {
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
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});

  const { toast } = useToast();

  const getCurrentFormattedDate = () => new Date().toISOString().split('T')[0];

  const currentJob = useMemo(() => {
    if (!workday?.currentJobId) return null;
    return workday.jobs.find(j => j.id === workday.currentJobId);
  }, [workday]);

  // Geolocation effect
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const newLocation: LocationPoint = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          };
          setCurrentLocation(newLocation);
          setGeolocationError(null);
        },
        (error) => {
          setGeolocationError({ code: error.code, message: error.message });
          toast({ title: "Location Error", description: error.message, variant: "destructive" });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [toast]);

  const recordEvent = useCallback((type: TrackingEvent['type'], location?: LocationPoint, jobId?: string, details?: string) => {
    setWorkday(prev => {
      if (!prev) return null;
      const newEvent: TrackingEvent = {
        id: crypto.randomUUID(),
        type,
        timestamp: Date.now(),
        location: location || currentLocation || undefined,
        jobId,
        details
      };
      return { ...prev, events: [...prev.events, newEvent] };
    });
  }, [currentLocation]);

  // Timer for elapsed time
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (workday?.status === 'tracking') {
      intervalId = setInterval(() => {
        const now = Date.now();
        let activeTime = now - (workday.startTime || now);
        workday.pauseIntervals.forEach(p => {
          if (p.endTime && p.startTime) {
            activeTime -= (p.endTime - p.startTime);
          } else if (workday.status === 'paused' && p.startTime === workday.pauseIntervals[workday.pauseIntervals.length-1]?.startTime) {
            // If paused and it's the current pause interval, subtract time since pause started
             if (p.startTime) activeTime -= (now - p.startTime);
          }
        });
        setElapsedTime(activeTime < 0 ? 0 : activeTime);
      }, 1000);
    } else if (workday?.status === 'paused') {
        const now = Date.now();
        let activeTime = (workday.pauseIntervals[workday.pauseIntervals.length -1]?.startTime || now) - (workday.startTime || now) ;
         workday.pauseIntervals.slice(0,-1).forEach(p => {
          if (p.endTime && p.startTime) {
            activeTime -= (p.endTime - p.startTime);
          }
        });
        setElapsedTime(activeTime < 0 ? 0 : activeTime);
    }
    return () => clearInterval(intervalId);
  }, [workday]);
  
  // Periodic location tracking
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (workday?.status === 'tracking') {
      intervalId = setInterval(() => {
        if (currentLocation) {
          setWorkday(prev => prev ? ({ ...prev, locationHistory: [...prev.locationHistory, currentLocation] }) : null);
          recordEvent('LOCATION_UPDATE', currentLocation, undefined, "Periodic 5-min update");
        }
      }, LOCATION_INTERVAL_MS);
    }
    return () => clearInterval(intervalId);
  }, [workday?.status, currentLocation, recordEvent]);

  // Smart New Job Prompt (Stop Detection)
  useEffect(() => {
    if (workday?.status === 'tracking' && !currentJob) { 
      const lastMovementTime = workday.locationHistory[workday.locationHistory.length -1]?.timestamp || workday.startTime;
      if (Date.now() - (lastMovementTime || Date.now()) > STOP_DETECT_DURATION_MS) {
        const hasBeenPromptedRecently = workday.lastNewJobPromptTime && (Date.now() - workday.lastNewJobPromptTime < RECENT_PROMPT_THRESHOLD_MS);
        
        if(isJobModalOpen) return;

        setAiLoading(prev => ({...prev, newJob: true}));
        decidePromptForNewJob({ hasBeenPromptedRecently: !!hasBeenPromptedRecently, timeStoppedInMinutes: Math.round(STOP_DETECT_DURATION_MS / (60*1000)) })
          .then(res => {
            if (res.shouldPrompt) {
              toast({ title: "New Job?", description: "It looks like you've stopped. Starting a new job? AI: " + res.reason });
              setJobModalMode('new');
              setIsJobModalOpen(true);
              recordEvent('NEW_JOB_PROMPT', currentLocation, undefined, `AI: ${res.reason}`);
            }
            setWorkday(prev => prev ? ({...prev, lastNewJobPromptTime: Date.now()}) : null);
          })
          .catch(err => toast({ title: "AI Error", description: "Could not check for new job.", variant: "destructive" }))
          .finally(() => setAiLoading(prev => ({...prev, newJob: false})));
      }
    }
  }, [workday, currentLocation, toast, recordEvent, currentJob, isJobModalOpen]);

  // Smart Job Completion Prompt (Movement Detection)
  useEffect(() => {
    if (workday?.status === 'tracking' && currentJob && currentJob.status === 'active' && currentLocation) {
        const jobStartLocation = currentJob.startLocation;
        if (!jobStartLocation) return;

        const distance = haversineDistance(jobStartLocation, currentLocation);
        if (distance > MOVEMENT_THRESHOLD_METERS) {
          const lastPromptTime = workday.lastJobCompletionPromptTime;
          
          if(isJobModalOpen) return;

          setAiLoading(prev => ({...prev, jobCompletion: true}));
          decidePromptForJobCompletion({ distanceMovedMeters: distance, lastJobPromptedTimestamp: lastPromptTime })
            .then(res => {
              if (res.shouldPrompt) {
                toast({ title: "Job Update?", description: `You've moved significantly. Did you complete job: ${currentJob.description}? AI: ${res.reason}` });
                setJobToSummarizeId(currentJob.id);
                setJobModalMode('summary');
                setCurrentJobFormData({ description: currentJob.description, summary: '' });
                setIsJobModalOpen(true);
                recordEvent('JOB_COMPLETION_PROMPT', currentLocation, currentJob.id, `AI: ${res.reason}`);
              }
              setWorkday(prev => prev ? ({...prev, lastJobCompletionPromptTime: Date.now()}) : null);
            })
            .catch(err => toast({ title: "AI Error", description: "Could not check for job completion.", variant: "destructive" }))
            .finally(() => setAiLoading(prev => ({...prev, jobCompletion: false})));
        }
    }
  }, [workday, currentJob, currentLocation, toast, recordEvent, isJobModalOpen]);


  const handleStartTracking = () => {
    if (!currentLocation) {
      toast({ title: "Location Required", description: "Cannot start tracking without location.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    setEndOfDaySummary(null); // Reset summary for new day
    const newWorkday: Workday = {
      id: crypto.randomUUID(),
      userId: 'technician1', 
      date: getCurrentFormattedDate(),
      startTime: Date.now(),
      startLocation: currentLocation,
      status: 'tracking',
      locationHistory: [currentLocation],
      jobs: [],
      events: [{ id: crypto.randomUUID(), type: 'SESSION_START', timestamp: Date.now(), location: currentLocation }],
      pauseIntervals: [],
    };
    setWorkday(newWorkday);
    setElapsedTime(0);
    toast({ title: "Tracking Started", description: "Your workday has begun." });
    
    setTimeout(() => { 
        setJobModalMode('new');
        setCurrentJobFormData({ description: '', summary: '' });
        setIsJobModalOpen(true);
        recordEvent('NEW_JOB_PROMPT', currentLocation, undefined, "Initial prompt after session start");
    }, 100);
    setIsLoading(false);
  };

  const handlePauseTracking = () => {
    if (!workday || !currentLocation) return;
    setIsLoading(true);
    const now = Date.now();
    const newPauseInterval: PauseInterval = { startTime: now, startLocation: currentLocation };
    setWorkday(prev => prev ? ({
      ...prev,
      status: 'paused',
      pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
    }) : null);
    recordEvent('SESSION_PAUSE', currentLocation);
    toast({ title: "Tracking Paused" });
    setIsLoading(false);
  };

  const handleResumeTracking = () => {
    if (!workday || !currentLocation) return;
    setIsLoading(true);
    const now = Date.now();
    setWorkday(prev => {
      if (!prev) return null;
      const updatedPauses = [...prev.pauseIntervals];
      if (updatedPauses.length > 0) {
        const currentPause = updatedPauses[updatedPauses.length - 1];
        if (!currentPause.endTime && currentPause.startTime) { // check startTime as well
          currentPause.endTime = now;
          currentPause.endLocation = currentLocation;
        }
      }
      return { ...prev, status: 'tracking', pauseIntervals: updatedPauses };
    });
    recordEvent('SESSION_RESUME', currentLocation);
    toast({ title: "Tracking Resumed" });
    setIsLoading(false);
  };

  const handleEndDay = () => {
    if (!workday || !currentLocation) return;
    setIsLoading(true);
    
    const now = Date.now();
    let finalWorkdayState = { ...workday };

    // Ensure last pause interval is closed if day ends while paused
    if (finalWorkdayState.status === 'paused' && finalWorkdayState.pauseIntervals.length > 0) {
        const lastPause = finalWorkdayState.pauseIntervals[finalWorkdayState.pauseIntervals.length - 1];
        if (lastPause.startTime && !lastPause.endTime) { // check startTime
            lastPause.endTime = now;
            lastPause.endLocation = currentLocation;
        }
    }
    
    finalWorkdayState = {
      ...finalWorkdayState,
      status: 'ended',
      endTime: now,
      endLocation: currentLocation,
    };

    setWorkday(finalWorkdayState); // Update workday state first
    recordEvent('SESSION_END', currentLocation);

    try {
      const existingHistoryString = localStorage.getItem(LOCAL_STORAGE_KEY);
      const existingHistory: Workday[] = existingHistoryString ? JSON.parse(existingHistoryString) : [];
      if (!existingHistory.find(wd => wd.id === finalWorkdayState.id)) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([...existingHistory, finalWorkdayState]));
      }
    } catch (error) {
      console.error("Failed to save workday to localStorage:", error);
      toast({ title: "History Error", description: "Could not save workday to local history.", variant: "destructive" });
    }

    toast({ title: "Day Ended", description: "Workday session concluded." });

    // Calculate summary and then open modal
    calculateWorkdaySummary(finalWorkdayState)
      .then(summary => {
        setEndOfDaySummary(summary);
        setIsSummaryModalOpen(true);
      })
      .catch(error => {
        console.error("Error calculating end of day summary:", error);
        toast({ title: "Summary Error", description: "Could not calculate workday summary.", variant: "destructive" });
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const handleJobFormSubmit = () => {
    if (!workday || !currentLocation) return;
    
    if (jobModalMode === 'new') {
      const newJob: Job = {
        id: crypto.randomUUID(),
        description: currentJobFormData.description,
        startTime: Date.now(),
        startLocation: currentLocation,
        status: 'active',
      };
      setWorkday(prev => prev ? ({
        ...prev,
        jobs: [...prev.jobs, newJob],
        currentJobId: newJob.id,
      }) : null);
      recordEvent('JOB_START', currentLocation, newJob.id, `New job started: ${newJob.description}`);
      toast({ title: "New Job Started", description: newJob.description });
    } else if (jobModalMode === 'summary' && jobToSummarizeId) {
      setAiLoading(prev => ({...prev, summarize: true}));
      summarizeJobDescription({ jobDescription: currentJobFormData.summary })
        .then(aiRes => {
          setWorkday(prev => {
            if (!prev) return null;
            return {
              ...prev,
              jobs: prev.jobs.map(j => j.id === jobToSummarizeId ? {
                ...j,
                summary: currentJobFormData.summary, 
                aiSummary: aiRes.summary, 
                status: 'completed',
                endTime: Date.now(),
                endLocation: currentLocation,
              } : j),
              currentJobId: null, 
            };
          });
          recordEvent('JOB_COMPLETED', currentLocation, jobToSummarizeId, `Job completed. User: ${currentJobFormData.summary}, AI: ${aiRes.summary}`);
          toast({ title: "Job Completed", description: `Summary saved for job.` });
        })
        .catch(err => toast({ title: "AI Error", description: "Could not generate AI summary.", variant: "destructive" }))
        .finally(() => setAiLoading(prev => ({...prev, summarize: false})));
    }
    
    setIsJobModalOpen(false);
    setCurrentJobFormData({ description: '', summary: '' });
    setJobToSummarizeId(null);
  };

  const handleManualStartNewJob = () => {
    if (!currentLocation) {
      toast({ title: "Location Required", description: "Cannot start a new job without location.", variant: "destructive" });
      return;
    }
    setJobModalMode('new');
    setCurrentJobFormData({ description: '', summary: '' });
    setIsJobModalOpen(true);
    recordEvent('USER_ACTION', currentLocation, undefined, "Manually opened new job modal");
  };

  const handleManualCompleteJob = () => {
    if (!currentJob || !currentLocation) return;
    setJobToSummarizeId(currentJob.id);
    setJobModalMode('summary');
    setCurrentJobFormData({ description: currentJob.description, summary: '' });
    setIsJobModalOpen(true);
    recordEvent('USER_ACTION', currentLocation, currentJob.id, "Manually opened complete job modal");
  };

  const CurrentStatusDisplay = () => {
    if (!workday) return <p className="text-muted-foreground">Press "Start Tracking" to begin your day.</p>;
    let statusText = "Unknown";
    let IconComponent = AlertTriangle;

    switch (workday.status) {
      case 'idle': statusText = "Ready to Start"; IconComponent = Play; break;
      case 'tracking': statusText = "Tracking Active"; IconComponent = Clock; break;
      case 'paused': statusText = "Tracking Paused"; IconComponent = Pause; break;
      case 'ended': statusText = "Day Ended"; IconComponent = StopCircle; break;
    }
    return (
      <div className="flex items-center space-x-2">
        <IconComponent className="h-5 w-5 text-accent" />
        <span>{statusText}</span>
      </div>
    );
  };
  
  const ActionButton = () => {
    if (!workday || workday.status === 'idle') {
      return <Button onClick={handleStartTracking} disabled={!currentLocation || isLoading} className="w-full" size="lg">
        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-5 w-5" />} Start Tracking
      </Button>;
    }
    if (workday.status === 'tracking') {
      return (
        <div className="grid grid-cols-2 gap-4">
          <Button onClick={handlePauseTracking} variant="outline" disabled={isLoading} className="w-full" size="lg">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-5 w-5" />} Pause
          </Button>
          <Button onClick={handleEndDay} variant="destructive" disabled={isLoading} className="w-full" size="lg">
             {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-5 w-5" />} End Day
          </Button>
        </div>
      );
    }
    if (workday.status === 'paused') {
       return (
        <div className="grid grid-cols-2 gap-4">
          <Button onClick={handleResumeTracking} disabled={isLoading} className="w-full" size="lg">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-5 w-5" />} Resume
          </Button>
          <Button onClick={handleEndDay} variant="destructive" disabled={isLoading} className="w-full" size="lg">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-5 w-5" />} End Day
          </Button>
        </div>
      );
    }
     if (workday.status === 'ended') {
      return (
        <div className="w-full space-y-2">
            <Button onClick={() => {setWorkday(null); setElapsedTime(0); setEndOfDaySummary(null);}} variant="secondary" className="w-full" size="lg">Start New Day</Button>
            <Link href="/history" passHref legacyBehavior>
                <Button asChild variant="outline" className="w-full" size="lg">
                    <a><History className="mr-2 h-5 w-5" /> View History</a>
                </Button>
            </Link>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col min-h-screen items-center justify-center p-4 bg-background text-foreground">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center text-primary">TechTrack</CardTitle>
          <CardDescription className="text-center">Your smart work companion.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 border rounded-lg bg-secondary/30">
            <CurrentStatusDisplay />
            {workday && (workday.status === 'tracking' || workday.status === 'paused') && (
              <p className="text-4xl font-mono font-bold text-center mt-2">{formatTime(elapsedTime)}</p>
            )}
          </div>
          
          {currentLocation && (
            <div className="text-xs text-muted-foreground flex items-center space-x-1">
              <MapPin className="h-3 w-3" />
              <span>Lat: {currentLocation.latitude.toFixed(4)}, Lon: {currentLocation.longitude.toFixed(4)} (Acc: {currentLocation.accuracy?.toFixed(0)}m)</span>
            </div>
          )}
          {geolocationError && <p className="text-xs text-destructive">Location Error: {geolocationError.message}</p>}

          {currentJob && currentJob.status === 'active' && (
            <Card className="bg-accent/10">
              <CardHeader className="p-3">
                <CardTitle className="text-sm flex items-center"><Briefcase className="mr-2 h-4 w-4 text-accent"/>Current Job</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <p className="text-sm">{currentJob.description}</p>
              </CardContent>
              <CardFooter className="p-3">
                <Button onClick={handleManualCompleteJob} size="sm" className="w-full">
                  <CheckCircle className="mr-2 h-4 w-4" /> Complete This Job
                </Button>
              </CardFooter>
            </Card>
          )}
          
          {workday?.status === 'tracking' && !currentJob && (
            <Button onClick={handleManualStartNewJob} variant="outline" className="w-full mt-2">
              <Briefcase className="mr-2 h-4 w-4" /> Start New Job
            </Button>
          )}

          {(aiLoading.newJob || aiLoading.jobCompletion || aiLoading.summarize) && (
            <div className="flex items-center justify-center text-sm text-muted-foreground pt-2">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span>AI is thinking...</span>
            </div>
          )}

        </CardContent>
        <CardFooter>
          <ActionButton />
        </CardFooter>
      </Card>

      {/* New Job / Job Summary Modal */}
      <Dialog open={isJobModalOpen} onOpenChange={setIsJobModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{jobModalMode === 'new' ? 'Start New Job' : 'Complete Job'}</DialogTitle>
            <DialogDescription>
              {jobModalMode === 'new' ? 'Enter details for the new job.' : `Provide a summary for: ${currentJobFormData.description}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {jobModalMode === 'new' && (
              <div className="space-y-2">
                <Label htmlFor="jobDescription">Job Description</Label>
                <Textarea 
                  id="jobDescription" 
                  value={currentJobFormData.description}
                  onChange={(e) => setCurrentJobFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="e.g., AC unit repair at 123 Main St"
                />
              </div>
            )}
            {jobModalMode === 'summary' && (
              <div className="space-y-2">
                <Label htmlFor="jobSummary">Work Summary</Label>
                <Textarea 
                  id="jobSummary" 
                  value={currentJobFormData.summary}
                  onChange={(e) => setCurrentJobFormData(prev => ({ ...prev, summary: e.target.value }))}
                  placeholder="e.g., Replaced capacitor and cleaned coils."
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleJobFormSubmit} disabled={aiLoading.summarize}>
              {aiLoading.summarize && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {jobModalMode === 'new' ? 'Start Job' : 'Complete Job'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End Day Summary Modal */}
      <Dialog open={isSummaryModalOpen} onOpenChange={setIsSummaryModalOpen}>
        <DialogContent className="max-w-lg">
          {endOfDaySummary ? (
             <WorkdaySummaryDisplay summary={endOfDaySummary} showTitle={true} />
          ) : (
            <p>Loading summary...</p> // Or some loading indicator
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button onClick={() => setEndOfDaySummary(null)}>Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
