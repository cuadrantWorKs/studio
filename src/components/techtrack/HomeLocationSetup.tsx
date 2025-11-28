'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Home, MapPin, CheckCircle } from 'lucide-react';
import { useGeolocation } from '@/hooks/useGeolocation';
import { LocationPoint } from '@/lib/techtrack/types';
import { useToast } from '@/hooks/use-toast';

interface HomeLocationSetupProps {
    technicianName: string;
}

export default function HomeLocationSetup({ technicianName }: HomeLocationSetupProps) {
    const { currentLocation } = useGeolocation();
    const { toast } = useToast();
    const [homeLocation, setHomeLocation] = useState<LocationPoint | null>(null);
    const [isSettingHome, setIsSettingHome] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem(`TECHTRACK_HOME_${technicianName}`);
        if (stored) {
            try {
                setHomeLocation(JSON.parse(stored));
            } catch (e) {
                console.error("Error loading home location", e);
            }
        }
    }, [technicianName]);

    const handleSetHomeLocation = () => {
        if (!currentLocation) {
            toast({ title: "Ubicación no disponible", description: "Esperando GPS...", variant: "destructive" });
            return;
        }
        setIsSettingHome(true);
        const homeData: LocationPoint = {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            timestamp: Date.now(),
            accuracy: currentLocation.accuracy,
        };
        localStorage.setItem(`TECHTRACK_HOME_${technicianName}`, JSON.stringify(homeData));
        setHomeLocation(homeData);
        toast({ title: "Ubicación de Casa Guardada", description: "La distancia de retorno se calculará desde aquí." });
        setTimeout(() => setIsSettingHome(false), 1000);
    };

    return (
        <Card className="mb-4">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Home className="h-5 w-5" />
                    Ubicación de Casa
                </CardTitle>
                <CardDescription>Para calcular la distancia de retorno desde el último trabajo.</CardDescription>
            </CardHeader>
            <CardContent>
                {homeLocation ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-green-600">
                            <CheckCircle className="h-4 w-4" />
                            <span className="text-sm">Casa configurada</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Lat: {homeLocation.latitude.toFixed(6)}, Lon: {homeLocation.longitude.toFixed(6)}
                        </div>
                        <Button variant="outline" size="sm" onClick={handleSetHomeLocation} disabled={!currentLocation}>
                            <MapPin className="mr-2 h-4 w-4" />
                            Actualizar Ubicación
                        </Button>
                    </div>
                ) : (
                    <Button onClick={handleSetHomeLocation} disabled={!currentLocation || isSettingHome}>
                        <Home className="mr-2 h-4 w-4" />
                        {isSettingHome ? 'Guardando...' : 'Guardar Ubicación Actual como Casa'}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
