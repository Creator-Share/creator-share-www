import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { Box } from '@chakra-ui/react';
import 'mapbox-gl/dist/mapbox-gl.css';

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

const ChildMap: React.FC<ChildMapProps> = ({ childData, onMarkerClick, onViewportChange }) => {
  const mapContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [105.8342, 21.0278],
      zoom: 5,
    });

    childData.forEach((child) => {
      const coordinates = child.location_geo.coordinates;

      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        console.error(`Invalid coordinates for ${child.name}:`, coordinates);
        return;
      }

      const [lng, lat] = coordinates;

      const marker = new mapboxgl.Marker()
        .setLngLat([lng, lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(`
              <div style="text-align: center;">
                <img src="${child.image}" alt="${child.name}" 
                     style="width: 50px; height: 50px; border-radius: 50%;" />
                <p><strong>${child.name}</strong></p>
                <p>${child.country}</p>
              </div>
          `)
        )
        .addTo(map);

      marker.getElement().addEventListener('click', () => {
        onMarkerClick(child.id);
      });
    });

    return () => {
      map.remove();
    };
  }, [childData, onMarkerClick, onViewportChange]);

  return <Box ref={mapContainer} className="h-[400px] w-full mb-44" />;
};

export default ChildMap;
