// types.ts

export interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number;
}

export type JobStatus = 'active' | 'completed' | 'cancelled';

export interface Job {
  id: string;
  workdayId: string;
  description: string;
  startTime: number;
  startLocation?: LocationPoint;
  endTime?: number;
  endLocation?: LocationPoint;
  summary?: string;    // Technician's summary
  aiSummary?: string;  // AI-generated summary
  status: JobStatus;
  isSynced: boolean;
}

export type TrackingStatus = 'idle' | 'tracking' | 'paused' | 'ended';

export type TrackingEventType =
  | 'SESSION_START'
  | 'WORKDAY_START'
  | 'WORKDAY_END'
  | 'PAUSE_START'
  | 'PAUSE_END'
  | 'SESSION_PAUSE'
  | 'SESSION_RESUME'
  | 'SESSION_END'
  | 'LOCATION_UPDATE'
  | 'JOB_START'
  | 'JOB_DETAILS_UPDATED'
  | 'JOB_COMPLETION_PROMPT'
  | 'JOB_COMPLETED'
  | 'NEW_JOB_PROMPT'
  | 'USER_ACTION'
  | 'ERROR';

export interface TrackingEvent {
  id: string;
  workdayId: string;
  timestamp: number;
  location?: LocationPoint;
  jobId?: string;
  details?: string;
  isSynced: boolean;
  type: TrackingEventType;
}

export interface PauseInterval {
  id: string;
  workdayId: string;
  startTime: number | null;
  endTime?: number | null;
  startLocation?: LocationPoint | null;
  endLocation?: LocationPoint | null;
  isSynced: boolean;
}

export interface Workday {
  id: string; 
  userId: string;
 technicianId: string; // Added technicianId
  date: string;                        // YYYY-MM-DD
  startTime?: number;
  startLocation?: LocationPoint | null;
  endTime?: number;
  endLocation?: LocationPoint | null;
  status: TrackingStatus;
  locationHistory: LocationPoint[];
  jobs: Job[];
  events: TrackingEvent[];
  pauseIntervals: PauseInterval[];
  lastNewJobPromptTime?: number;
  lastJobCompletionPromptTime?: number;
  currentJobId?: string | null;
 isSynced: boolean; // Added isSynced
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface WorkdaySummaryContext extends Workday {
  totalActiveTime: number;   // en ms
  totalPausedTime: number;   // en ms
  totalDistanceKm: number;
}

export interface GeolocationError {
  code: number;
  message: string;
}

export function isError(error: unknown): error is Error {
  return error instanceof Error;
}
