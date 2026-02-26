'use client';

import { useTransition, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createVehicle, updateVehicle } from '@/lib/actions/vehicles';
import { createClient } from '@/lib/supabase/client';
import type { Vehicle, VehicleType } from '@/types';

interface VehicleFormProps {
  vehicle?: Vehicle;
}

export function VehicleForm({ vehicle }: VehicleFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEditing = !!vehicle;

  const [nickname, setNickname] = useState(vehicle?.nickname ?? '');
  const [type, setType] = useState<VehicleType>(vehicle?.type ?? 'motorcycle');
  const [year, setYear] = useState(vehicle?.year?.toString() ?? '');
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [errorMessage, setErrorMessage] = useState('');

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(vehicle?.photo_url ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPhotoFile(file);
    if (file) {
      setPhotoPreview(URL.createObjectURL(file));
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');

    const parsedYear = year.trim() ? Number(year.trim()) : null;
    if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 1885 || parsedYear > 2100)) {
      setErrorMessage('Please enter a valid year.');
      return;
    }

    startTransition(async () => {
      let photoUrl: string | null = vehicle?.photo_url ?? null;

      if (photoFile) {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setErrorMessage('Not authenticated.');
          return;
        }
        const path = `${user.id}/${Date.now()}_${photoFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from('vehicle-photos')
          .upload(path, photoFile, { upsert: true });
        if (uploadError) {
          setErrorMessage(`Photo upload failed: ${uploadError.message}`);
          return;
        }
        const { data: urlData } = supabase.storage
          .from('vehicle-photos')
          .getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }

      if (isEditing) {
        const result = await updateVehicle(vehicle.id, {
          nickname: nickname.trim(),
          type,
          year: parsedYear,
          make: make.trim() || null,
          model: model.trim() || null,
          photo_url: photoUrl,
        });

        if (!result.ok) {
          setErrorMessage(result.error);
          return;
        }
      } else {
        const result = await createVehicle({
          nickname: nickname.trim(),
          type,
          year: parsedYear,
          make: make.trim() || null,
          model: model.trim() || null,
          photo_url: photoUrl,
        });

        if (!result.ok) {
          setErrorMessage(result.error);
          return;
        }
      }

      router.push('/garage');
      router.refresh();
    });
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Vehicle Type
          </span>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-950 p-1">
            <Button
              type="button"
              variant={type === 'motorcycle' ? 'primary' : 'secondary'}
              className="min-h-10"
              onClick={() => setType('motorcycle')}
            >
              Motorcycle
            </Button>
            <Button
              type="button"
              variant={type === 'car' ? 'primary' : 'secondary'}
              className="min-h-10"
              onClick={() => setType('car')}
            >
              Car
            </Button>
          </div>
        </div>

        <Input
          label="Nickname"
          type="text"
          placeholder="e.g. Track Weapon, R6 Cup Bike"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          required
          autoComplete="off"
        />
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Optional Details
        </span>
        <Input
          label="Year"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="e.g. 2023"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <Input
          label="Make"
          type="text"
          placeholder="e.g. Yamaha, Honda, BMW"
          value={make}
          onChange={(e) => setMake(e.target.value)}
          autoComplete="off"
        />
        <Input
          label="Model"
          type="text"
          placeholder="e.g. R6, CBR600RR, M3"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Photo
        </span>
        {photoPreview ? (
          <div className="flex items-center gap-3">
            <Image
              src={photoPreview}
              alt="Vehicle preview"
              width={64}
              height={64}
              className="h-16 w-16 rounded-lg object-cover"
              unoptimized={photoPreview?.startsWith('blob:')}
            />
            <button
              type="button"
              className="text-sm text-zinc-400 hover:text-zinc-200"
              onClick={() => {
                setPhotoFile(null);
                setPhotoPreview(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            >
              Remove
            </button>
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="block w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-200 hover:file:bg-zinc-700"
          onChange={handlePhotoChange}
        />
      </div>

      {errorMessage ? (
        <p className="mt-3 text-sm text-rose-300">{errorMessage}</p>
      ) : null}

      <Button
        type="submit"
        fullWidth
        disabled={isPending || !nickname.trim()}
      >
        {isPending ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Vehicle'}
      </Button>
    </form>
  );
}
