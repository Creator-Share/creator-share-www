"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Box, Button } from "@chakra-ui/react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-markercluster";
import L, { LatLngBounds, MarkerCluster } from "leaflet";
import "leaflet/dist/leaflet.css";
import { ChildMapProps } from "@/types/propTypes";

// Animation duration in seconds
const ANIMATION_DURATION = 1;

const CustomIcon = L.icon({
  iconUrl: "/CreatorSharePin.svg",
  iconSize: [30, 30],
  iconAnchor: [15, 30],
});

const createClusterCustomIcon = (cluster: MarkerCluster): L.DivIcon => {
  const count = cluster.getChildCount();
  return L.divIcon({
    html: `
        <div style="position: relative; display: flex; align-items: center; justify-content: center;">
          <img src="/CreatorSharePin.svg" alt="Cluster Icon" style="width: 30px; height: 30px;" />
          <span style="position: absolute; top: 0; right: 0; background: white; border-radius: 50%; padding: 2px 6px; font-size: 12px; font-weight: bold; color: black;">
            ${count}
          </span>
        </div>
      `,
    className: "custom-cluster-icon",
    iconSize: [10, 10],
  });
};

const MapEventHandler: React.FC<{ onBoundsChange: (bounds: LatLngBounds) => void }> = ({ onBoundsChange }) => {
  const map = useMap();

  useEffect(() => {
    const savedState = localStorage.getItem("mapState");
    if (savedState) {
      const { center, zoom } = JSON.parse(savedState);
      // Add animation to initial view setting
      map.setView(center, zoom, {
        animate: true,
        duration: ANIMATION_DURATION
      });
    }
    const updateBounds = () => {
      onBoundsChange(map.getBounds());
      localStorage.setItem(
        "mapState",
        JSON.stringify({
          center: map.getCenter(),
          zoom: map.getZoom(),
        })
      );
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
      map.fitBounds(bounds, { 
        padding: [50, 50],
        animate: true,
        duration: ANIMATION_DURATION
      });
    } else {
      map.setView([0, 0], 2, {
        animate: true,
        duration: ANIMATION_DURATION
      });
    }
  }, [childData, map]);

  return null;
};

const ZoomController: React.FC<{ 
  childData: ChildMapProps["childData"],
  onBoundsChange: (bounds: LatLngBounds) => void,
  onResetView?: () => void
}> = ({ childData, onBoundsChange, onResetView }) => {
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

  const handleResetView = () => {
    localStorage.removeItem("mapState");

    if (childData.length > 0) {
      const bounds = L.latLngBounds(
        childData.map((child) => [
          child.location_geo.coordinates[1],
          child.location_geo.coordinates[0],
        ])
      );
      map.fitBounds(bounds, { 
        padding: [50, 50],
        animate: true,
        duration: ANIMATION_DURATION
      });
      onBoundsChange(bounds);
    } else {
      map.setView([0, 0], 2, {
        animate: true,
        duration: ANIMATION_DURATION
      });
    }
    if (onResetView) onResetView();
  };

  return showReset ? (
    <Box position="absolute" bottom={4} left={4} zIndex={1000}>
      <Button size="sm" className="bg-white text-dark px-8" onClick={handleResetView}>
        View All Children
      </Button>
    </Box>
  ) : null;
};

const CustomZoomControl = () => {
  const map = useMap();
  
  useEffect(() => {

    if (map.zoomControl) {
      map.zoomControl.remove();
    }

    const zoomControl = L.control.zoom({
      position: 'bottomleft',
      zoomInTitle: 'Zoom in',
      zoomOutTitle: 'Zoom out'
    });
    
    zoomControl.addTo(map);

    map.options.zoomAnimation = true;
    
    const zoomControlContainer = document.querySelector('.leaflet-control-zoom');
    if (zoomControlContainer) {
      const container = zoomControlContainer as HTMLElement;
      container.style.marginBottom = '80px';
      container.style.marginLeft = '20px';

      const zoomInButton = container.querySelector('.leaflet-control-zoom-in');
      const zoomOutButton = container.querySelector('.leaflet-control-zoom-out');
      
      if (zoomInButton) {
        zoomInButton.addEventListener('click', () => {
          const currentZoom = map.getZoom();
          map.setZoom(currentZoom + 1, {
            animate: true,
            duration: ANIMATION_DURATION
          });
        });
      }
      
      if (zoomOutButton) {
        zoomOutButton.addEventListener('click', () => {
          const currentZoom = map.getZoom();
          map.setZoom(currentZoom - 1, {
            animate: true,
            duration: ANIMATION_DURATION
          });
        });
      }
    }
    
    return () => {
      zoomControl.remove();
    };
  }, [map]);
  
  return null;
};

