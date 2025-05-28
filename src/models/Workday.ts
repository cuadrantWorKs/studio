import { PauseInterval } from '../types';
import { Job } from '../types';
import { LocationPoint } from '../types';

export interface Workday {
  id: string;
  userId: string;
  technicianId: string;
  date: string; // Or Date type if you are using Date objects
  startTime: number; // Or Date type
  endTime?: number | undefined; // Or Date type
  isSynced: boolean;
  startLocation?: LocationPoint | null;
  endLocation?: LocationPoint | null;
  jobs: Job[];
  currentJobId: string | null;
  pauseIntervals: (PauseInterval | null)[]; // Changed to allow null
  notes?: string | null;
  createdAt: number; // Or Date type
  updatedAt: number; // Or Date type
  // Add other properties as needed
}