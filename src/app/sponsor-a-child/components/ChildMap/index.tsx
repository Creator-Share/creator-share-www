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
      style: 'mapbox://styles/mapbox/streets-v8',
      center: [105.8342, 21.0278],
      zoom: 5,
    });



    childData.forEach((child) => {
        const [lng, lat] = child.location_geo.coordinates; 

        const el = document.createElement('div');
        el.style.width = '50px';
        el.style.height = '50px';
        el.style.backgroundImage = `url(${child.image})`;
        el.style.backgroundPosition = 'center';
        el.style.borderRadius = '50%'; // Make it round
        el.style.cursor = 'pointer';

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);

        marker.getElement().addEventListener('click', () => {
          onMarkerClick(child.id);
        });
      });
      

    return () => {
      map.remove();
    };
  }, [childData, onMarkerClick, onViewportChange]);

  return <Box ref={mapContainer} className="h-[400px] w-full mb-10 rounded-lg" />;
};

export default ChildMap;
