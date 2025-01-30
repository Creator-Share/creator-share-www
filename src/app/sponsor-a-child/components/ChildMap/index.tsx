"use client";
import React from "react";
import { Box } from "@chakra-ui/react";
import { MapContainer, TileLayer, Marker, useMap, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const CustomIcon = L.icon({
    iconUrl: "/CreatorSharePin.svg",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
});

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
}
const FitBounds = ({ childData }: { childData: ChildMapProps["childData"] }) => {
    const map = useMap();

    React.useEffect(() => {
        if (childData.length > 0) {
            const bounds = L.latLngBounds(
                childData.map((child) => [
                    child.location_geo.coordinates[1],
                    child.location_geo.coordinates[0],
                ])
            );
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [childData, map]);

    return null;
};


const ChildMap: React.FC<ChildMapProps> = ({
    childData,
    onMarkerClick,
}) => {
    const countries = React.useMemo(() =>
        childData.reduce((acc, child) => {
            if (!acc[child.country]) {
                acc[child.country] = [];
            }
            acc[child.country].push(child);
            return acc;
        }, {} as Record<string, typeof childData>)
        , [childData]);

    return (
        <Box className="h-[571px] w-full mb-8 rounded-2xl">
            <MapContainer
                center={[0, 0]}
                zoom={2}
                scrollWheelZoom={false}
                className="h-full w-full rounded-2xl"
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {Object.entries(countries).map(([country, children]) => (
                    <Marker
                        key={children[0].id}
                        position={[
                            children[0].location_geo.coordinates[1],
                            children[0].location_geo.coordinates[0],
                        ]}
                        icon={CustomIcon}
                        eventHandlers={{
                            click: () => onMarkerClick(children[0].id),
                        }}
                    >
                        <Tooltip>
                            {country} - {children.length} children
                        </Tooltip>
                    </Marker>
                ))}
                <FitBounds childData={childData} />
            </MapContainer>
        </Box>
    );
};

export default ChildMap;