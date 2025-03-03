import React, { useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import { Box, Text, Input, Flex } from "@chakra-ui/react";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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

// New component to handle map center updates
const MapController: React.FC<{ center: [number, number] }> = ({ center }) => {
  const map = useMap();
  React.useEffect(() => {
    map.setView(center, 8);
  }, [center, map]);
  return null;
};

const MapPicker: React.FC<MapPickerProps> = ({ onSelectLocation, initialLocation }) => {
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(
    initialLocation ? initialLocation.coordinates : null
  );
  const [searchQuery, setSearchQuery] = useState(initialLocation?.locationStr || "");
  const [isSearching, setIsSearching] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>(
    initialLocation?.coordinates || [0, 0]
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

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`
      );
      const data = await response.json();
      
      if (data && data[0]) {
        const { lat, lon } = data[0];
        const location: [number, number] = [parseFloat(lat), parseFloat(lon)];
        setMapCenter(location);
        setSelectedLocation(location);
        const { locationStr, country } = await fetchLocationData(location[0], location[1]);
        onSelectLocation(location, locationStr, country);
      }
    } catch (error) {
      console.error("Error searching location:", error);
    } finally {
      setIsSearching(false);
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
        <Flex gap={2} mb={2} width="100%">
          <Input
            placeholder="Search location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            px={4}
            py={2}
            borderRadius="lg"
            border="1px solid #e0e0e0"
          />
          <Button 
            onClick={handleSearch}
            disabled={isSearching}
            loading={isSearching}
            className="bg-black text-white text-center"
            px={4}
            py={2}
            textTransform="uppercase"
            fontWeight="bold"
            fontSize="sm"
            loadingText="Searching..."
          >
            Search
          </Button>
        </Flex>
        <div className="h-[300px] w-full">
          <MapContainer
            center={mapCenter}
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
            <MapController center={mapCenter} />
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
