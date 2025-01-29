import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(req: Request) {
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);

    try {
        let query = supabase
            .from('people')
            .select('id, name, image, location_geo, birth_date, country, location_str');
        const ne = searchParams.get('ne');
        const sw = searchParams.get('sw');
        
        if (ne && sw) {
            try {
                const neCoords = JSON.parse(ne);
                const swCoords = JSON.parse(sw);
                
                query = query.filter(
                  'location_geo',
                  'st_within',
                  `SRID=4326;POLYGON((
                    ${swCoords[0]} ${swCoords[1]},
                    ${neCoords[0]} ${swCoords[1]},
                    ${neCoords[0]} ${neCoords[1]},
                    ${swCoords[0]} ${neCoords[1]},
                    ${swCoords[0]} ${swCoords[1]}
                  ))`
                );
            } catch (e) {
                console.error('Error parsing coordinates:', e);
            }
        }

        const { data, error } = await query;

        if (error) {
            console.error('Supabase error:', error);
            return NextResponse.json(
                { error: 'Database error' }, 
                { status: 500 }
            );
        }

        return NextResponse.json({ people: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return NextResponse.json(
            { error: 'Internal server error' }, 
            { status: 500 }
        );
    }
}