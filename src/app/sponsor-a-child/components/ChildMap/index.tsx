"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Box, Button } from "@chakra-ui/react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-markercluster";
import L, { LatLngBounds, MarkerCluster } from "leaflet";
import "leaflet/dist/leaflet.css";
import { ChildMapProps } from "@/types/propTypes";
import Filters from "../Filters";

const ANIMATION_DURATION = 1;

const CustomIcon = L.divIcon({
  html: `<div style="background: transparent; border: none;">
           <img src="/CreatorSharePin.svg" alt="Child Marker" style="width: 30px; height: 30px;" />
         </div>`,
  className: "custom-child-marker-no-numbers",
  iconSize: [30, 30],
  iconAnchor: [15, 30]
});

const createClusterCustomIcon = (cluster: MarkerCluster): L.DivIcon => {
  const count = cluster.getChildCount();
  if (count <= 0) return CustomIcon;
  
  return L.divIcon({
    html: `
        <div style="position: relative; display: flex; align-items: center; justify-content: center; background: transparent; border: none;">
          <img src="/CreatorSharePin.svg" alt="Cluster Icon" style="width: 30px; height: 30px;" />
          <span style="position: absolute; top: -5px; right: -5px; background: white; border-radius: 50%; padding: 2px 6px; font-size: 12px; font-weight: bold; color: black; min-width: 20px; text-align: center;">
            ${count}
          </span>
        </div>
      `,
    className: "custom-cluster-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
};

const MapEventHandler: React.FC<{ onBoundsChange: (bounds: LatLngBounds) => void }> = ({ onBoundsChange }) => {
  const map = useMap();
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const savedState = localStorage.getItem("mapState");
    if (savedState) {
      const { center, zoom } = JSON.parse(savedState);
      map.setView(center, zoom, {
        animate: true,
        duration: ANIMATION_DURATION
      });
    }
    const updateBounds = () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      
      updateTimeoutRef.current = setTimeout(() => {
        onBoundsChange(map.getBounds());
        localStorage.setItem(
          "mapState",
          JSON.stringify({
            center: map.getCenter(),
            zoom: map.getZoom(),
          })
        );
      }, 300);
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
      position: 'topright',
      zoomInTitle: 'Zoom in',
      zoomOutTitle: 'Zoom out'
    });
    
    zoomControl.addTo(map);

    map.options.zoomAnimation = true;
    
    const zoomControlContainer = document.querySelector('.leaflet-control-zoom');
    if (zoomControlContainer) {
      const container = zoomControlContainer as HTMLElement;
      container.style.marginBottom = '80px';
      container.style.marginRight = '20px';

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

interface ExtendedChildMapProps extends ChildMapProps {
  onFilterChange: (filters: Partial<{
    gender: string;
    ageRange: [number, number];
    status: string[];
  }>) => void;
}

const ChildMap: React.FC<ExtendedChildMapProps> = ({ 
  childData, 
  onMarkerClick, 
  onBoundsChange, 
  onResetView,
  onFilterChange 
}) => {
  const [isReady, setIsReady] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const [showFilters, setShowFilters] = useState(true);

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
    console.log("ChildMap received:", childData.length, "children");
    if (!childData || childData.length === 0) {
      return [];
    }
    
    const validChildren = childData.filter(child => 
      child && 
      child.location_geo && 
      child.location_geo.coordinates && 
      child.location_geo.coordinates.length === 2 &&
      typeof child.location_geo.coordinates[0] === 'number' &&
      typeof child.location_geo.coordinates[1] === 'number' &&
      child.name && child.name.trim() !== '' &&
      child.country && child.country.trim() !== ''
    );
    
    console.log("Valid children after filtering:", validChildren.length);
    
    return validChildren.map((child) => (
      <Marker
        key={child.id}
        position={[child.location_geo.coordinates[1], child.location_geo.coordinates[0]]}
        icon={CustomIcon}
        eventHandlers={{
          click: () => handleMarkerClick(child.id),
        }}
      >
        <Tooltip direction="top">
          {child.name || 'Unknown'} - {child.country || 'Unknown'}
        </Tooltip>
      </Marker>
    ));
  }, [childData, handleMarkerClick]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      .leaflet-marker-icon::before,
      .leaflet-marker-icon::after,
      .custom-child-marker-no-numbers span {
        display: none !important;
      }
      .custom-child-marker-no-numbers {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
      }
      .custom-child-marker-no-numbers::before,
      .custom-child-marker-no-numbers::after {
        display: none !important;
      }
      /* Make sure cluster counts ARE visible */
      .custom-cluster-icon span {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    if (mapRef.current && (!childData || childData.length === 0)) {
      const map = mapRef.current;
      map.eachLayer((layer) => {
        if (!(layer instanceof L.TileLayer)) {
          map.removeLayer(layer);
        }
      });
      const tileLayer = L.tileLayer(
        `https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=Wm5rwQ7T3kAi2Z07eCBa&lang=en`,
        {
          attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a>'
        }
      );
      tileLayer.addTo(map);
    }
  }, [childData]);

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
        {childData && childData.length > 0 ? (
          <MarkerClusterGroup 
            key={`cluster-${childData.length}-${childData.map(c => c.id).join('-')}`}
            chunkedLoading
            maxClusterRadius={150}
            showCoverageOnHover={false}
            spiderfyOnMaxZoom={true}
            iconCreateFunction={createClusterCustomIcon}
            animate={true}
          >
            {MemoizedMarkers}
          </MarkerClusterGroup>
        ) : null}
      </MapContainer>
      
      <Box 
        position="absolute" 
        top={4} 
        left={4} 
        zIndex={1000}
      >
        <Button 
          size="sm" 
          className="bg-white text-dark px-4 shadow-md"
          onClick={() => setShowFilters(!showFilters)}
        >
          {showFilters ? "Hide Filters" : "Filter Children"}
        </Button>
      </Box>
      
      {showFilters && (
        <Box 
          position="absolute" 
          top={16} 
          left={4} 
          zIndex={1000}
          className="bg-transparent bg-opacity-95 backdrop-blur-sm p-4 rounded-xl shadow-md"
          width="300px"
          maxHeight="80%"
          overflowY="auto"
        >
          <Filters
            onFilterChange={onFilterChange}
            variant="sidebar"
          />
        </Box>
      )}
    </Box>
  );
};

export default ChildMap;
