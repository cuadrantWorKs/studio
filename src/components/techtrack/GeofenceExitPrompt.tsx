import { useState, useMemo, useEffect } from "react";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MapPin, Clock, Briefcase, User, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { LocationPoint } from "@/lib/techtrack/types";
import { formatTime } from "@/lib/utils";

// Dynamic import for Leaflet map to avoid SSR issues
const MapContainer = dynamic(
    () => import("react-leaflet").then((mod) => mod.MapContainer),
    { ssr: false }
);
const TileLayer = dynamic(
    () => import("react-leaflet").then((mod) => mod.TileLayer),
    { ssr: false }
);
const Marker = dynamic(
    () => import("react-leaflet").then((mod) => mod.Marker),
    { ssr: false }
);
const Popup = dynamic(
    () => import("react-leaflet").then((mod) => mod.Popup),
    { ssr: false }
);

interface GeofenceExitPromptProps {
    isOpen: boolean;
    exitTime: number;
    startTime: number;
    startLocation: LocationPoint;
    jobDescription: string;
    onConfirmExit: (summary: string, isWorkRelated: boolean, actualExitTime: number) => void;
    onContinueWorking: () => void;
}

export function GeofenceExitPrompt({
    isOpen,
    exitTime,
    startTime,
    startLocation,
    jobDescription,
    onConfirmExit,
    onContinueWorking,
}: GeofenceExitPromptProps) {
    const [summary, setSummary] = useState("");
    const [isWorkRelated, setIsWorkRelated] = useState(true);
    const [adjustedTime, setAdjustedTime] = useState(exitTime);

    // Formatting times
    const exitDate = new Date(exitTime);
    const startDate = new Date(startTime);
    const timeString = exitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const startString = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Reset state when prompt opens
    useEffect(() => {
        if (isOpen) {
            setAdjustedTime(exitTime);
            setSummary("");
            setIsWorkRelated(true);
        }
    }, [isOpen, exitTime]);

    // Leaflet marker icon fix would be needed here generally, but we can use simple div icons or standard ones if loaded correctly.
    // For simplicity allowing default icon or using a custom component would be better if we had valid icon paths.
    // Assuming default CSS handles it or we'd import 'leaflet/dist/images/...'

    return (
        <AlertDialog open={isOpen}>
            <AlertDialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <AlertDialogHeader>
                    <AlertDialogTitle>¿Qué hiciste aquí?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Detectamos que estuviste en esta ubicación desde las <strong>{startString}</strong> hasta las <strong>{timeString}</strong>.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {/* Map Preview */}
                <div className="h-40 w-full rounded-md overflow-hidden bg-slate-100 border relative">
                    {typeof window !== 'undefined' && (
                        <MapContainer
                            center={[startLocation.latitude, startLocation.longitude]}
                            zoom={15}
                            style={{ height: "100%", width: "100%" }}
                            zoomControl={false}
                            attributionControl={false}
                        >
                            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                            <Marker position={[startLocation.latitude, startLocation.longitude]}>
                                <Popup>{jobDescription}</Popup>
                            </Marker>
                        </MapContainer>
                    )}
                    <div className="absolute bottom-2 right-2 bg-white/90 px-2 py-1 text-xs rounded shadow flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-red-500" />
                        {startLocation.latitude.toFixed(4)}, {startLocation.longitude.toFixed(4)}
                    </div>
                </div>

                <div className="grid gap-4 py-2">

                    {/* Context Info */}
                    <div className="flex items-center justify-between text-sm bg-slate-50 p-2 rounded border">
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-500" />
                            <span>Llegada: {startString}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-orange-500" />
                            <span>Salida: {timeString}</span>
                        </div>
                    </div>

                    {/* Work vs Personal Toggle */}
                    <div className="flex items-center justify-between space-x-2">
                        <Label htmlFor="work-mode" className="flex items-center gap-2">
                            {isWorkRelated ? <Briefcase className="h-4 w-4 text-green-600" /> : <User className="h-4 w-4 text-amber-600" />}
                            {isWorkRelated ? "Fue Trabajo (Remunerado)" : "Fue Pausa Personal (No remunerado)"}
                        </Label>
                        <Switch id="work-mode" checked={isWorkRelated} onCheckedChange={setIsWorkRelated} />
                    </div>

                    {/* Description/Summary */}
                    <div className="grid gap-2">
                        <Label htmlFor="summary">
                            {isWorkRelated ? "Resumen del trabajo realizado" : "Motivo de la pausa (opcional)"}
                        </Label>
                        <Textarea
                            id="summary"
                            placeholder={isWorkRelated ? "Instalé el router, verifiqué señal..." : "Almuerzo, trámite personal..."}
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                        />
                    </div>

                </div>

                <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                    <Button variant="outline" onClick={onContinueWorking}>
                        No, sigo trabajando
                    </Button>
                    <Button
                        onClick={() => onConfirmExit(summary, isWorkRelated, adjustedTime)}
                        disabled={isWorkRelated && summary.length < 3} // Require summary for work
                    >
                        {isWorkRelated ? "Confirmar Trabajo Realizado" : "Registrar como Pausa"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
