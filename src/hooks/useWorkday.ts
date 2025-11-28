import { useState, useEffect, useCallback, useMemo } from 'react';
import { Workday, TrackingEvent, LocationPoint, PauseInterval, Job } from '@/lib/techtrack/types';
import { sanitizeLocationPoint } from './useGeolocation';

const LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX = 'TECHTRACK_CURRENT_WORKDAY_';

export function useWorkday(technicianName: string, currentLocation: LocationPoint | null) {
    const [workday, setWorkday] = useState<Workday | null>(null);
    const [elapsedTime, setElapsedTime] = useState(0);

    const getLocalStorageKey = useCallback(() => `${LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX}${technicianName}`, [technicianName]);

    // Load from local storage
    useEffect(() => {
        const localStorageKey = getLocalStorageKey();
        const savedWorkdayJson = localStorage.getItem(localStorageKey);
        if (savedWorkdayJson) {
            try {
                const savedWorkday = JSON.parse(savedWorkdayJson) as Workday;
                if (savedWorkday && savedWorkday.userId === technicianName && savedWorkday.status !== 'ended') {
                    setWorkday(savedWorkday);
                } else {
                    localStorage.removeItem(localStorageKey);
                }
            } catch (e) {
                console.error("Error parsing workday from localStorage", e);
                localStorage.removeItem(localStorageKey);
            }
        }
    }, [technicianName, getLocalStorageKey]);

    // Save to local storage
    useEffect(() => {
        const localStorageKey = getLocalStorageKey();
        if (workday && workday.status !== 'ended' && workday.userId === technicianName) {
            localStorage.setItem(localStorageKey, JSON.stringify(workday));
        } else if (workday?.status === 'ended') {
            localStorage.removeItem(localStorageKey);
        }
    }, [workday, technicianName, getLocalStorageKey]);

    // Timer logic
    useEffect(() => {
        let intervalId: NodeJS.Timeout | undefined = undefined;

        if (workday?.status === 'tracking') {
            intervalId = setInterval(() => {
                const now = Date.now();
                // Start time is the first job's start time, or now if no jobs yet (effectively 0 active time)
                const firstJobStart = workday.jobs.length > 0 ? workday.jobs[0].startTime : null;

                if (!firstJobStart) {
                    setElapsedTime(0);
                    return;
                }

                let activeTime = now - firstJobStart;
                workday.pauseIntervals.forEach(p => {
                    // Only count pauses that started AFTER the first job started
                    if (p.endTime && p.startTime && p.startTime >= firstJobStart) {
                        activeTime -= (p.endTime - p.startTime);
                    }
                });
                setElapsedTime(activeTime < 0 ? 0 : activeTime);
            }, 1000);
        } else if (workday?.status === 'paused' || workday?.status === 'ended') {
            const firstJobStart = workday.jobs.length > 0 ? workday.jobs[0].startTime : null;

            if (!firstJobStart) {
                setElapsedTime(0);
            } else {
                const baseTime = (workday.endTime || workday.pauseIntervals.find(p => !p.endTime)?.startTime || Date.now());
                let activeTime = (baseTime) - firstJobStart;
                workday.pauseIntervals.forEach(p => {
                    if (p.endTime && p.startTime && p.startTime >= firstJobStart) {
                        if (!(workday.status === 'paused' && p.startTime === workday.pauseIntervals[workday.pauseIntervals.length - 1]?.startTime && !p.endTime)) {
                            activeTime -= (p.endTime - p.startTime);
                        }
                    }
                });
                setElapsedTime(activeTime < 0 ? 0 : activeTime);
            }
        } else if (workday?.status === 'idle') {
            setElapsedTime(0);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [workday]);

    const recordEvent = useCallback((type: TrackingEvent['type'], locationParam: LocationPoint | null | undefined, jobId?: string, details?: string) => {
        setWorkday(prev => {
            if (!prev) return null;
            const eventLocation = sanitizeLocationPoint(locationParam === undefined ? currentLocation : locationParam);
            const newEvent: TrackingEvent = {
                id: crypto.randomUUID(),
                type,
                timestamp: Date.now(),
                jobId,
                details: details ?? undefined,
                location: eventLocation ?? undefined,
            };
            return { ...prev, events: [...prev.events, newEvent] };
        });
    }, [currentLocation]);

    const currentJob = useMemo(() => {
        if (!workday?.currentJobId) return null;
        return workday.jobs.find(j => j.id === workday.currentJobId);
    }, [workday]);

    return {
        workday,
        setWorkday,
        elapsedTime,
        recordEvent,
        currentJob,
        getLocalStorageKey
    };
}
