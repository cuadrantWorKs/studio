// Assuming LocationPoint is defined here and exported

export interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: any;
}

export interface PauseInterval {
  startTime: number;
  endTime?: number | null; // Assuming endTime can also be null or undefined
}

export interface Job {
  id: string;
  description: string;
  startTime: number;
  endTime?: number | null; // Assuming endTime can also be null or undefined
  summary?: string | null; // Assuming summary can be null
  location?: LocationPoint | null; // Assuming location can be null
}

export interface Workday {
  id: string;
  userId: string;
  technicianId: string;
  date: string; // YYYY-MM-DD format
  startTime: number; // Timestamp
  endTime?: number | null; // Timestamp
  status: 'started' | 'paused' | 'ended';
  locationHistory: LocationPoint[];
  jobs: Job[];
  pauseIntervals: (PauseInterval | null)[]; // Changed to allow null
  currentJobId: string | null;
  currentPauseId: string | null;
  isSynced: boolean;
  syncError?: string | null;
  notes?: string | null;
}