'use client';

import {
    Battery,
    BatteryCharging,
    BatteryFull,
    BatteryLow,
    BatteryMedium,
    BatteryWarning,
    Wifi,
    WifiOff,
    Navigation,
    Activity,
    Zap,
    Signal
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip';
import { RawLocationData, GeolocationError, LocationPoint } from '@/lib/techtrack/types';
import { cn } from '@/lib/utils';

interface TechnicianStatusProps {
    currentLocation: LocationPoint | null;
    rawLocationData: RawLocationData | null;
    geolocationError: GeolocationError | null;
    className?: string;
}

export default function TechnicianStatus({
    currentLocation,
    rawLocationData,
    geolocationError,
    className
}: TechnicianStatusProps) {

    // -- Battery Logic --
    const getBatteryIcon = (level: number, isCharging?: boolean) => {
        if (isCharging) return <BatteryCharging className="h-4 w-4 text-yellow-400" />;
        if (level <= 0.2) return <BatteryWarning className="h-4 w-4 text-red-500 animate-pulse" />;
        if (level <= 0.5) return <BatteryLow className="h-4 w-4 text-amber-500" />;
        if (level <= 0.8) return <BatteryMedium className="h-4 w-4 text-green-400" />;
        return <BatteryFull className="h-4 w-4 text-green-500" />;
    };

    const batteryLevel = rawLocationData?.battery ?? 0;
    const isCharging = rawLocationData?.batteryIsCharging;

    // -- GPS Logic --
    const isGpsOnline = !geolocationError && currentLocation;
    const accuracy = currentLocation?.accuracy ?? 0;

    // -- Motion Logic --
    const isMoving = rawLocationData?.isMoving;
    const speedKmh = rawLocationData?.speed ? (rawLocationData.speed * 3.6).toFixed(1) : '0.0';
    const activityType = rawLocationData?.activityType || 'quieto';

    return (
        <Card className={cn(
            "bg-slate-900/50 backdrop-blur-md border-slate-800/50 p-2 flex items-center justify-between gap-2 shadow-lg overflow-x-auto",
            className
        )}>

            {/* Group 1: GPS & Connectivity */}
            <div className="flex items-center gap-3">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-full border bg-opacity-10 transition-colors cursor-help",
                                isGpsOnline
                                    ? "bg-green-500 border-green-500/30 text-green-400"
                                    : "bg-red-500 border-red-500/30 text-red-400"
                            )}>
                                {isGpsOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                                <span className="text-xs font-bold tracking-wider hidden sm:inline">
                                    {isGpsOnline ? 'GPS' : 'OFFLINE'}
                                </span>
                                {isGpsOnline && (
                                    <span className="text-[10px] opacity-70 border-l border-green-500/30 pl-2 ml-1 hidden sm:inline">
                                        ±{accuracy.toFixed(0)}m
                                    </span>
                                )}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="bg-slate-800 border-slate-700 text-xs text-slate-300">
                            {isGpsOnline
                                ? `Conexión estable. Precisión: ${accuracy.toFixed(1)} metros`
                                : `Error GPS: ${geolocationError?.message || 'Señal perdida'}`}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            {/* Group 2: Battery Status */}
            {rawLocationData?.battery !== undefined && (
                <div className="flex items-center gap-2">
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full border bg-opacity-10",
                        isCharging
                            ? "bg-yellow-500 border-yellow-500/30 text-yellow-500"
                            : batteryLevel < 0.2
                                ? "bg-red-500 border-red-500/30 text-red-500"
                                : "bg-slate-700 border-slate-600 text-slate-300"
                    )}>
                        {getBatteryIcon(batteryLevel, isCharging)}
                        <span className="text-xs font-mono font-bold">
                            {(batteryLevel * 100).toFixed(0)}%
                        </span>
                    </div>
                </div>
            )}

            {/* Group 3: Motion & Activity */}
            {(rawLocationData?.isMoving !== undefined || rawLocationData?.speed !== undefined) && (
                <div className="flex items-center gap-2">
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full border bg-opacity-10",
                        isMoving
                            ? "bg-blue-500 border-blue-500/30 text-blue-400"
                            : "bg-slate-700 border-slate-600 text-slate-400"
                    )}>
                        {isMoving ? <Navigation className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
                        <div className="flex flex-col leading-none">
                            <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">
                                {isMoving ? 'En Ruta' : 'Quieto'}
                            </span>
                        </div>
                        {isMoving && (
                            <span className="text-[10px] font-mono border-l border-blue-500/30 pl-2 ml-1">
                                {speedKmh} km/h
                            </span>
                        )}
                    </div>
                </div>
            )}

        </Card>
    );
}
