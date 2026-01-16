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

    return (
        <Card className={cn(
            "bg-slate-800/50 backdrop-blur-md border-slate-700/50 p-2 shadow-inner",
            className
        )}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">

                {/* Group 1: GPS */}
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-lg border bg-slate-900/50 transition-colors flex-1 justify-center min-w-[90px]",
                                isGpsOnline
                                    ? "border-green-500/20 text-green-400"
                                    : "border-red-500/20 text-red-400"
                            )}>
                                {isGpsOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                                <div className="flex flex-col leading-none items-start">
                                    <span className="font-bold tracking-wider">
                                        {isGpsOnline ? 'ONLINE' : 'OFFLINE'}
                                    </span>
                                    {isGpsOnline && (
                                        <span className="text-[9px] opacity-70 font-mono">
                                            ±{accuracy.toFixed(0)}m
                                        </span>
                                    )}
                                </div>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="bg-slate-900 border-slate-700 text-xs text-slate-300">
                            {isGpsOnline
                                ? `Conexión estable. Precisión: ${accuracy.toFixed(1)} metros`
                                : `Error GPS: ${geolocationError?.message || 'Señal perdida'}`}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                {/* Group 2: Battery */}
                {rawLocationData?.battery !== undefined && (
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg border bg-slate-900/50 flex-1 justify-center min-w-[90px]",
                        isCharging
                            ? "border-yellow-500/20 text-yellow-500"
                            : batteryLevel < 0.2
                                ? "border-red-500/20 text-red-500"
                                : "border-slate-600/50 text-slate-300"
                    )}>
                        {getBatteryIcon(batteryLevel, isCharging)}
                        <span className="font-mono font-bold text-sm">
                            {(batteryLevel * 100).toFixed(0)}%
                        </span>
                    </div>
                )}

                {/* Group 3: Motion */}
                {(rawLocationData?.isMoving !== undefined || rawLocationData?.speed !== undefined) && (
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg border bg-slate-900/50 flex-1 justify-center min-w-[90px]",
                        isMoving
                            ? "border-blue-500/20 text-blue-400"
                            : "border-slate-600/50 text-slate-400"
                    )}>
                        {isMoving ? <Navigation className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                        <div className="flex flex-col leading-none items-start">
                            <span className="font-bold tracking-wider">
                                {isMoving ? 'RUTA' : 'QUIETO'}
                            </span>
                            {isMoving && (
                                <span className="text-[9px] font-mono opacity-70">
                                    {speedKmh} km/h
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
}
