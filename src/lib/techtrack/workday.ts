// src/lib/techtrack/workday.ts
import type { Workday } from "./types";
import { db as localDb } from "@/db"; // Keep this import
import { Dispatch, SetStateAction } from "react"; // Import Dispatch and SetStateAction from react

export const initiateEndDayProcess = async (
  workday: Workday,
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive" | null | undefined;
  }) => void,
  setIsLoading: (loading: boolean) => void,
  setWorkday: Dispatch<SetStateAction<Workday | null>>,
  setEndOfDaySummary: Dispatch<SetStateAction<any>>, // Ajusta el tipo si tienes uno definido
  setSyncStatus: Dispatch<
    SetStateAction<"idle" | "syncing" | "success" | "error">
  >,
  setSyncRetryActive: Dispatch<SetStateAction<boolean>>,
) => {
  // 1. Update workday status and end time/location locally
  setSyncStatus("syncing");

  // 1. Marca localmente la jornada como “ended”
  await localDb.workdays.update(workday.id, {
    status: "ended",
    endTime: Date.now(),
    endLocation: workday.locationHistory.slice(-1)[0] || null,
    isSynced: false,
  });

  // 2. Ejecuta la sincronización final
  try {
    await syncLocalDataToSupabase();
    setSyncStatus("success");
    toast({
      title: "Jornada Finalizada",
      description:
        "Tu jornada se cerró correctamente y se sincronizó con la nube.",
    });
  } catch (error) {
    console.error("Error sincronizando al finalizar jornada:", error);
    setSyncStatus("error");
    // Evitamos apagar el spinner aquí para que no quede “sincronizando…” después
    toast({
      title: "Error al Finalizar Jornada",
      description:
        "Hubo un error al sincronizar la jornada. Se cerró localmente de todas formas.",
      variant: "destructive",
    });
  } finally {
    // 3. Estado final de la UI: siempre “ended”
    setWorkday(
      (prev) =>
        prev
          ? {
              ...prev,
              status: "ended",
              endTime: Date.now(),
              endLocation: prev.locationHistory.slice(-1)[0] || undefined,
            }
          : null, // Ensure to handle the null case
    );

    // 4. Genera o extrae acá tu resumen de fin de día (puedes reutilizar la lógica existente)
    const summary = {
      totalTime: (workday.endTime ?? Date.now()) - (workday.startTime ?? 0), // Provide default 0 if startTime is undefined
      totalJobs: workday.jobs.length,
      // …otros totales que manejes…
    };
    setEndOfDaySummary(summary);

    // 5. Limpieza de flags
    setIsLoading(false);
    setSyncRetryActive(false);
    // 6. Borra el localStorage para que al recargar quede listo para un nuevo día
    const key = `TECHTRACK_CURRENT_WORKDAY_${workday.userId}`;
    localStorage.removeItem(key);
  }
};

// Moved from TechTrackApp for better organization and export
export async function syncLocalDataToSupabase() {
  // Dummy implementation - replace with your actual sync logic
  console.log("Attempting to sync local data to Supabase...");
  // Example: Fetch unsynced data, upload to Supabase, update local data as synced
  await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate network delay
  console.log("Sync complete.");
}
