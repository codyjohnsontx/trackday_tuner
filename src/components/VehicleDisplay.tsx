import { useState } from 'react';
import { config } from '../config';

function VehicleDisplay() {
    const [vehicle, setVehicle] = useState(null);

    async function getVehicle() {
        try {
            const res = await fetch(
                `${config.apiUrl}?make=Ducati&model=Panigale V4`,
                {
                    headers: {
                        'X-Api-Key': config.apiKey
                    }
                }
            );
            const data = await res.json();
            if (data && data.length > 0) {
                setVehicle(data[0]);
            }
        } catch (error) {
            console.error("Error fetching vehicle:", error);
        }
    }

    return (
        <div className="max-w-md mx-auto p-6">
            {vehicle && (
                <div>
                    <h2 className="text-2xl font-bold">{vehicle.make} {vehicle.model}</h2>
                    <div className="mt-4 space-y-2">
                        <p>Year: {vehicle.year}</p>
                        <p>Type: {vehicle.type}</p>
                        <p>Engine: {vehicle.engine}</p>
                        <p>Power: {vehicle.power}</p>
                    </div>
                </div>
            )}
            <button
                onClick={getVehicle}
                className="bg-blue-500 text-white px-4 py-2 rounded mt-4 hover:bg-blue-600 transition-colors"
            >
                Get Vehicle
            </button>
        </div>
    );
}

export default VehicleDisplay;