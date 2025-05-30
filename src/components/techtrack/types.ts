import type { WorkdaySummaryContext } from '@/lib/techtrack/types';
import type { LocationPoint } from '../../lib/techtrack/types'; // Assuming LocationPoint is defined here

export { WorkdaySummaryContext, LocationPoint };

export interface Workday {
  id: string;
  userId: string;
  technicianId: string;
  date: string; // YYYY-MM-DD
  startTime: number; // Timestamp
  endTime?: number; // Timestamp
  status: 'active' | 'paused' | 'ended';
  currentJobId: string | null;
  jobs: Job[];
  pauseIntervals: (PauseInterval | null)[]; // Changed to allow null
  locationHistory: LocationPoint[];
  isSynced: boolean;
  syncError?: string;
}

export interface Job {
  id: string;
  workdayId: string;
  description: string;
  startTime: number; // Timestamp
  endTime?: number; // Timestamp
  summary?: string;
  status: 'active' | 'completed';
  location?: LocationPoint | null; // Nullable location
}

export interface PauseInterval {
  id: string;
  workdayId: string;
  startTime: number; // Timestamp
  endTime?: number; // Timestamp
}

export interface CurrentStatusDisplayProps {
  workday: Workday;
  endOfDaySummary: WorkdaySummaryContext | null;
}