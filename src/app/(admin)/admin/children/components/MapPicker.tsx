"use client";

import React, { useState } from "react";
import { Box, Input } from "@chakra-ui/react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Field } from "@/components/ui/field";

interface MapPickerProps {
  onSelectLocation: (geo: [number, number], locationStr: string, country: string) => void;
  initialLocation?: {
    coordinates: [number, number];
    locationStr: string;
    country: string;
  };
}

const CustomIcon = L.divIcon({
  html: `<div style="background: transparent; border: none;">
           <img src="/CreatorSharePin.svg" alt="Location Marker" style="width: 30px; height: 30px;" />
         </div>`,
  className: "custom-marker-no-numbers",
  iconSize: [30, 30],
  iconAnchor: [15, 30]
});

const MapClickHandler: React.FC<{
  onMapClick: (e: L.LeafletMouseEvent) => void;
}> = ({ onMapClick }) => {
  useMapEvents({
    click: onMapClick,
  });
  return null;
};

const MapPicker: React.FC<MapPickerProps> = ({ onSelectLocation, initialLocation }) => {
  const [markerPosition, setMarkerPosition] = useState<[number, number] | null>(
    initialLocation ? [initialLocation.coordinates[0], initialLocation.coordinates[1]] : null
  );
  const [locationStr, setLocationStr] = useState(initialLocation?.locationStr || "");
  const [isLoading, setIsLoading] = useState(false);

  const handleMapClick = async (e: L.LeafletMouseEvent) => {
    const { lat, lng } = e.latlng;
    try {
      setIsLoading(true);
      const response = await fetch(
        `/api/geocoding/reverse?lat=${lat}&lon=${lng}`
      );
      const data = await response.json();
      if (data && data.display_name) {
        setMarkerPosition([lat, lng]);
        setLocationStr(data.display_name);
        onSelectLocation([lat, lng], data.display_name, data.address.country);
      }
    } catch (error) {
      console.error("Error reverse geocoding:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box>
      <Field label="Selected Location">
        <Input
          type="text"
          value={locationStr}
          readOnly
          placeholder={isLoading ? "Getting location..." : "Click on the map to select location"}
          className="border"
          px={2}
        />
      </Field>
      <Box height="400px" className="mt-4 rounded-xl overflow-hidden">
        <MapContainer
          center={markerPosition || [0, 0]}
          zoom={markerPosition ? 13 : 2}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.maptiler.com/">MapTiler</a>'
            url={`https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=Wm5rwQ7T3kAi2Z07eCBa&lang=en`}
          />
          <MapClickHandler onMapClick={handleMapClick} />
          {markerPosition && (
            <Marker
              position={markerPosition}
              icon={CustomIcon}
            />
          )}
        </MapContainer>
      </Box>
    </Box>
  );
};

export default MapPicker;
