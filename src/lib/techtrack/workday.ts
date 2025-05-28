// src/lib/techtrack/workday.ts
import type { Workday, WorkdaySummaryContext } from './types';
import { calculateWorkdaySummary } from './summary';
import { syncLocalDataToSupabase } from './sync';
import { db as localDb } from '@/db';

// Assuming Toast and SetIsLoading types are imported or defined elsewhere
// For now, we'll use any for simplicity, but ideally, use proper types
// import type { Toast } from '@/hooks/use-toast';
// import type { SetStateAction, Dispatch } from 'react';

export const initiateEndDayProcess = async (
  currentWorkday: Workday,
  toast: any, // Replace with proper Toast type
  setIsLoading: any // Replace with proper Dispatch<SetStateAction<boolean>> type
) => {
  if (currentWorkday.status === 'ended') {
    console.log("Workday already ended.");
    return;
  }

  setIsLoading(true); // Indicate that an asynchronous process is starting
  const endTime = Date.now();

  // 1. Update workday status and end time/location locally
  const updatedWorkday = {
    ...currentWorkday,
    status: 'ended' as 'ended',
    endTime: endTime,
    // endLocation will ideally be the last known location from state in TechTrackApp before calling this function
    // Need to pass endLocation as a parameter, or access it from a shared state/context
    // For now, let's assume we pass it as a parameter
    // endLocation: latestLocation // This needs to be passed in
    isSynced: false, // Mark as unsynced as we modified it
  };

  try {
    // Update the workday in the local database
    await localDb.workdays.update(updatedWorkday.id, updatedWorkday);
    console.log("Workday status updated to ended locally.");

    // 2. Calculate summary based on the finalized workday data
    // Need to re-fetch or use the latest data including all events and locations
    // For simplicity now, let's use the updatedWorkday, but a more robust approach might fetch from DB
    const workdayForSummary = await localDb.workdays.get(updatedWorkday.id);
    const endOfDaySummary = await calculateWorkdaySummary(workdayForSummary || updatedWorkday);
    console.log("Workday summary calculated.", endOfDaySummary);

    // 3. Trigger final sync to ensure all data, including the 'ended' status and summary, is uploaded
    console.log("Triggering final sync after ending workday.");
    await syncLocalDataToSupabase();
    console.log("Final sync completed.");

    // 4. Update the state in TechTrackApp (This needs to be handled by the caller)
    // The calling component (TechTrackApp) should update its workday state and set endOfDaySummary
    // This function should potentially return the updated workday and summary, or take state setters as parameters

    // For now, let's just ensure local DB is updated and sync is triggered.
    // The state update in TechTrackApp will happen based on a listener or explicit call after this.

    toast({
      title: "Jornada Finalizada",
      description: "Tu jornada laboral ha sido finalizada y los datos están sincronizados.",
    });

  } catch (error) {
    console.error("Error during initiateEndDayProcess:", error);
    toast({
      title: "Error al Finalizar Jornada",
      description: "Hubo un error al finalizar tu jornada. Algunos datos pueden no haberse sincronizado.",
      variant: "destructive",
    });
    // Optionally re-throw the error or handle partial success/failure
  } finally {
    setIsLoading(false); // Ensure loading state is turned off
  }
};