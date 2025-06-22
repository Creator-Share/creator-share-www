import React, { useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import { Box, Text, Input, Flex } from "@chakra-ui/react";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { toaster } from "@/components/ui/toaster";

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
  const [isError, setIsError] = useState(false);
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
    setIsError(false);
    
    try {
      let location: [number, number] | null = null;

      try {
        const nominatimResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`
        );
        const nominatimData = await nominatimResponse.json();
        
        if (nominatimData && nominatimData.length > 0) {
          const { lat, lon } = nominatimData[0];
          location = [parseFloat(lat), parseFloat(lon)];
        }
      } catch (error) {
        console.error("Error with Nominatim search:", error);
      }
      if (!location) {
        try {
          const photonResponse = await fetch(
            `https://photon.komoot.io/api/?q=${encodeURIComponent(searchQuery)}&limit=1`
          );
          const photonData = await photonResponse.json();
          
          if (photonData && photonData.features && photonData.features.length > 0) {
            const coordinates = photonData.features[0].geometry.coordinates;
            location = [coordinates[1], coordinates[0]];
          }
        } catch (error) {
          console.error("Error with Photon search:", error);
        }
      }
      if (!location && searchQuery.includes('+')) {
        const parts = searchQuery.split(',');
        if (parts.length > 1) {
          const countryPart = parts[parts.length - 1].trim();
          try {
            const countryResponse = await fetch(
              `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(countryPart)}&format=json&limit=1`
            );
            const countryData = await countryResponse.json();
            
            if (countryData && countryData.length > 0) {
              const { lat, lon } = countryData[0];
              location = [parseFloat(lat), parseFloat(lon)];
              
              toaster.create({
                title: "Approximate Location",
                description: `Showing approximate location for "${searchQuery}". You can click on the map to refine the position.`,
                duration: 5000,
              });
            }
          } catch (error) {
            console.error("Error with country search:", error);
          }
        }
      }
      
      if (location) {
        setMapCenter(location);
        setSelectedLocation(location);
        const { locationStr, country } = await fetchLocationData(location[0], location[1]);
        onSelectLocation(location, locationStr, country);
      } else {
        setIsError(true);
        toaster.create({
          title: "Location Not Found",
          description: "Could not find the specified location. Try a different search term or format, or click directly on the map.",
          duration: 5000,
        });
      }
    } catch (error) {
      console.error("Error searching location:", error);
      setIsError(true);
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
        setIsError(false);
      },
    });

    return null;
  };

  return (
    <Box>
      <Field label="Location">
        <Flex gap={2} mb={2} width="100%">
          <Input
            placeholder="Search location or click on map..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            px={4}
            py={2}
            borderRadius="lg"
            border={isError ? "1px solid red" : "1px solid #e0e0e0"}
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
        {isError && (
          <Text color="red.500" fontSize="sm" mb={2}>
            Location not found. Try a different search term or click directly on the map.
          </Text>
        )}
        <div className="h-[300px] w-full">
          <MapContainer
            center={mapCenter}
            zoom={initialLocation ? 8 : 2}
            scrollWheelZoom
            className="h-full w-full rounded-xl"
            minZoom={0.6}
            maxZoom={18}
            maxBounds={L.latLngBounds([-90, -180], [90, 180])}
            maxBoundsViscosity={1.0}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.maptiler.com/">MapTiler</a>'
              url={`https://api.maptiler.com/maps/bright-v2/{z}/{x}/{y}.png?key=Wm5rwQ7T3kAi2Z07eCBa&lang=en`}
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
        <Text mt={1} fontSize="sm" color="gray.500">
          Tip: If your exact location isn't found, try searching for a nearby city or landmark, then click on the map to refine the position.
        </Text>
      </Field>
    </Box>
  );
};

export default MapPicker;
