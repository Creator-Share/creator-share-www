"use client";
import React, { useEffect, useRef, useState } from "react";
import { Box } from "@chakra-ui/react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SponsorPeople } from "@/types";

interface ChildLaborMapProps {
  childData: SponsorPeople[];
  onMarkerClick: (id: string) => void;
  onBoundsChange: (bounds: L.LatLngBounds) => void;
  onResetView: () => void;
  onFilterChange: (filters: any) => void;
}

const ChildLaborMap: React.FC<ChildLaborMapProps> = ({
  childData,
  onMarkerClick,
  onBoundsChange
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);

  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map("map", {
        center: [0, 0],
        zoom: 2,
        minZoom: 2,
        maxBounds: [
          [-90, -180],
          [90, 180],
        ],
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      mapRef.current = map;

      map.on("moveend", () => {
        const bounds = map.getBounds();
        onBoundsChange(bounds);
      });

      return () => {
        map.remove();
        mapRef.current = null;
      };
    }
  }, [onBoundsChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((marker) => {
      marker.remove();
    });
    markersRef.current = {};

    const markers: L.Marker[] = [];
    const validChildren = childData.filter((child) => child.location_geo);

    validChildren.forEach((child) => {
      if (!child.location_geo) return;

      const [lng, lat] = child.location_geo.coordinates;
      const customIcon = L.divIcon({
        className: "custom-marker",
        html: `
          <div class="${
            selectedMarkerId === child.id
              ? "bg-blue-500 border-blue-600"
              : "bg-red-500 border-red-600"
          } w-4 h-4 rounded-full border-2 transform -translate-x-2 -translate-y-2"></div>
        `,
      });

      const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
      marker.on("click", () => {
        setSelectedMarkerId(child.id);
        onMarkerClick(child.id);
      });

      markers.push(marker);
      markersRef.current[child.id] = marker;
    });

    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds(), { padding: [50, 50] });
    }
  }, [childData, onMarkerClick, selectedMarkerId]);

  return (
    <Box
      id="map"
      height="400px"
      width="100%"
      borderRadius="xl"
      overflow="hidden"
      position="relative"
      className="shadow-md"
    />
  );
};

export default ChildLaborMap;
