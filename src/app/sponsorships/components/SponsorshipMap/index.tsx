"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Box, Button } from "@chakra-ui/react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-markercluster";
import L, { LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import { BeneficiaryMapProps } from "@/types/propTypes";
import Filters from "../Filters";

const ANIMATION_DURATION = 1;

const createCustomIcon = () => L.divIcon({
  html: `<div style="background: transparent; border: none;">
           <img src="/CreatorSharePin.svg" alt="Beneficiary Marker" style="width: 30px; height: 30px;" />
         </div>`,
  className: "custom-child-marker-no-numbers",
  iconSize: [30, 30],
  iconAnchor: [15, 30]
});

/**
 * iconCreateFunction for MarkerClusterGroup expects a cluster argument with getChildCount().
 * The type is any because react-leaflet-markercluster does not export the correct type.
 */
const createClusterCustomIcon = (cluster: L.MarkerCluster): L.DivIcon => {
  const count = cluster.getChildCount();
  if (count <= 0) return createCustomIcon();

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

const FitBounds: React.FC<{ beneficiaryData: BeneficiaryMapProps["beneficiaryData"] }> = ({ beneficiaryData }) => {
  const map = useMap();

  useEffect(() => {
    if (beneficiaryData.length > 0) {
      const validCoords = beneficiaryData
        .filter(child => child.location_geo && Array.isArray(child.location_geo.coordinates))
        .map(child => [
          child.location_geo!.coordinates[1],
          child.location_geo!.coordinates[0],
        ]);
      if (validCoords.length > 0) {
        const bounds = L.latLngBounds(validCoords as [number, number][]);
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
    } else {
      map.setView([0, 0], 2, {
        animate: true,
        duration: ANIMATION_DURATION
      });
    }
  }, [beneficiaryData, map]);

  return null;
};

const ZoomController: React.FC<{ 
  beneficiaryData: BeneficiaryMapProps["beneficiaryData"],
  onBoundsChange: (bounds: LatLngBounds) => void,
  onResetView?: () => void,
  beneficiaryType?: "CHILD" | "ANIMAL"
}> = ({ beneficiaryData, onBoundsChange, onResetView, beneficiaryType = "CHILD" }) => {
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

    if (beneficiaryData.length > 0) {
      const validCoords = beneficiaryData
        .filter(child => child.location_geo && Array.isArray(child.location_geo.coordinates))
        .map(child => [
          child.location_geo!.coordinates[1],
          child.location_geo!.coordinates[0],
        ]);
      if (validCoords.length > 0) {
        const bounds = L.latLngBounds(validCoords as [number, number][]);
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
        View All {beneficiaryType === "ANIMAL" ? "Animals" : "Children"}
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

// New component for handling two-finger scrolling and touch gestures
const TouchGestureHandler: React.FC = () => {
  const map = useMap();
  const touchStartRef = useRef<{ x: number; y: number; distance: number; center: { x: number; y: number } } | null>(null);
  const isPinchingRef = useRef(false);

  useEffect(() => {
    const mapContainer = map.getContainer();

    // --- Two-finger scroll logic ---
    // Disable dragging by default on touch devices, enable only with two fingers
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    if (isTouchDevice) {
      map.dragging.disable();
    }

    const getDistance = (touches: TouchList): number => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getCenter = (touches: TouchList): { x: number; y: number } => {
      if (touches.length < 2) return { x: 0, y: 0 };
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
      };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isTouchDevice) {
        if (e.touches.length === 2) {
          map.dragging.enable();
        } else {
          map.dragging.disable();
        }
      }
      if (e.touches.length === 2) {
        isPinchingRef.current = true;
        touchStartRef.current = {
          x: getCenter(e.touches).x,
          y: getCenter(e.touches).y,
          distance: getDistance(e.touches),
          center: getCenter(e.touches)
        };
        // Prevent default to avoid conflicts with Leaflet's touch handling
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isTouchDevice) {
        if (e.touches.length === 2) {
          map.dragging.enable();
        } else {
          map.dragging.disable();
        }
      }
      if (e.touches.length === 2 && touchStartRef.current && isPinchingRef.current) {
        const currentDistance = getDistance(e.touches);
        const currentCenter = getCenter(e.touches);

        // Calculate zoom change
        const scale = currentDistance / touchStartRef.current.distance;
        const zoomChange = Math.log2(scale);

        // Get the center point in map coordinates
        const containerPoint = L.point(currentCenter.x, currentCenter.y);
        const latlng = map.containerPointToLatLng(containerPoint);

        // Apply zoom
        const newZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + zoomChange));
        map.setZoom(newZoom, { animate: false });

        // Update the center to maintain the pinch center point
        const newContainerPoint = map.latLngToContainerPoint(latlng);
        const offset = L.point(currentCenter.x - newContainerPoint.x, currentCenter.y - newContainerPoint.y);
        const newLatLng = map.containerPointToLatLng(newContainerPoint.add(offset));
        map.panTo(newLatLng, { animate: false });

        // Update touch start reference
        touchStartRef.current = {
          x: currentCenter.x,
          y: currentCenter.y,
          distance: currentDistance,
          center: currentCenter
        };

        e.preventDefault();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isTouchDevice) {
        if (e.touches.length < 2) {
          map.dragging.disable();
        }
      }
      if (e.touches.length < 2) {
        isPinchingRef.current = false;
        touchStartRef.current = null;
      }
    };

    // Add touch event listeners
    mapContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
    mapContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    mapContainer.addEventListener('touchend', handleTouchEnd, { passive: false });

    // Enable touch gestures in Leaflet
    map.touchZoom.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();

    // Set min/max zoom for better mobile experience
    map.setMinZoom(2);
    map.setMaxZoom(18);

    return () => {
      mapContainer.removeEventListener('touchstart', handleTouchStart);
      mapContainer.removeEventListener('touchmove', handleTouchMove);
      mapContainer.removeEventListener('touchend', handleTouchEnd);
      if (isTouchDevice) {
        map.dragging.enable(); // Restore dragging for non-touch devices
      }
    };
  }, [map]);

  return null;
};

interface ExtendedBeneficiaryMapProps extends BeneficiaryMapProps {
  onFilterChange: (filters: Partial<{
    gender: string;
    ageRange: [number, number];
    status: string[];
  }>) => void;
  beneficiaryType?: "CHILD" | "ANIMAL";
}

const BeneficiaryMap: React.FC<ExtendedBeneficiaryMapProps> = ({ 
  beneficiaryData, 
  onMarkerClick, 
  onBoundsChange, 
  onResetView,
  onFilterChange,
  beneficiaryType = "CHILD"
}) => {
  const [isReady, setIsReady] = useState(false);
  const leafletMapRef = useRef<L.Map | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const handleMarkerClick = useCallback((id: string) => {
    const beneficiary = beneficiaryData.find((b) => b.id === id);
    const mapInstance = leafletMapRef.current;
    if (beneficiary && beneficiary.location_geo && mapInstance) {
      const { coordinates } = beneficiary.location_geo;
      mapInstance.setView([coordinates[1], coordinates[0]], 12, {
        animate: true,
        duration: ANIMATION_DURATION
      });

      // Wait for the map animation to complete before scrolling to the beneficiary
      setTimeout(() => {
        const element = document.getElementById(id);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, ANIMATION_DURATION * 1000 + 100); // Add a small buffer after the map animation
    }
    onMarkerClick(id);
  }, [beneficiaryData, onMarkerClick]);

  const checkBeneficiariesInView = useCallback(() => {
    const mapInstance = leafletMapRef.current;
    if (!mapInstance) return;

    const currentBounds = mapInstance.getBounds();
    const beneficiariesInView = beneficiaryData.filter((beneficiary) => {
      if (!beneficiary.location_geo) return false;
      const beneficiaryLatLng = L.latLng(
        beneficiary.location_geo.coordinates[1], 
        beneficiary.location_geo.coordinates[0]
      );
      return currentBounds.contains(beneficiaryLatLng);
    });

    if (beneficiariesInView.length === 0 && beneficiaryData.length > 0) {
      const firstBeneficiary = beneficiaryData[0];
      if (firstBeneficiary.location_geo) {
        mapInstance.setView(
          [firstBeneficiary.location_geo.coordinates[1], firstBeneficiary.location_geo.coordinates[0]],
          mapInstance.getZoom(),
          { animate: true, duration: 1 }
        );
      }
    }
  }, [beneficiaryData]);

  useEffect(() => {
    const mapInstance = leafletMapRef.current;
    if (mapInstance) {
      const handleMoveEnd = () => {
        checkBeneficiariesInView();
      };

      mapInstance.on('moveend', handleMoveEnd);

      return () => {
        mapInstance.off('moveend', handleMoveEnd);
      };
    }
  }, [checkBeneficiariesInView]);

  const MemoizedMarkers = useMemo(() => {
    if (!beneficiaryData || beneficiaryData.length === 0) {
      return [];
    }
    
    const validBeneficiaries = beneficiaryData.filter((beneficiary) => 
      beneficiary && 
      beneficiary.location_geo && 
      beneficiary.location_geo.coordinates && 
      beneficiary.location_geo.coordinates.length === 2 &&
      typeof beneficiary.location_geo.coordinates[0] === 'number' &&
      typeof beneficiary.location_geo.coordinates[1] === 'number' &&
      beneficiary.name && beneficiary.name.trim() !== '' &&
      beneficiary.country && beneficiary.country.trim() !== ''
    );
    
    return validBeneficiaries.map((beneficiary) => (
      <Marker
        key={beneficiary.id}
        position={[beneficiary.location_geo!.coordinates[1], beneficiary.location_geo!.coordinates[0]]}
        icon={createCustomIcon()}
        eventHandlers={{
          click: () => handleMarkerClick(beneficiary.id),
        }}
      >
        <Tooltip direction="top">
          {beneficiary.name || 'Unknown'} - {beneficiary.country || 'Unknown'}
        </Tooltip>
      </Marker>
    ));
  }, [beneficiaryData, handleMarkerClick]);

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
    if (leafletMapRef.current && (!beneficiaryData || beneficiaryData.length === 0)) {
      const map = leafletMapRef.current;
      map.eachLayer((layer: L.Layer) => {
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
  }, [beneficiaryData]);

  if (!isReady) {
    return <Box>Loading map...</Box>;
  }

  return (
    <Box className="h-[276px] md:h-[450px] w-full mb-8 rounded-xl relative" suppressHydrationWarning={true}>
      <MapContainer
        whenReady={
          ((event: L.LeafletEvent) => { leafletMapRef.current = event.target as L.Map; }) as unknown as () => void
        }
        center={[0, 0]}
        zoom={2}
        scrollWheelZoom={true}
        className="h-full w-full rounded-xl"
        minZoom={2}
        maxZoom={18}
        maxBounds={L.latLngBounds([-90, -180], [90, 180])}
        maxBoundsViscosity={1.0}
        zoomControl={false}
        zoomAnimation={true}
        fadeAnimation={true}
        markerZoomAnimation={true}
        preferCanvas={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.maptiler.com/">MapTiler</a>'
          url={`https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=Wm5rwQ7T3kAi2Z07eCBa&lang=en`}
        />
        <MapEventHandler onBoundsChange={onBoundsChange} />
        <FitBounds beneficiaryData={beneficiaryData} />
        <CustomZoomControl />
        <ZoomController
          beneficiaryData={beneficiaryData}
          onBoundsChange={onBoundsChange}
          onResetView={onResetView}
          beneficiaryType={beneficiaryType}
        />
        <TouchGestureHandler />
        {beneficiaryData && beneficiaryData.length > 0 ? (
          <MarkerClusterGroup 
            key={`cluster-${beneficiaryData.length}-${beneficiaryData.map((b) => b.id).join('-')}`}
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
          {showFilters ? "Hide Filters" : `Filter ${beneficiaryType === "ANIMAL" ? "Animals" : "Children"}`}
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
            beneficiaryType={beneficiaryType}
          />
        </Box>
      )}
    </Box>
  );
};

export default BeneficiaryMap;
