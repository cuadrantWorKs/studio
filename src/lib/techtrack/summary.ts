'use server';

import type { Workday, WorkdaySummaryContext, PauseInterval, LocationPoint } from './types';
import { calculateTotalDistance } from './geometry';

export async function calculateWorkdaySummary(workday: Workday | null): Promise<WorkdaySummaryContext | null> {
  if (!workday || workday.status !== 'ended' || !workday.startTime || !workday.endTime) {
    return null;
  }

  let totalActiveTime = workday.endTime - workday.startTime;
  
  let totalPausedTimeCalc = 0;
  if(!workday.pauseIntervals) {
    workday.pauseIntervals = [];
  }
  if(!workday.locationHistory) {
    workday.locationHistory = [];
  } 

  workday.pauseIntervals.forEach((p: PauseInterval) => {
    if (p.endTime && p.startTime) { // Ensure both startTime and endTime are defined
      totalPausedTimeCalc += (p.endTime - p.startTime);
    }
  });
  totalActiveTime -= totalPausedTimeCalc;
  if (totalActiveTime < 0) totalActiveTime = 0;


  const totalDistanceKm = calculateTotalDistance(workday.locationHistory as LocationPoint[]);

  return {
    ...workday,
    totalActiveTime,
    totalPausedTime: totalPausedTimeCalc,
    totalDistanceKm,
  };
}
