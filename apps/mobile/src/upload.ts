import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { api, unwrap } from './api';
import { trackedFetch } from './network';

export type UploadPurpose = 'product_photo' | 'kyc_document' | 'dispute_evidence';

export interface LocalImage {
  uri: string;
  width: number;
  height: number;
}

export class CameraPermissionError extends Error {}
export class UploadError extends Error {}
/** Le fichier n'est plus sur le téléphone (cache vidé) : la photo est à reprendre. */
export class LocalPhotoMissingError extends Error {}

/** Bord le plus long après compression : assez pour zoomer sur la fiche, ≈ 200-400 Ko en JPEG. */
const MAX_EDGE = 1600;

/**
 * Photo depuis l'appareil photo ou la galerie, compressée sur le téléphone avant l'envoi
 * (une photo brute fait 3 à 5 Mo : trop cher en données mobiles). `null` si l'utilisateur renonce.
 */
export async function pickImage(source: 'camera' | 'library'): Promise<LocalImage | null> {
  if (source === 'camera' && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new CameraPermissionError();
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  return asset ? compress(asset) : null;
}

async function compress(asset: ImagePicker.ImagePickerAsset): Promise<LocalImage> {
  let image = await ImageManipulator.manipulate(asset.uri).renderAsync();
  if (Math.max(image.width, image.height) > MAX_EDGE) {
    image = await ImageManipulator.manipulate(image)
      .resize(image.width >= image.height ? { width: MAX_EDGE } : { height: MAX_EDGE })
      .renderAsync();
  }
  const saved = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/**
 * Envoi direct au stockage : réservation auprès de l'API, dépôt du fichier sur l'URL signée,
 * puis l'identifiant est rattaché par l'appelant (photo produit, pièce KYC, preuve de litige).
 */
export async function uploadImage(
  purpose: UploadPurpose,
  image: Pick<LocalImage, 'uri'>,
): Promise<string> {
  let blob: Blob;
  try {
    blob = await (await fetch(image.uri)).blob();
  } catch {
    throw new LocalPhotoMissingError(image.uri);
  }
  const reserved = unwrap(
    await api.POST('/v1/uploads', {
      body: { purpose, contentType: 'image/jpeg', sizeBytes: blob.size },
    }),
  );
  let response: Response;
  if (reserved.method === 'PUT') {
    response = await trackedFetch(reserved.url, {
      method: 'PUT',
      headers: reserved.headers,
      body: blob,
    });
  } else {
    const form = new FormData();
    for (const [name, value] of Object.entries(reserved.fields)) form.append(name, value);
    if (Platform.OS === 'web') form.append('file', blob, 'photo.jpg');
    // React Native lit le fichier lui-même à partir de son URI.
    else form.append('file', { uri: image.uri, name: 'photo.jpg', type: 'image/jpeg' } as never);
    response = await trackedFetch(reserved.url, { method: 'POST', body: form });
  }
  if (!response.ok) throw new UploadError(`Dépôt refusé (${response.status})`);
  return reserved.uploadId;
}
