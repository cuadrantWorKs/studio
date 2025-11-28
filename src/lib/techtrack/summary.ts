'use server';

import type { Workday, WorkdaySummaryContext, PauseInterval, LocationPoint } from './types';
import { calculateRobustDistance } from './geometry';

export async function calculateWorkdaySummary(workday: Workday | null): Promise<WorkdaySummaryContext | null> {
  if (!workday || workday.status !== 'ended' || !workday.startTime || !workday.endTime) {
    return null;
  }

  const effectiveStartTime = (workday.jobs && workday.jobs.length > 0) ? workday.jobs[0].startTime : workday.startTime;

  // Determine effective end time (end of last job)
  let effectiveEndTime = workday.endTime;
  if (workday.jobs && workday.jobs.length > 0) {
    // Sort jobs by endTime just in case, though they should be in order. 
    // If the last job doesn't have an endTime (active when day ended), use workday.endTime
    const lastJob = workday.jobs[workday.jobs.length - 1];
    effectiveEndTime = lastJob.endTime || workday.endTime;
  }

  let totalActiveTime = effectiveEndTime - effectiveStartTime;

  let totalPausedTimeCalc = 0;
  workday.pauseIntervals.forEach((p: PauseInterval) => {
    // Ensure pause is within the effective window
    if (p.endTime && p.startTime && p.startTime >= effectiveStartTime && p.endTime <= effectiveEndTime) {
      totalPausedTimeCalc += (p.endTime - p.startTime);
    }
  });
  totalActiveTime -= totalPausedTimeCalc;
  if (totalActiveTime < 0) totalActiveTime = 0;


  const totalDistanceKm = calculateRobustDistance(workday);

  return {
    ...workday,
    totalActiveTime,
    totalPausedTime: totalPausedTimeCalc,
    totalDistanceKm,
  };
}
