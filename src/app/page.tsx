'use client';

import React, { useState } from 'react';
import { TechTrackApp } from '@/components/techtrack/TechTrackApp';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function Page() {
  const [tech, setTech] = useState<string | null>(null);
  const [startApp, setStartApp] = useState(false);
  
  console.log('🏠 Page mounted:', { tech, startApp });

  // If technician is selected, render TechTrackApp
  if (startApp && tech) {
    return <TechTrackApp technicianName={tech} />;
  }

  // Define a handler function for onValueChange to ensure correct type
  const handleTechChange = (value: string) => {
    setTech(value === '' ? null : value); // Convert empty string back to null if needed
  };

  // Otherwise, render the welcome/selector UI
  return (
    <>
    <Card className="max-w-md mx-auto mt-20 p-6">
      <CardHeader>
        <CardTitle>Bienvenido a TechTrack</CardTitle>
        <CardDescription>Seleccione su perfil para iniciar la jornada.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="tech">Técnico</Label>
          <Select onValueChange={handleTechChange} value={tech ?? ''}>
            <SelectValue placeholder="Selecciona técnico" />
            <SelectTrigger></SelectTrigger> {/* Add SelectTrigger */}
          <SelectContent>
            <SelectItem value="RICARDO">RICARDO</SelectItem>
            {/* Agrega más técnicos si es necesario */}
          </SelectContent>
        </Select>
        </div>
      </CardContent>
      <CardFooter>
        <Button disabled={!tech} onClick={() => setStartApp(true)} className="w-full">
          Continuar como {tech}
        </Button>
      </CardFooter>
    </Card>
    </>
  );
}
