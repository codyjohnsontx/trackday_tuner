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
        <div>
            {vehicle && (
                <div>
                    <h2>{vehicle.make} {vehicle.model}</h2>
                    <div>
                        <p>Year: {vehicle.year}</p>
                        <p>Type: {vehicle.type}</p>
                        <p>Engine: {vehicle.engine}</p>
                        <p>Power: {vehicle.power}</p>
                        <p>Front Suspension: {vehicle.front_suspension}</p>
                        <p>Front Wheel Travel: {vehicle.front_wheel_travel}</p>
                        <p>Rear Suspension: {vehicle.rear_suspension}</p>
                        <p>Rear Wheel Travel: {vehicle.rear_wheel_travel}</p>
                        <p>Front Tire Size: {vehicle.front_tire}</p>
                        <p>Rear Tire Size: {vehicle.rear_tire}</p>
                        <p>Total Weight: {vehicle.total_weight}</p>



                    </div>
                </div>
            )}
            <button onClick={getVehicle}>Get Vehicle</button>
        </div>
    );
}

export default VehicleDisplay;