"use client";

import { useState, useEffect } from 'react';
import { db as localDb } from '@/db'; // Import local Dexie DB
import { Button } from '@/components/ui/button';
import type { Workday } from '@/lib/techtrack/types';

import { syncLocalDataToSupabase } from '@/lib/techtrack/sync';
export default function HistoryPage() {
  const [workdays, setWorkdays] = useState<Workday[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchWorkdays = async () => {
    try {
      const allWorkdays = await localDb.workdays.toArray();
      const allLocations = await localDb.locations.toArray();
      allLocations.reduce((acc: Record<string, Location[]>, location) => {
        if (location.workdayId !== undefined) { // Check if workdayId is defined
          const workdayIdString = location.workdayId.toString();
          if (!acc[workdayIdString]) {
            acc[workdayIdString] = [];
          }
          acc[workdayIdString].push(location as Location); // Cast location to Location type from db
        }
        return acc; // Return accumulator
      }, {} as Record<string, Location[]>); // Correct initial value and type assertion

      // Attach location history to workdays and ensure type compatibility
      // Assuming pauseIntervals is already stored as PauseInterval[] in the database
      const workdaysWithHistory: Workday[] = allWorkdays.map(workday => {
        // No need to parse JSON if pauseIntervals is stored as an array
        // const rawPauses: any[] = JSON.parse(workday.pauseIntervals as string || '[]'); 
        return {
          ...workday,
          // But assuming it's stored as PauseInterval[] directly
          pauseIntervals: workday.pauseIntervals || [], // Ensure pauseIntervals is always an array
        };
      });
      setWorkdays(workdaysWithHistory); // Update state with workdays including location history
    } catch (error) { // Add catch block to handle errors
      console.error("Error fetching workdays:", error);
    }
  };

  useEffect(() => {
    fetchWorkdays();
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await syncLocalDataToSupabase();
      await fetchWorkdays(); // Refetch data after sync
    } catch (error) {
      console.error("Error syncing local data:", error);
      // TODO: Handle error (e.g., show a toast)
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      {/* Import and use Button if needed */}
      <h1 className="text-2xl font-bold mb-4">Historial de Jornadas Laborales</h1>
      <Button onClick={handleManualSync} disabled={isSyncing}>
        {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
      </Button>
      {/* Display the list of workdays here */}
      <ul>
        {workdays.map(workday => (
          <li key={workday.id} className="border p-2 mb-2 rounded-md shadow-sm">
            <h3 className="text-lg font-semibold">Jornada ID: {workday.id}</h3>
            {/* Add more details as needed */}
            {workday.startTime && <p>Inicio: {new Date(workday.startTime).toLocaleString()}</p>}
            {workday.endTime && <p>Fin: {workday.endTime ? new Date(workday.endTime).toLocaleString() : 'In Progress'}</p>}
            <p>Sincronizado: {workday.isSynced ? 'Sí' : 'No'}</p>
            {/* Display pause intervals */}
            {workday.pauseIntervals && workday.pauseIntervals.length > 0 && (
              <div>
                <p>Intervalos de Pausa:</p>
                <ul>
                  {workday.pauseIntervals.map((pause, index) => (
                    <li key={index} className="ml-4 text-sm">
                      {pause.startTime && `Desde: ${new Date(pause.startTime).toLocaleTimeString()}`}
                      {pause.endTime && ` Hasta: ${new Date(pause.endTime).toLocaleTimeString()}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
