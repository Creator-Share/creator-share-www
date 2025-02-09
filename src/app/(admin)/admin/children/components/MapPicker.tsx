import React, { useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import { Box, Text } from "@chakra-ui/react";
import { Field } from "@/components/ui/field";

const customIcon = L.icon({
  iconUrl: "/CreatorSharePin.svg",
  iconSize: [40, 40],
  iconAnchor: [20, 40],
});

interface MapPickerProps {
  onSelectLocation: (geo: [number, number], locationStr: string, country: string) => void;
  initialLocation?: {
    coordinates: [number, number];
    locationStr: string;
    country: string;
  };
}

const MapPicker: React.FC<MapPickerProps> = ({ onSelectLocation, initialLocation }) => {
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(
    initialLocation ? initialLocation.coordinates : null
  );

  const fetchLocationData = async (lat: number, lng: number) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
      );
      const data = await response.json();

      const locationStr = data?.display_name || "Unknown Location";
      const country = data?.address?.country || "Unknown Country";

      return { locationStr, country };
    } catch (error) {
      console.error("Error fetching location data:", error);
      return { locationStr: "Unknown Location", country: "Unknown Country" };
    }
  };

  const MapEventHandler: React.FC = () => {
    useMapEvents({
      click: async (e) => {
        const location = [e.latlng.lat, e.latlng.lng] as [number, number];
        setSelectedLocation(location);
        const { locationStr, country } = await fetchLocationData(location[0], location[1]);
        onSelectLocation(location, locationStr, country);
      },
    });

    return null;
  };

  return (
    <Box>
      <Field label="Location">
        <div className="h-[300px] w-full">
          <MapContainer
            center={initialLocation?.coordinates || [0, 0]}
            zoom={initialLocation ? 8 : 2}
            scrollWheelZoom
            className="h-full w-full rounded-2xl"
            minZoom={0.6}
            maxZoom={18}
            maxBounds={L.latLngBounds([-90, -180], [90, 180])}
            maxBoundsViscosity={1.0}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.maptiler.com/">MapTiler</a>'
              url={`https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=Wm5rwQ7T3kAi2Z07eCBa&lang=en`}
            />
            {selectedLocation && (
              <Marker position={selectedLocation} icon={customIcon} />
            )}
            <MapEventHandler />
          </MapContainer>
        </div>
        {selectedLocation && (
          <Text mt={2} fontSize="sm" color="gray.600">
            Selected Location: {selectedLocation[0].toFixed(5)}, {selectedLocation[1].toFixed(5)}
          </Text>
        )}
      </Field>
    </Box>
  );
};

export default MapPicker;
