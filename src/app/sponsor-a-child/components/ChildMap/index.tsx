"use client";
import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { Box } from "@chakra-ui/react";
import "mapbox-gl/dist/mapbox-gl.css";

interface ChildMapProps {
  childData: {
    id: string;
    name: string;
    location_geo: {
      coordinates: [number, number];
    };
    image: string;
    country: string;
  }[];
  onViewportChange: (bounds: { ne: number[]; sw: number[] }) => void;
  onMarkerClick: (id: string) => void;
}

const ChildMap: React.FC<ChildMapProps> = ({
  childData,
  onMarkerClick,
  onViewportChange,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v11", // Updated style
      center: [0, 0],
      zoom: 2,
    });

    mapInstance.current = map;

    const countries = childData.reduce((acc, child) => {
      if (!acc[child.country]) {
        acc[child.country] = child;
      }
      return acc;
    }, {} as Record<string, typeof childData[0]>);

    Object.values(countries).forEach((countryRepresentative) => {
      const coordinates = countryRepresentative.location_geo.coordinates;

      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        console.error(
          `Invalid coordinates for ${countryRepresentative.country}:`,
          coordinates
        );
        return;
      }

      const [lng, lat] = coordinates;

      const markerElement = document.createElement("div");
      markerElement.style.backgroundImage = "url('/CreatorSharePin.svg')";
      markerElement.style.backgroundSize = "contain";
      markerElement.style.width = "40px";
      markerElement.style.height = "40px";
      markerElement.style.cursor = "pointer";
      markerElement.style.backgroundRepeat = "no-repeat";


      markerElement.addEventListener("click", (event) => {
        event.stopPropagation();
        onMarkerClick(countryRepresentative.id);
      });

      new mapboxgl.Marker({ element: markerElement })
        .setLngLat([lng, lat])
        .addTo(map);
    });

    if (childData.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      childData.forEach((child) => {
        bounds.extend(child.location_geo.coordinates);
      });
      map.fitBounds(bounds, { padding: 50 });
    }

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [childData, onMarkerClick, onViewportChange]);

  return <Box ref={mapContainer} className="h-[571px] w-full mb-8 rounded-2xl" />;
};

export default ChildMap;
