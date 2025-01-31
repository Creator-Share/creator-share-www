"use client";

import React, { useEffect, useState } from "react";
import { Box, Button } from "@chakra-ui/react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-markercluster";
import L, { LatLngBounds, MarkerCluster } from "leaflet";
import "leaflet/dist/leaflet.css";

const CustomIcon = L.icon({
  iconUrl: "/CreatorSharePin.svg",
  iconSize: [40, 40],
  iconAnchor: [20, 40],
});

const createClusterCustomIcon = (cluster: MarkerCluster): L.DivIcon => {
    const count = cluster.getChildCount();
    return L.divIcon({
      html: `
        <div style="position: relative; display: flex; align-items: center; justify-content: center;">
          <img src="/CreatorSharePin.svg" alt="Cluster Icon" style="width: 40px; height: 40px;" />
          <span style="position: absolute; top: 0; right: 0; background: white; border-radius: 50%; padding: 2px 6px; font-size: 12px; font-weight: bold; color: black;">
            ${count}
          </span>
        </div>
      `,
      className: "custom-cluster-icon",
      iconSize: [40, 40],
    });
  };

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
  onMarkerClick: (id: string) => void;
  onBoundsChange: (bounds: LatLngBounds) => void;
}

const MapEventHandler: React.FC<{ onBoundsChange: (bounds: LatLngBounds) => void }> = ({ onBoundsChange }) => {
  const map = useMap();

  useEffect(() => {
    const updateBounds = () => {
      onBoundsChange(map.getBounds());
    };

    map.on("moveend", updateBounds);
    map.on("zoomend", updateBounds);

    return () => {
      map.off("moveend", updateBounds);
      map.off("zoomend", updateBounds);
    };
  }, [map, onBoundsChange]);

  return null;
};

const FitBounds: React.FC<{ childData: ChildMapProps["childData"] }> = ({ childData }) => {
  const map = useMap();

  useEffect(() => {
    if (childData.length > 0) {
      const bounds = L.latLngBounds(
        childData.map((child) => [
          child.location_geo.coordinates[1],
          child.location_geo.coordinates[0],
        ])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    } else {
      map.setView([0, 0], 2);
    }
  }, [childData, map]);

  return null;
};

const ZoomController: React.FC = () => {
  const map = useMap();
  const [showReset, setShowReset] = useState(false);

  useEffect(() => {
    const handleZoom = () => {
      setShowReset(map.getZoom() > 2);
    };

    map.on("zoomend", handleZoom);
    return () => {
      map.off("zoomend", handleZoom);
    };
  }, [map]);

  return showReset ? (
    <Box position="absolute" top={4} right={4} zIndex={1000}>
      <Button
        size="sm"
        className="bg-white text-dark px-8"
        onClick={() => map.setView([0, 0], 2)}
      >
        View All Children
      </Button>
    </Box>
  ) : null;
};

const ChildMap: React.FC<ChildMapProps> = ({ childData, onMarkerClick, onBoundsChange }) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsReady(true);
    }
  }, []);

  if (!isReady) {
    return <Box>Loading map...</Box>;
  }

  return (
    <Box className="h-[571px] w-full mb-8 rounded-2xl relative">
      <MapContainer center={[0, 0]} zoom={2} scrollWheelZoom className="h-full w-full rounded-2xl">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MarkerClusterGroup chunkedLoading disableClusteringAtZoom={10} iconCreateFunction={createClusterCustomIcon}>
          {childData.map((child) => (
            <Marker
              key={child.id}
              position={[child.location_geo.coordinates[1], child.location_geo.coordinates[0]]}
              icon={CustomIcon}
              eventHandlers={{
                click: () => onMarkerClick(child.id),
              }}
            >
              <Tooltip direction="top">
                {child.name} - {child.country}
              </Tooltip>
            </Marker>
          ))}
        </MarkerClusterGroup>

        <MapEventHandler onBoundsChange={onBoundsChange} />
        <FitBounds childData={childData} />
        <ZoomController />
      </MapContainer>
    </Box>
  );
};

export default ChildMap;