const ChildMap: React.FC<ChildMapProps> = ({ childData, onMarkerClick, onBoundsChange, onResetView }) => {
  const [isReady, setIsReady] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  const handleMarkerClick = useCallback((id: string) => {
    const child = childData.find(c => c.id === id);
    if (child && mapRef.current) {
      const { coordinates } = child.location_geo;
      mapRef.current.setView([coordinates[1], coordinates[0]], 12, {
        animate: true,
        duration: ANIMATION_DURATION
      });
    }
    onMarkerClick(id);
  }, [childData, onMarkerClick]);

  const checkChildrenInView = useCallback(() => {
    if (!mapRef.current) return;
    
    const currentBounds = mapRef.current.getBounds();
    const childrenInView = childData.filter(child => {
      const childLatLng = L.latLng(
        child.location_geo.coordinates[1], 
        child.location_geo.coordinates[0]
      );
      return currentBounds.contains(childLatLng);
    });

    if (childrenInView.length === 0 && childData.length > 0) {
      const firstChild = childData[0];
      mapRef.current.setView(
        [firstChild.location_geo.coordinates[1], firstChild.location_geo.coordinates[0]],
        mapRef.current.getZoom(),
        { animate: true, duration: 1 }
      );
    }
  }, [childData]);

  useEffect(() => {
    if (mapRef.current) {
      const map = mapRef.current;
      
      const handleMoveEnd = () => {
        checkChildrenInView();
      };
      
      map.on('moveend', handleMoveEnd);
      
      return () => {
        map.off('moveend', handleMoveEnd);
      };
    }
  }, [checkChildrenInView]);

  const MemoizedMarkers = useMemo(() => {
    return childData.map((child) => (
      <Marker
        key={child.id}
        position={[child.location_geo.coordinates[1], child.location_geo.coordinates[0]]}
        icon={CustomIcon}
        eventHandlers={{
          click: () => handleMarkerClick(child.id),
        }}
      >
        <Tooltip direction="top">
          {child.name} - {child.country}
        </Tooltip>
      </Marker>
    ));
  }, [childData, handleMarkerClick]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsReady(true);
    }
  }, []);

  if (!isReady) {
    return <Box>Loading map...</Box>;
  }

  return (
    <Box className="h-[932px] md:h-[450px] w-full mb-8 rounded-xl relative">
      <MapContainer
        ref={mapRef}
        center={[0, 0]}
        zoom={2}
        scrollWheelZoom
        className="h-full w-full rounded-xl"
        minZoom={2}
        maxZoom={18}
        maxBounds={L.latLngBounds([-90, -180], [90, 180])}
        maxBoundsViscosity={1.0}
        zoomControl={false}
        zoomAnimation={true}
        fadeAnimation={true}
        markerZoomAnimation={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.maptiler.com/">MapTiler</a>'
          url={`https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=Wm5rwQ7T3kAi2Z07eCBa&lang=en`}
        />
        <MapEventHandler onBoundsChange={onBoundsChange} />
        <FitBounds childData={childData} />
        <CustomZoomControl />
        <ZoomController
          childData={childData}
          onBoundsChange={onBoundsChange}
          onResetView={onResetView}
        />
        <MarkerClusterGroup 
          chunkedLoading
          maxClusterRadius={10}
          showCoverageOnHover={false}
          spiderfyOnMaxZoom={true}
          iconCreateFunction={createClusterCustomIcon}
          animate={true}
        >
          {MemoizedMarkers}
        </MarkerClusterGroup>
      </MapContainer>
    </Box>
  );
};

export default ChildMap;
